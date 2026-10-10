import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tempHome };
});

// Must import AFTER mock setup.
const { saveProject } = await import('../src/projects.js');
const { SESSION_IDLE_CLOSE_MS, TaskRunner } = await import('../src/taskRunner.js');

interface FakeSession {
  end: ReturnType<typeof vi.fn>;
  setMode: ReturnType<typeof vi.fn>;
}
interface Internals {
  sessions: Map<string, FakeSession>;
  scheduleIdleClose(taskId: string): void;
}

function makeRunner() {
  const store = { broadcast: vi.fn(), values: () => [][Symbol.iterator]() };
  const runtime = { startProjectScan: vi.fn(), handleHookEvent: vi.fn() };
  const proto = TaskRunner.prototype as unknown as { execute: () => Promise<void> };
  vi.spyOn(proto, 'execute').mockImplementation(async () => {});
  const runner = new TaskRunner(store as never, runtime as never);
  return { runner, internals: runner as unknown as Internals };
}

function liveSession(internals: Internals, taskId: string): FakeSession {
  const session = { end: vi.fn(), setMode: vi.fn(async () => {}) };
  internals.sessions.set(taskId, session);
  return session;
}

describe('idle sessions and permission modes', () => {
  let projectId: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-modes-test-'));
    const repo = path.join(tempHome, 'repo');
    fs.mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('init', '-b', 'main');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
    projectId = saveProject({
      id: '',
      name: 'P',
      repos: [{ name: 'repo', path: repo, defaultBranch: 'main' }],
    }).id;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('ends a session left waiting for 30 minutes, but never one that is working', () => {
    vi.useFakeTimers();
    const { runner, internals } = makeRunner();
    const task = runner.start(projectId, 't', 'do it');
    task.status = 'done';
    const session = liveSession(internals, task.id);

    internals.scheduleIdleClose(task.id);
    vi.advanceTimersByTime(SESSION_IDLE_CLOSE_MS - 1000);
    expect(session.end).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(session.end).toHaveBeenCalledTimes(1);

    // A turn that started meanwhile (owner message, QA feedback) is never cut.
    const busy = runner.start(projectId, 'busy', 'do it');
    const busySession = liveSession(internals, busy.id);
    internals.scheduleIdleClose(busy.id);
    busy.status = 'running';
    vi.advanceTimersByTime(SESSION_IDLE_CLOSE_MS);
    expect(busySession.end).not.toHaveBeenCalled();
  });

  it('switches mode live and remembers it for resumed sessions', () => {
    const { runner, internals } = makeRunner();
    const task = runner.start(projectId, 't', 'do it');
    const session = liveSession(internals, task.id);
    runner.setMode(task.id, 'plan');
    expect(session.setMode).toHaveBeenCalledWith('plan');
    expect(task.agent?.permissionMode).toBe('plan');
  });

  it('refuses modes that could write unasked in a read-only task (the owner checkout)', () => {
    const { runner } = makeRunner();
    const task = runner.start(projectId, 't', 'do it');
    task.readOnly = true;
    expect(() => runner.setMode(task.id, 'bypassPermissions')).toThrow(/Read-only/);
    expect(() => runner.setMode(task.id, 'auto')).toThrow(/Read-only/);
    runner.setMode(task.id, 'plan');
    expect(task.agent?.permissionMode).toBe('plan');
  });

  it('approving a plan continues in the mode the owner picked', () => {
    const { runner, internals } = makeRunner();
    const task = runner.start(projectId, 't', 'do it');
    const session = liveSession(internals, task.id);
    const resolve = vi.fn();
    (runner as unknown as { permissions: Map<string, unknown> }).permissions.set('r1', {
      taskId: task.id,
      resolve,
      message: {},
    });
    runner.answerPermission('r1', { allow: true, mode: 'acceptEdits' });
    expect(resolve).toHaveBeenCalledWith({ allow: true, mode: 'acceptEdits' });
    expect(session.setMode).toHaveBeenCalledWith('acceptEdits');
  });
});
