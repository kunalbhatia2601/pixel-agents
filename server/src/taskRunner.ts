import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import type {
  AgentSettings,
  Project,
  ProjectRepo,
  RepoBranches,
  Task,
} from '../../core/src/messages.js';
import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { SERVER_JSON_DIR } from './constants.js';
import { cleanAgentSettings, getAgentDefaults, getProject, listProjectFiles } from './projects.js';
import { CLAUDE_HOOK_EVENTS } from './providers/hook/claude/constants.js';
import { parseNumstat, summarizeChanges, usageFromModelUsage } from './usage.js';

const run = promisify(execFile);

const ROOT = path.join(os.homedir(), SERVER_JSON_DIR);
const TASKS_FILE = path.join(ROOT, 'tasks.json');
const WORKTREES_ROOT = path.join(ROOT, 'worktrees');
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
}

const FETCH_TIMEOUT_MS = 60_000;

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
  private tasks: Task[] = [];
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
      this.tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8')) as Task[];
    } catch {
      this.tasks = [];
    }
    for (const task of this.tasks) {
      // A server restart kills the agent processes, so in-flight work is over.
      if (task.status === 'preparing' || task.status === 'running') {
        task.status = 'stopped';
        task.error = 'Server restarted while the task was running';
      }
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
    const task: Task = {
      id,
      projectId,
      title: title.trim(),
      status: 'preparing',
      branch: `agent/${slugify(title)}-${id}`,
      worktree: path.join(WORKTREES_ROOT, slugify(project.name), id),
      createdAt: Date.now(),
      // Later layers win: global defaults → project → this task.
      agent: cleanAgentSettings({
        ...getAgentDefaults(),
        ...project.agent,
        ...cleanAgentSettings(opts.agent),
      }),
      parentTaskId: parent?.id,
    };
    this.tasks.unshift(task);
    this.rememberWorktree(task.worktree!, project.name);
    this.changed();
    void this.execute(task, project, prompt.trim(), false, {
      baseBranches,
      forkFrom: opts.carryContext ? parent : undefined,
    });
    return task;
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

  taskById(taskId: string): Task | undefined {
    return this.tasks.find((t) => t.id === taskId);
  }

  /** Running: abort now. Idle with an open session: end it gracefully. */
  stop(taskId: string): void {
    const task = this.tasks.find((t) => t.id === taskId);
    const session = this.sessions.get(taskId);
    if (session && task?.status === 'done') session.end();
    else this.aborts.get(taskId)?.abort();
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
  sendMessage(taskId: string, text: string): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || !text.trim()) throw new Error('This agent is not accepting messages');
    const session = this.sessions.get(taskId);
    if (session) {
      session.push(text.trim());
    } else {
      // A resume already starting has no session yet; a second one would run the agent twice.
      if (this.aborts.has(taskId))
        throw new Error('The agent is still starting; try again shortly');
      const project = getProject(task.projectId);
      if (!project || !this.canMessage(task)) {
        throw new Error("This task can't continue: its worktree no longer exists");
      }
      void this.execute(task, project, text.trim(), true);
    }
    task.status = 'running';
    task.error = undefined;
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
    launch: { baseBranches?: Record<string, string>; forkFrom?: Task } = {},
  ): Promise<void> {
    const abort = new AbortController();
    this.aborts.set(task.id, abort);
    try {
      if (!resume) await this.prepareWorktree(task, project, launch.baseBranches ?? {});
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
          additionalDirectories: [project.dir!],
          permissionMode: 'acceptEdits',
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
          this.writeMemory(task, project, session.lastPrompt, message.result);
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

  /** Diff of every repo against its merge base with the default branch — what a PR would show. */
  private async refreshChanges(task: Task, project: Project): Promise<void> {
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
        const base = (await git('merge-base', 'HEAD', ref)).stdout.trim();
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
      if (repo.setupCommand) {
        await run('sh', ['-c', repo.setupCommand], { cwd: dest, timeout: SETUP_TIMEOUT_MS });
      }
    }
  }

  /** Appended to Claude Code's system prompt: what this task is and where context lives. */
  private brief(task: Task, project: Project): string {
    const docs = listProjectFiles(project, 'docs');
    const memory = listProjectFiles(project, 'memory');
    const multi = project.repos.length > 1;
    const lines = [
      `# Project: ${project.name}`,
      multi
        ? `You are working on the task "${task.title}". Your working folder holds one git worktree per repo, each on branch \`${task.branch}\`:`
        : `You are working on the task "${task.title}" in a dedicated git worktree on branch \`${task.branch}\`, created from \`${project.repos[0].defaultBranch}\`.`,
    ];
    for (const repo of project.repos) {
      const where = multi ? `- \`${repo.name}/\` (from \`${repo.defaultBranch}\`)` : '';
      const verify = repo.testCommand ? `verify with \`${repo.testCommand}\`` : '';
      if (multi) lines.push([where, verify].filter(Boolean).join(': '));
      else if (verify) lines.push(`Verify your changes with: \`${repo.testCommand}\``);
    }
    lines.push(
      'Commit your work to the task branch with clear messages. Do not push, merge, or switch branches.',
    );
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
    this.persist();
    this.store.broadcast({ type: 'tasksLoaded', tasks: this.tasks });
  }

  private persist(): void {
    try {
      fs.mkdirSync(ROOT, { recursive: true });
      fs.writeFileSync(`${TASKS_FILE}.tmp`, JSON.stringify(this.tasks, null, 2), 'utf-8');
      fs.renameSync(`${TASKS_FILE}.tmp`, TASKS_FILE);
    } catch (err) {
      console.error('[Pixel Agents] Could not save tasks', err);
    }
  }
}
