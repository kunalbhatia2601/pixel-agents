import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import type {
  AgentSettings,
  BranchMode,
  Project,
  ProjectRepo,
  RepoBranches,
  Task,
} from '../../core/src/messages.js';
import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { DEV_TEAM_AREA, ensureAreaMapping, QA_AREA } from './areaMappings.js';
import { SERVER_JSON_DIR } from './constants.js';
import {
  cleanAgentSettings,
  getAgentDefaults,
  getProject,
  getReviewerDefaults,
  listProjectFiles,
} from './projects.js';
import { CLAUDE_HOOK_EVENTS } from './providers/hook/claude/constants.js';
import {
  DEFAULT_MAX_REVIEW_ROUNDS,
  feedbackMessage,
  parseVerdict,
  reviewerBrief,
  VERDICT_SCHEMA,
} from './reviewer.js';
import { needsBranch } from './taskRouter.js';
import { addUsage, parseNumstat, summarizeChanges, usageFromModelUsage } from './usage.js';

const run = promisify(execFile);

/** ~/.pixel-agents and its task files, resolved on use (tests swap the home directory). */
const root = () => path.join(os.homedir(), SERVER_JSON_DIR);
const tasksFile = () => path.join(root(), 'tasks.json');
const worktreesRoot = () => path.join(root(), 'worktrees');
const SETUP_TIMEOUT_MS = 10 * 60_000;
const DETAIL_MAX_CHARS = 2000;

/** The tool agents use to ask the user multiple-choice questions. */
const ASK_USER_QUESTION = 'AskUserQuestion';

export interface PermissionDecision {
  allow: boolean;
  /** Rejection reason shown to the agent. */
  message?: string;
  /** AskUserQuestion: question text -> chosen label(s). */
  answers?: Record<string, string>;
}

interface PendingPermission {
  taskId: string;
  resolve: (decision: PermissionDecision) => void;
  /** The permissionAsked message, re-sent to clients that connect later. */
  message: Record<string, unknown>;
}

export interface StartOptions {
  agent?: AgentSettings;
  /** Repo name → base branch; missing repos start from their default branch. */
  baseBranches?: Record<string, string>;
  fromTaskId?: string;
  carryContext?: boolean;
  /** auto (default): the router decides; branching from a task always cuts a branch. */
  branchMode?: BranchMode;
}

const FETCH_TIMEOUT_MS = 60_000;

/** Dev turns that may run at once: one per seat in the Dev Team room. */
export const DEV_SLOTS = 6;
/** QA reviews that may run at once. */
export const QA_SLOTS = 2;
const COMMIT_NUDGE =
  'You left uncommitted changes in the worktree. Commit them on this branch with a clear message (or revert them if they are not meant to stay), then reply with one line. QA reviews committed work only.';

/** Work waiting for a free Dev Team seat; persisted so a restart picks it back up. */
type PendingWork =
  | {
      kind: 'start';
      baseBranches: Record<string, string>;
      fromTaskId?: string;
      carryContext?: boolean;
      branchMode: BranchMode;
    }
  | { kind: 'message'; text: string };

/** A task plus the loop's bookkeeping, persisted in tasks.json alongside the public fields. */
type StoredTask = Task & {
  pending?: PendingWork;
  /** Reviews since the owner last messaged the dev; capped by maxReviewRounds. */
  autoRounds?: number;
  /** The dev's latest reply, given to the reviewer. */
  lastSummary?: string;
  /** HEAD of each repo at the last review: no new commits means nothing to review. */
  reviewedHeads?: Record<string, string>;
  commitNudged?: boolean;
};

/** "Bash(npm test)" + "Bash(npm test:*)" for every repo's test and setup command: run without asking. */
function projectCommandRules(project: Project): string[] {
  return project.repos
    .flatMap((r) => [r.testCommand, r.setupCommand])
    .filter((c): c is string => !!c)
    .flatMap((c) => [`Bash(${c})`, `Bash(${c}:*)`]);
}

const qaLabel = (project: Project) => `${project.name} QA`;
/** Editing tools a read-only task never gets; Bash still asks before anything that writes. */
const READ_ONLY_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/** Keeps entries for the project's repos only, and refuses names git would read as options. */
export function cleanBaseBranches(
  project: Project,
  input: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const repo of project.repos) {
    const branch = input?.[repo.name]?.trim();
    if (!branch) continue;
    if (branch.startsWith('-') || /\s/.test(branch))
      throw new Error(`Invalid branch name: ${branch}`);
    out[repo.name] = branch;
  }
  return out;
}

/** A task's live agent process, open between turns for follow-up messages. */
interface Session {
  sessionId: string;
  /** The message that started the current turn, for the memory note. */
  lastPrompt: string;
  push: (text: string) => void;
  end: () => void;
  interrupt: () => Promise<unknown>;
  /** Set by interrupt(): the next non-success result is the user's stop, not a failure. */
  interrupted: boolean;
}

