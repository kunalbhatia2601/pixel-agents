import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import type { AgentSettings, Project, Task } from '../../core/src/messages.js';
import { normalizeProjectPath } from '../../core/src/normalizeProjectPath.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { SERVER_JSON_DIR } from './constants.js';
import { cleanAgentSettings, getAgentDefaults, getProject, listProjectFiles } from './projects.js';
import { CLAUDE_HOOK_EVENTS } from './providers/hook/claude/constants.js';

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

/** A task's live agent process, open between turns for follow-up messages. */
interface Session {
  sessionId: string;
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
      const name = getProject(task.projectId)?.name;
      if (task.worktree && name) this.rememberWorktree(task.worktree, name);
    }
    this.persist();
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

  start(projectId: string, title: string, prompt: string, agent?: AgentSettings): Task {
    const project = getProject(projectId);
    if (!project) throw new Error('Unknown project');
    if (!title.trim() || !prompt.trim()) throw new Error('Title and instructions are required');
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
        ...cleanAgentSettings(agent),
      }),
    };
    this.tasks.unshift(task);
    this.rememberWorktree(task.worktree!, project.name);
    this.changed();
    void this.execute(task, project, prompt.trim());
    return task;
  }

  /** Running: abort now. Idle with an open session: end it gracefully. */
  stop(taskId: string): void {
    const task = this.tasks.find((t) => t.id === taskId);
    const session = this.sessions.get(taskId);
    if (session && task?.status === 'done') session.end();
    else this.aborts.get(taskId)?.abort();
  }

  /** The task whose live session is `sessionId`, if this server runs it. */
  taskIdForSession(sessionId: string): string | undefined {
    for (const [taskId, s] of this.sessions) if (s.sessionId === sessionId) return taskId;
    return undefined;
  }

  sendMessage(taskId: string, text: string): void {
    const session = this.sessions.get(taskId);
    const task = this.tasks.find((t) => t.id === taskId);
    if (!session || !task || !text.trim()) throw new Error('This agent is not accepting messages');
    session.push(text.trim());
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

  private async execute(task: Task, project: Project, prompt: string): Promise<void> {
    const abort = new AbortController();
    this.aborts.set(task.id, abort);
    try {
      await this.prepareWorktree(task, project);
      if (abort.signal.aborted) throw new Error('Stopped');

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
      const sessionId = crypto.randomUUID();
      const settings = task.agent ?? {};
      const stream = query({
        prompt: input.messages(),
        options: {
          cwd: task.worktree,
          sessionId,
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
        push: input.push,
        end: input.end,
        interrupt: () => stream.interrupt(),
        interrupted: false,
      };
      this.sessions.set(task.id, session);
      task.sessionOpen = true;
      this.changed();

      for await (const message of stream) {
        if (message.type !== 'result') continue;
        if (message.subtype === 'success') {
          task.status = 'done';
          this.writeMemory(task, project, prompt, message.result);
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

  private async prepareWorktree(task: Task, project: Project): Promise<void> {
    const git = (...args: string[]) => run('git', ['-C', project.repoPath, ...args]);
    let base = project.defaultBranch;
    try {
      await git('fetch', 'origin', project.defaultBranch);
      base = `origin/${project.defaultBranch}`;
    } catch {
      // No remote (or offline): branch from the local default branch.
      console.warn(`[Pixel Agents] Task ${task.id}: fetch failed, using local ${base}`);
    }
    fs.mkdirSync(path.dirname(task.worktree!), { recursive: true });
    await git('worktree', 'add', '-b', task.branch!, task.worktree!, base);
    if (project.setupCommand) {
      await run('sh', ['-c', project.setupCommand], {
        cwd: task.worktree,
        timeout: SETUP_TIMEOUT_MS,
      });
    }
  }

  /** Appended to Claude Code's system prompt: what this task is and where context lives. */
  private brief(task: Task, project: Project): string {
    const docs = listProjectFiles(project, 'docs');
    const memory = listProjectFiles(project, 'memory');
    const lines = [
      `# Project: ${project.name}`,
      `You are working on the task "${task.title}" in a dedicated git worktree on branch \`${task.branch}\`, created from \`${project.defaultBranch}\`.`,
      'Commit your work to this branch with clear messages. Do not push, merge, or switch branches.',
    ];
    if (project.testCommand) lines.push(`Verify your changes with: \`${project.testCommand}\``);
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

  private writeMemory(task: Task, project: Project, prompt: string, summary: string): void {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(project.dir!, 'memory', `${date}-${slugify(task.title)}-${task.id}.md`);
    const note = `# ${task.title}\n\nBranch: \`${task.branch}\`\n\n## Task\n\n${prompt}\n\n## Outcome\n\n${summary}\n`;
    try {
      fs.writeFileSync(file, note, 'utf-8');
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