/** User messages fed to the SDK as they arrive; ends when end() is called. */
export function inputQueue() {
  const pending: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push: (text: string) => {
      pending.push(text);
      notify();
    },
    end: () => {
      closed = true;
      notify();
    },
    async *messages() {
      for (;;) {
        while (pending.length) {
          const content = pending.shift()!;
          yield {
            type: 'user' as const,
            message: { role: 'user' as const, content },
            parent_tool_use_id: null,
          };
        }
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}

/** A repo's worktree for a task: the task folder itself for one repo, a subfolder per repo otherwise. */
function repoWorktree(task: Task, project: Project, repo: ProjectRepo): string {
  return project.repos.length > 1 ? path.join(task.worktree!, repo.name) : task.worktree!;
}

/** ", started at commit abc1234" — the task's real starting point, whichever branch it was cut from. */
function startedAt(task: Task, repo: ProjectRepo): string {
  const sha = task.baseCommits?.[repo.name];
  return sha ? `, started at commit ${sha.slice(0, 7)}` : '';
}

/** Where Claude Code writes transcripts for sessions started in `cwd`. */
function transcriptDir(cwd: string): string {
  return path.join(os.homedir(), '.claude', 'projects', normalizeProjectPath(cwd));
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'task'
  );
}

/** Starts SDK agents on project tasks and feeds their hook events into the office. */
export class TaskRunner {
  private tasks: StoredTask[] = [];
  /** Task ids waiting for a Dev Team seat / a QA slot, oldest first. */
  private devQueue: string[] = [];
  private reviewQueue: string[] = [];
  private reviewAborts = new Map<string, AbortController>();
  private pumping = false;
  private aborts = new Map<string, AbortController>();
  private permissions = new Map<string, PendingPermission>();
  private sessions = new Map<string, Session>();
  /** worktree path → project name, for the agent's office label (folderName). */
  private worktreeProject = new Map<string, string>();

  constructor(
    private store: AgentStateStore,
    private runtime: AgentRuntime,
  ) {
    try {
      this.tasks = JSON.parse(fs.readFileSync(tasksFile(), 'utf-8')) as Task[];
    } catch {
      this.tasks = [];
    }
    for (const task of this.tasks) {
      // A server restart kills the agent processes, so in-flight work is over.
      if (task.status === 'preparing' || task.status === 'running') {
        task.status = 'stopped';
        task.error = 'Server restarted while the task was running';
      }
      // Waiting work survives: queued dev work goes back in line, and so does an interrupted review.
      if (task.status === 'queued') {
        if (task.pending) this.devQueue.push(task.id);
        else task.status = 'stopped';
      }
      if (task.stage === 'reviewing') task.stage = 'review_queued';
      if (task.stage === 'review_queued') this.reviewQueue.push(task.id);
      // Sessions never survive a restart.
      task.sessionOpen = false;
      const project = getProject(task.projectId);
      if (task.worktree && project) this.rememberWorktree(task.worktree, project.name);
    }
    this.persist();
    // Worktrees may have moved on since the last turn (or predate change tracking): recount their diffs.
    void Promise.all(
      this.tasks.map((task) => {
        const project = getProject(task.projectId);
        return task.worktree && project && fs.existsSync(task.worktree)
          ? this.refreshChanges(task, project)
          : undefined;
      }),
    ).then(() => this.changed());
  }

  list(): Task[] {
    return this.tasks;
  }

  /** Office label for an agent running in one of our worktrees (by cwd or transcript dir). */
  projectNameFor(ctx: { cwd?: string; projectDir?: string }): string | undefined {
    return (
      this.worktreeProject.get(ctx.cwd ?? '') ?? this.worktreeProject.get(ctx.projectDir ?? '')
    );
  }

  private rememberWorktree(worktree: string, projectName: string): void {
    this.worktreeProject.set(worktree, projectName);
    this.worktreeProject.set(transcriptDir(worktree), projectName);
  }

  pendingPermissions(): Array<Record<string, unknown>> {
    return [...this.permissions.values()].map((p) => p.message);
  }

  start(projectId: string, title: string, prompt: string, opts: StartOptions = {}): Task {
    const project = getProject(projectId);
    if (!project) throw new Error('Unknown project');
    if (!title.trim() || !prompt.trim()) throw new Error('Title and instructions are required');
    const parent = opts.fromTaskId ? this.tasks.find((t) => t.id === opts.fromTaskId) : undefined;
    if (opts.fromTaskId && !parent) throw new Error('The task to branch from no longer exists');
    if (opts.carryContext && !(parent?.sessionId && parent.worktree)) {
      throw new Error("That task's conversation isn't available to copy");
    }
    const baseBranches = cleanBaseBranches(project, opts.baseBranches);
    const id = crypto.randomBytes(4).toString('hex');
    const task: StoredTask = {
      id,
      projectId,
      title: title.trim(),
      prompt: prompt.trim(),
      status: 'queued',
      maxReviewRounds: project.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS,
      branch: `agent/${slugify(title)}-${id}`,
      worktree: path.join(worktreesRoot(), slugify(project.name), id),
      createdAt: Date.now(),
      // Later layers win: global defaults → project → this task.
      agent: cleanAgentSettings({
        ...getAgentDefaults(),
        ...project.agent,
        ...cleanAgentSettings(opts.agent),
      }),
      parentTaskId: parent?.id,
      pending: {
        kind: 'start',
        baseBranches,
        fromTaskId: parent?.id,
        carryContext: opts.carryContext,
        branchMode: parent ? 'branch' : (opts.branchMode ?? 'auto'),
      },
    };
    this.tasks.unshift(task);
    this.rememberWorktree(task.worktree!, project.name);
    this.devQueue.push(task.id);
    this.changed();
    return task;
  }

  // ── Scheduler: Dev Team seats and QA slots ──

  private devBusy(): number {
    return this.tasks.filter((t) => t.status === 'preparing' || t.status === 'running').length;
  }

  private qaBusy(): number {
    return this.tasks.filter((t) => t.stage === 'reviewing').length;
  }

  /** Starts queued dev work and reviews while seats are free. Every state change ends here (via changed). */
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.devBusy() < DEV_SLOTS && this.devQueue.length) {
        const task = this.taskById(this.devQueue.shift()!);
        if (task?.status === 'queued' && task.pending) this.dispatch(task);
      }
      while (this.qaBusy() < QA_SLOTS && this.reviewQueue.length) {
        const task = this.taskById(this.reviewQueue.shift()!);
        if (task?.stage === 'review_queued') void this.review(task);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Runs a queued task's pending work now (a seat is free). Sets a busy status before returning. */
  private dispatch(task: StoredTask): void {
    const work = task.pending!;
    task.pending = undefined;
    const project = getProject(task.projectId);
    if (!project) {
      task.status = 'failed';
      task.error = 'The project no longer exists';
      return;
    }
    ensureAreaMapping(project.name, DEV_TEAM_AREA, (m) => this.store.broadcast(m));
    task.status = work.kind === 'start' ? 'preparing' : 'running';
    task.error = undefined;
    if (work.kind === 'start') {
      const parent = work.fromTaskId ? this.taskById(work.fromTaskId) : undefined;
      void this.execute(task, project, task.prompt ?? '', false, {
        baseBranches: work.baseBranches,
        forkFrom: work.carryContext ? parent : undefined,
        branchMode: work.branchMode,
      });
      return;
    }
    const session = this.sessions.get(task.id);
    if (session) session.push(work.text);
    else void this.execute(task, project, work.text, true);
  }

  /** Fetches every remote of each repo, then lists local + remote branches, newest commit first. */
  async listBranches(projectId: string): Promise<RepoBranches[]> {
    const project = getProject(projectId);
    if (!project) throw new Error('Unknown project');
    return Promise.all(
      project.repos.map(async (repo) => {
        const git = (...args: string[]) => run('git', ['-C', repo.path, ...args]);
        let fetchError: string | undefined;
        try {
          await run('git', ['-C', repo.path, 'fetch', '--all', '--prune'], {
            timeout: FETCH_TIMEOUT_MS,
          });
        } catch (err) {
          fetchError = err instanceof Error ? err.message.split('\n')[0] : String(err);
        }
        const { stdout } = await git(
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(refname:short)',
          'refs/heads',
          'refs/remotes',
        );
        // "origin" alone is how for-each-ref shortens refs/remotes/origin/HEAD.
        const remotes = new Set((await git('remote')).stdout.split('\n').filter(Boolean));
        const branches = stdout
          .split('\n')
          .filter((b) => b && !remotes.has(b) && !b.endsWith('/HEAD'));
        return { repo: repo.name, branches, fetchError };
      }),
    );
  }

  /** The transcript a task's agent writes (and a chat about the task reads). */
  transcriptFile(task: Task): string | undefined {
    return task.worktree && task.sessionId
      ? path.join(transcriptDir(task.worktree), `${task.sessionId}.jsonl`)
      : undefined;
  }

  taskById(taskId: string): StoredTask | undefined {
    return this.tasks.find((t) => t.id === taskId);
  }

  /** The task a QA agent's session reviewed (its chat is read-only). */
  taskForReviewSession(sessionId: string): Task | undefined {
    return this.tasks.find((t) => t.reviewSessionIds?.includes(sessionId));
  }

  /** Running: abort now. Idle with an open session: end it gracefully. */
  stop(taskId: string): void {
    const task = this.taskById(taskId);
    if (!task) return;
    if (task.status === 'queued') {
      task.pending = undefined;
      task.status = task.sessionId ? 'done' : 'stopped';
    }
    if (task.stage === 'review_queued' || task.stage === 'reviewing') {
      this.reviewAborts.get(taskId)?.abort();
      task.stage = 'escalated';
    }
    const session = this.sessions.get(taskId);
    if (session && task.status === 'done') session.end();
    else this.aborts.get(taskId)?.abort();
    this.changed();
  }

  /** Any task (finished or not) whose agent ran as `sessionId`: its usage and changes. */
  taskForSession(sessionId: string): Task | undefined {
    return this.tasks.find((t) => t.sessionId === sessionId);
  }

  /** Live, or ended but resumable: its worktree (and so its branch and work) still exists. */
  canMessage(task: Task): boolean {
    return (
      this.sessions.has(task.id) ||
      (!!task.sessionId && !!task.worktree && fs.existsSync(task.worktree))
    );
  }

  /**
   * A follow-up always continues the task: same worktree, same branch, same conversation.
   * A live session takes it directly; an ended one (End session, server restart) is resumed.
   */
  sendMessage(taskId: string, text: string, fromOwner = true): void {
    const task = this.taskById(taskId);
    if (!task || !text.trim()) throw new Error('This agent is not accepting messages');
    // The owner stepping in restarts the automatic review count.
    if (fromOwner) task.autoRounds = 0;
    const session = this.sessions.get(taskId);
    if (session && task.status === 'running') {
      session.push(text.trim()); // already holds a seat; the session queues it after the current turn
    } else if (task.status === 'queued' && task.pending) {
      task.pending =
        task.pending.kind === 'message'
          ? { kind: 'message', text: `${task.pending.text}\n\n${text.trim()}` }
          : task.pending; // not started yet: the first turn will see the conversation anyway
    } else {
      // A resume already starting has no session yet; a second one would run the agent twice.
      if (!session && this.aborts.has(taskId)) {
        throw new Error('The agent is still starting; try again shortly');
      }
      if (!this.canMessage(task)) {
        throw new Error("This task can't continue: its worktree no longer exists");
      }
      task.status = 'queued';
      task.pending = { kind: 'message', text: text.trim() };
      this.devQueue.push(task.id);
    }
    this.changed();
  }

  async interrupt(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) throw new Error('This agent is not running');
    session.interrupted = true;
    await session.interrupt();
  }

  answerPermission(requestId: string, decision: PermissionDecision): void {
    const pending = this.permissions.get(requestId);
    if (!pending) return;
    this.permissions.delete(requestId);
    pending.resolve(decision);
    this.store.broadcast({ type: 'permissionResolved', requestId });
  }

  /** Runs the task's agent. `resume` continues its ended session in the existing worktree. */
  private async execute(
    task: Task,
    project: Project,
    prompt: string,
    resume = false,
    launch: {
      baseBranches?: Record<string, string>;
      forkFrom?: Task;
      branchMode?: BranchMode;
    } = {},
  ): Promise<void> {
    const abort = new AbortController();
    this.aborts.set(task.id, abort);
    try {
      if (!resume) {
        const mode = launch.branchMode ?? 'branch';
        const cut =
          mode === 'branch' || (mode === 'auto' && (await needsBranch(task.title, prompt)));
        if (cut) {
          await this.prepareWorktree(task, project, launch.baseBranches ?? {});
        } else {
          // Questions and reviews run where the user's work is: their checkout, current branch, uncommitted changes.
          task.readOnly = true;
          task.branch = undefined;
          task.worktree = project.repos[0].path;
          this.rememberWorktree(task.worktree, project.name);
        }
      }
      if (abort.signal.aborted) throw new Error('Stopped');
      const fork = launch.forkFrom;
      if (fork) {
        this.copyTranscriptForFork(fork, task);
        prompt =
          `(You are continuing from the task "${fork.title}" as a copy of its conversation, now in a new worktree ` +
          `at ${task.worktree} on branch \`${task.branch}\`. Paths under ${fork.worktree} from earlier now live ` +
          `under ${task.worktree}. Do not touch the old worktree.)\n\n${prompt}`;
      }

      // Marks the worktree's transcript dir as tracked so the runtime adopts the session.
      this.runtime.startProjectScan(transcriptDir(task.worktree!));

      task.status = 'running';
      this.changed();

      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const forward = async (input: unknown) => {
        this.runtime.handleHookEvent('claude', input as Record<string, unknown>);
        return {};
      };
      // Streaming input keeps the session open after each result, for follow-up messages.
      const input = inputQueue();
      input.push(prompt);
      // Resuming (not forking) keeps the session id, so the transcript and office agent carry on.
      // Forking copies another task's session under a new id; the original stays untouched.
      const sessionId = resume ? task.sessionId! : crypto.randomUUID();
      task.sessionId = sessionId;
      const sessionOptions = resume
        ? { resume: sessionId }
        : fork
          ? { resume: fork.sessionId, forkSession: true, sessionId }
          : { sessionId };
      const settings = task.agent ?? {};
      const stream = query({
        prompt: input.messages(),
        options: {
          cwd: task.worktree,
          ...sessionOptions,
          ...(task.readOnly ? { disallowedTools: READ_ONLY_DISALLOWED_TOOLS } : {}),
          abortController: abort,
          model: settings.model,
          effort: settings.effort,
          thinking: settings.thinking ? { type: settings.thinking } : undefined,
          // 'user' would load ~/.claude/settings.json, whose global hooks would double-report
          settingSources: ['project', 'local'],
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: this.brief(task, project),
          },
          // Read-only: the other repos are read in place. Branch tasks reach them through the workspace folder.
          additionalDirectories: [
            project.dir!,
            ...(task.readOnly ? project.repos.slice(1).map((r) => r.path) : []),
          ],
          permissionMode: task.readOnly ? 'default' : 'acceptEdits',
          allowedTools: task.readOnly ? [] : projectCommandRules(project),
          canUseTool: (toolName, input, { signal }) =>
            this.askPermission(task, sessionId, toolName, input, signal).then((d) =>
              d.allow
                ? {
                    behavior: 'allow' as const,
                    // AskUserQuestion reads the user's choices from `answers` on its input.
                    updatedInput: d.answers ? { ...input, answers: d.answers } : input,
                  }
                : {
                    behavior: 'deny' as const,
                    message: d.message?.trim() || 'The user denied this action.',
                  },
            ),
          hooks: Object.fromEntries(
            CLAUDE_HOOK_EVENTS.map((event) => [event, [{ hooks: [forward] }]]),
          ),
        },
      });

      const session: Session = {
        sessionId,
        lastPrompt: prompt,
        push: (text) => {
          session.lastPrompt = text;
          input.push(text);
        },
        end: input.end,
        interrupt: () => stream.interrupt(),
        interrupted: false,
      };
      this.sessions.set(task.id, session);
      task.sessionOpen = true;
      this.changed();

      for await (const message of stream) {
        if (message.type !== 'result') continue;
        // Running session totals: keep the latest, never sum results.
        task.usage = usageFromModelUsage(message.modelUsage, message.total_cost_usd);
        await this.refreshChanges(task, project);
        if (message.subtype === 'success') {
          task.status = 'done';
          (task as StoredTask).lastSummary = message.result;
          this.writeMemory(task, project, session.lastPrompt, message.result);
          await this.afterDevTurn(task, project);
        } else if (session.interrupted) {
          task.status = 'done'; // the user stopped this turn; the session waits for them
        } else {
          task.status = 'failed';
          task.error = message.subtype;
        }
        session.interrupted = false;
        this.changed();
      }
      if (task.status === 'running') task.status = abort.signal.aborted ? 'stopped' : 'done';
    } catch (err) {
      task.status = abort.signal.aborted ? 'stopped' : 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      console.error(`[Pixel Agents] Task ${task.id} ${task.status}: ${task.error}`);
    } finally {
      this.aborts.delete(task.id);
      this.sessions.delete(task.id);
      task.sessionOpen = false;
      for (const [requestId, p] of this.permissions) {
        if (p.taskId === task.id) this.answerPermission(requestId, { allow: false });
      }
      this.changed();
    }
  }

  /**
   * Claude Code looks a session up in the transcript folder of its working directory, so a fork into a
   * new worktree needs the source transcript there first. Copied before the office scans that folder
   * (with its old mtime) so it is never adopted as an agent of its own.
   */
  private copyTranscriptForFork(from: Task, to: Task): void {
    const source = this.transcriptFile(from);
    if (!source || !fs.existsSync(source)) {
      throw new Error(`The conversation of "${from.title}" is no longer on disk`);
    }
    const dest = path.join(transcriptDir(to.worktree!), path.basename(source));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    const { atime, mtime } = fs.statSync(source);
    fs.utimesSync(dest, atime, mtime);
  }

  // ── Review loop ──

  private async repoHeads(task: Task, project: Project, worktreeOf = repoWorktree) {
    const heads: Record<string, string> = {};
    for (const repo of project.repos) {
      const dir = worktreeOf(task, project, repo);
      heads[repo.name] = (await run('git', ['-C', dir, 'rev-parse', 'HEAD'])).stdout.trim();
    }
    return heads;
  }

  /** After a successful dev turn: nudge an uncommitted tree once, else put new commits on the QA pile. */
  private async afterDevTurn(task: StoredTask, project: Project): Promise<void> {
    if (task.readOnly || !task.maxReviewRounds) return;
    try {
      let dirty = false;
      for (const repo of project.repos) {
        const { stdout } = await run('git', [
          '-C',
          repoWorktree(task, project, repo),
          'status',
          '--porcelain',
        ]);
        if (stdout.trim()) dirty = true;
      }
      if (dirty && !task.commitNudged) {
        task.commitNudged = true;
        this.sendMessage(task.id, COMMIT_NUDGE, false);
        return;
      }
      const heads = await this.repoHeads(task, project);
      const unchanged = (since?: Record<string, string>) =>
        !!since && project.repos.every((r) => since[r.name] === heads[r.name]);
      if (unchanged(task.baseCommits) || unchanged(task.reviewedHeads)) {
        // Nothing new to review. Feedback that produced no commits is stuck: hand it to the owner.
        if (task.stage === 'changes_requested') task.stage = 'escalated';
        return;
      }
      task.commitNudged = false;
      task.stage = 'review_queued';
      this.reviewQueue.push(task.id);
    } catch (err) {
      console.warn(`[Pixel Agents] Task ${task.id}: could not queue a review`, err);
    }
  }

  /** The reviewer's own detached checkout of the task branch, next to the dev's worktree. */
  private reviewWorktree = (task: Task, project: Project, repo: ProjectRepo): string =>
    project.repos.length > 1 ? path.join(`${task.worktree}-qa`, repo.name) : `${task.worktree}-qa`;

  private async prepareReviewWorktree(task: Task, project: Project): Promise<string> {
    for (const repo of project.repos) {
      const dest = this.reviewWorktree(task, project, repo);
      if (fs.existsSync(dest)) {
        // Fresh each round: exactly the branch's latest commit, last round's scratch tests gone.
        await run('git', ['-C', dest, 'reset', '--hard', task.branch!]);
        await run('git', ['-C', dest, 'clean', '-fd']);
      } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await run('git', ['-C', repo.path, 'worktree', 'add', '--detach', dest, task.branch!]);
        if (repo.setupCommand) {
          await run('sh', ['-c', repo.setupCommand], { cwd: dest, timeout: SETUP_TIMEOUT_MS });
        }
      }
    }
    return `${task.worktree}-qa`;
  }

  /** One QA round: a separate agent reviews the branch and returns a structured verdict. */
  private async review(task: StoredTask): Promise<void> {
    const project = getProject(task.projectId);
    const round = (task.reviews?.length ?? 0) + 1;
    task.stage = 'reviewing';
    this.changed();
    const abort = new AbortController();
    this.reviewAborts.set(task.id, abort);
    try {
      if (!project) throw new Error('The project no longer exists');
      const heads = await this.repoHeads(task, project);
      const reviewDir = await this.prepareReviewWorktree(task, project);
      this.rememberWorktree(reviewDir, qaLabel(project));
      ensureAreaMapping(qaLabel(project), QA_AREA, (m) => this.store.broadcast(m));
      this.runtime.startProjectScan(transcriptDir(reviewDir));

      const sessionId = crypto.randomUUID();
      task.reviewSessionIds = [...(task.reviewSessionIds ?? []), sessionId];
      const settings = cleanAgentSettings({ ...task.agent, ...getReviewerDefaults() }) ?? {};
      const brief = reviewerBrief(task, project, {
        reviewDir,
        repoDirs: project.repos.map((r) => ({
          name: r.name,
          dir: this.reviewWorktree(task, project, r),
          base: task.baseCommits?.[r.name] ?? r.defaultBranch,
          testCommand: r.testCommand,
        })),
        devSummary: task.lastSummary,
        docsDir: path.join(project.dir!, 'docs'),
        memoryDir: path.join(project.dir!, 'memory'),
        round,
      });
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const forward = async (input: unknown) => {
        this.runtime.handleHookEvent('claude', input as Record<string, unknown>);
        return {};
      };
      const stream = query({
        prompt: `Review the task "${task.title}" (round ${round}) and return your verdict.`,
        options: {
          cwd: reviewDir,
          sessionId,
          abortController: abort,
          model: settings.model,
          effort: settings.effort,
          thinking: settings.thinking ? { type: settings.thinking } : undefined,
          settingSources: ['project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: brief },
          additionalDirectories: [project.dir!],
          // Its own throwaway checkout: it may write scratch tests; the project's commands run unasked.
          permissionMode: 'acceptEdits',
          allowedTools: projectCommandRules(project),
          outputFormat: { type: 'json_schema', schema: VERDICT_SCHEMA },
          canUseTool: (toolName, input, { signal }) =>
            this.askPermission(task, sessionId, toolName, input, signal).then((d) =>
              d.allow
                ? {
                    behavior: 'allow' as const,
                    updatedInput: d.answers ? { ...input, answers: d.answers } : input,
                  }
                : { behavior: 'deny' as const, message: d.message?.trim() || 'Denied.' },
            ),
          hooks: Object.fromEntries(
            CLAUDE_HOOK_EVENTS.map((event) => [event, [{ hooks: [forward] }]]),
          ),
        },
      });
      let structured: unknown;
      for await (const message of stream) {
        if (message.type !== 'result') continue;
        task.reviewUsage = addUsage(
          task.reviewUsage,
          usageFromModelUsage(message.modelUsage, message.total_cost_usd),
        );
        if (message.subtype !== 'success') throw new Error(`Review ended: ${message.subtype}`);
        structured = message.structured_output;
      }
      const verdict = parseVerdict(structured);
      const record = { round, at: Date.now(), ...verdict };
      task.reviews = [...(task.reviews ?? []), record];
      task.reviewedHeads = heads;
      task.autoRounds = (task.autoRounds ?? 0) + 1;
      const max = task.maxReviewRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;
      if (verdict.approved) {
        task.stage = 'approved';
      } else if (task.autoRounds >= max) {
        task.stage = 'escalated';
      } else {
        task.stage = 'changes_requested';
        this.sendMessage(task.id, feedbackMessage(record, max), false);
      }
    } catch (err) {
      const error = abort.signal.aborted
        ? 'Stopped by the owner'
        : err instanceof Error
          ? err.message
          : String(err);
      task.reviews = [...(task.reviews ?? []), { round, at: Date.now(), error }];
      task.stage = 'escalated';
      console.error(`[Pixel Agents] Task ${task.id} review ${round} failed: ${error}`);
    } finally {
      this.reviewAborts.delete(task.id);
      this.changed();
    }
  }

  /** Diff of every repo against its merge base with the default branch — what a PR would show. */
  private async refreshChanges(task: Task, project: Project): Promise<void> {
    if (task.readOnly) return; // it works in the user's checkout; its diff is the user's own work
    const files = [];
    for (const repo of project.repos) {
      const git = (...args: string[]) =>
        run('git', ['-C', repoWorktree(task, project, repo), ...args]);
      try {
        const remote = `origin/${repo.defaultBranch}`;
        const ref = await git('rev-parse', '--verify', '--quiet', remote).then(
          () => remote,
          () => repo.defaultBranch,
        );
        // The commit the worktree started from; tasks from before it was recorded fall back to the merge base.
        const base =
          task.baseCommits?.[repo.name] ?? (await git('merge-base', 'HEAD', ref)).stdout.trim();
        // shortcut: untracked files the agent never staged are not counted; they show once committed.
        const { stdout } = await git('diff', '--numstat', base);
        files.push(...parseNumstat(stdout, project.repos.length > 1 ? `${repo.name}/` : ''));
      } catch (err) {
        console.warn(`[Pixel Agents] Task ${task.id}: diff failed for ${repo.name}`, err);
      }
    }
    Object.assign(task, summarizeChanges(files));
  }

  /** One worktree per repo, all on the task's branch, each from its chosen base (default: the default branch). */
  private async prepareWorktree(
    task: Task,
    project: Project,
    baseBranches: Record<string, string>,
  ): Promise<void> {
    for (const repo of project.repos) {
      const git = (...args: string[]) => run('git', ['-C', repo.path, ...args]);
      const dest = repoWorktree(task, project, repo);
      let base = baseBranches[repo.name];
      if (base) {
        // Picked from listBranches, which already fetched; it must still resolve to a commit.
        await git('rev-parse', '--verify', '--quiet', `${base}^{commit}`).catch(() => {
          throw new Error(`Branch "${base}" not found in ${repo.name}`);
        });
      } else {
        base = repo.defaultBranch;
        try {
          await git('fetch', 'origin', repo.defaultBranch);
          base = `origin/${repo.defaultBranch}`;
        } catch {
          // No remote (or offline): branch from the local default branch.
          console.warn(
            `[Pixel Agents] Task ${task.id}: fetch failed for ${repo.name}, using ${base}`,
          );
        }
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await git('worktree', 'add', '-b', task.branch!, dest, base);
      const started = (await run('git', ['-C', dest, 'rev-parse', 'HEAD'])).stdout.trim();
      task.baseCommits = { ...task.baseCommits, [repo.name]: started };
      if (repo.setupCommand) {
        await run('sh', ['-c', repo.setupCommand], { cwd: dest, timeout: SETUP_TIMEOUT_MS });
      }
    }
  }

  /** Appended to Claude Code's system prompt: what this task is and where context lives. */
  private brief(task: Task, project: Project): string {
    const multi = project.repos.length > 1;
    const lines = [`# Project: ${project.name}`];
    if (task.readOnly) {
      lines.push(
        `You are answering the task "${task.title}" directly in the user's own checkout, read-only. No branch was cut because the task only needs looking, not changing.`,
        ...project.repos.map(
          (r) =>
            `- \`${r.name}\`: ${r.path} (whatever branch and uncommitted changes the user has there)`,
        ),
        'Do not modify files, stage, commit, stash, switch branches or run anything that writes; file-editing tools are disabled. Inspect with read-only commands (git status, git diff, git log, reading files).',
        'If the user asks for changes, explain what you would change and tell them to use "New branch from here" on this task, which carries this conversation into a branch where you can edit.',
      );
      return this.briefContext(lines, project);
    }
    lines.push(
      multi
        ? `You are working on the task "${task.title}". Your working folder holds one git worktree per repo, each on branch \`${task.branch}\`:`
        : `You are working on the task "${task.title}" in a dedicated git worktree on branch \`${task.branch}\`${startedAt(task, project.repos[0])}.`,
      `This is an isolated copy, not the user's checkout${multi ? 's' : ''} (${project.repos.map((r) => r.path).join(', ')}): their uncommitted changes are not here.`,
    );
    for (const repo of project.repos) {
      const where = multi ? `- \`${repo.name}/\`${startedAt(task, repo)}` : '';
      const verify = repo.testCommand ? `verify with \`${repo.testCommand}\`` : '';
      if (multi) lines.push([where, verify].filter(Boolean).join(': '));
      else if (verify) lines.push(`Verify your changes with: \`${repo.testCommand}\``);
    }
    lines.push(
      'Commit your work to the task branch with clear messages. Do not push, merge, or switch branches.',
    );
    return this.briefContext(lines, project);
  }

  /** Docs, memory and the closing instruction, shared by both kinds of brief. */
  private briefContext(lines: string[], project: Project): string {
    const docs = listProjectFiles(project, 'docs');
    const memory = listProjectFiles(project, 'memory');
    if (docs.length || memory.length) {
      lines.push('', 'Read these with the Read tool (no approval needed), not the shell.');
    }
    if (docs.length) {
      lines.push(
        '',
        `Project docs in ${path.join(project.dir!, 'docs')} (read the relevant ones):`,
      );
      lines.push(...docs.map((f) => `- ${f}`));
    }
    if (memory.length) {
      lines.push(
        '',
        `Notes from past tasks in ${path.join(project.dir!, 'memory')} (check before starting):`,
      );
      lines.push(...memory.map((f) => `- ${f}`));
    }
    lines.push(
      '',
      'When you finish, reply with a short summary: what changed, decisions made, gotchas, and key files. It is saved to project memory for future tasks.',
    );
    return lines.join('\n');
  }

  /** One note per task: the first outcome, then each follow-up appended below it. */
  private writeMemory(task: Task, project: Project, prompt: string, summary: string): void {
    // The task's start date, not today's: a follow-up days later must find the same file.
    const date = new Date(task.createdAt).toISOString().slice(0, 10);
    const file = path.join(project.dir!, 'memory', `${date}-${slugify(task.title)}-${task.id}.md`);
    try {
      if (fs.existsSync(file)) {
        const quoted = prompt.replace(/^/gm, '> ');
        fs.appendFileSync(file, `\n## Follow-up\n\n${quoted}\n\n${summary}\n`, 'utf-8');
      } else {
        const note = `# ${task.title}\n\nBranch: \`${task.branch}\`\n\n## Task\n\n${prompt}\n\n## Outcome\n\n${summary}\n`;
        fs.writeFileSync(file, note, 'utf-8');
      }
    } catch (err) {
      console.error(`[Pixel Agents] Task ${task.id}: could not write memory note`, err);
    }
  }

  private askPermission(
    task: Task,
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<PermissionDecision> {
    const requestId = crypto.randomUUID();
    const detail =
      typeof input.command === 'string' ? input.command : JSON.stringify(input, null, 2);
    let agentId: number | undefined;
    for (const agent of this.store.values()) if (agent.sessionId === sessionId) agentId = agent.id;
    const message = {
      type: 'permissionAsked',
      requestId,
      taskId: task.id,
      taskTitle: task.title,
      toolName,
      detail: detail.slice(0, DETAIL_MAX_CHARS),
      agentId,
      questions: toolName === ASK_USER_QUESTION ? input.questions : undefined,
    };
    return new Promise((resolve) => {
      this.permissions.set(requestId, { taskId: task.id, resolve, message });
      signal.addEventListener('abort', () => this.answerPermission(requestId, { allow: false }), {
        once: true,
      });
      this.store.broadcast(message);
    });
  }

  private changed(): void {
    this.pump();
    this.persist();
    this.store.broadcast({ type: 'tasksLoaded', tasks: this.tasks });
  }

  private persist(): void {
    try {
      fs.mkdirSync(root(), { recursive: true });
      fs.writeFileSync(`${tasksFile()}.tmp`, JSON.stringify(this.tasks, null, 2), 'utf-8');
      fs.renameSync(`${tasksFile()}.tmp`, tasksFile());
    } catch (err) {
      console.error('[Pixel Agents] Could not save tasks', err);
    }
  }
}
