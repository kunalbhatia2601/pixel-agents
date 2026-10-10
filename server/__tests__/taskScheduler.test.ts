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
const { DEV_SLOTS, QA_SLOTS, TaskRunner } = await import('../src/taskRunner.js');

/** No agent processes: execute/review are stubbed, and tests move tasks along by hand. */
function makeRunner() {
  const store = { broadcast: vi.fn(), values: () => [][Symbol.iterator]() };
  const runtime = { startProjectScan: vi.fn(), handleHookEvent: vi.fn() };
  // The agent-running methods are private; tests only need to see them called.
  const proto = TaskRunner.prototype as unknown as {
    execute: () => Promise<void>;
    review: (task: { stage?: string }) => Promise<void>;
  };
  const execute = vi.spyOn(proto, 'execute').mockImplementation(async () => {});
  const review = vi.spyOn(proto, 'review').mockImplementation(async (task) => {
    task.stage = 'reviewing';
  });
  const runner = new TaskRunner(store as never, runtime as never);
  return { runner, execute, review };
}

describe('TaskRunner scheduler', () => {
  let projectId: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-sched-test-'));
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
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it(`runs at most ${DEV_SLOTS} dev tasks; the rest queue and start as seats free up`, () => {
    const { runner, execute } = makeRunner();
    const tasks = Array.from({ length: DEV_SLOTS + 2 }, (_, i) =>
      runner.start(projectId, `t${i}`, 'do it'),
    );
    expect(tasks.filter((t) => t.status === 'preparing')).toHaveLength(DEV_SLOTS);
    expect(tasks.filter((t) => t.status === 'queued')).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(DEV_SLOTS);

    // One dev finishes: exactly one queued task takes its seat, oldest first.
    tasks[0].status = 'done';
    (runner as unknown as { changed(): void }).changed();
    expect(tasks[DEV_SLOTS].status).toBe('preparing');
    expect(tasks[DEV_SLOTS + 1].status).toBe('queued');
  });

  it(`runs at most ${QA_SLOTS} reviews; the rest wait on the QA pile`, () => {
    const { runner, review } = makeRunner();
    const internals = runner as unknown as { reviewQueue: string[]; changed(): void };
    const tasks = Array.from({ length: QA_SLOTS + 1 }, (_, i) =>
      runner.start(projectId, `r${i}`, 'do it'),
    );
    for (const t of tasks) {
      t.status = 'done';
      t.stage = 'review_queued';
      internals.reviewQueue.push(t.id);
    }
    internals.changed();
    expect(tasks.filter((t) => t.stage === 'reviewing')).toHaveLength(QA_SLOTS);
    expect(tasks.filter((t) => t.stage === 'review_queued')).toHaveLength(1);
    expect(review).toHaveBeenCalledTimes(QA_SLOTS);
  });

  it('queues a follow-up while every seat is busy, and the owner stopping it cancels it', () => {
    const { runner } = makeRunner();
    const tasks = Array.from({ length: DEV_SLOTS }, (_, i) =>
      runner.start(projectId, `b${i}`, 'do it'),
    );
    const idle = runner.start(projectId, 'idle', 'do it'); // queued: no seat
    expect(idle.status).toBe('queued');
    runner.stop(idle.id);
    expect(idle.status).toBe('stopped');
    tasks[0].status = 'done';
    (runner as unknown as { changed(): void }).changed();
    expect(idle.status).toBe('stopped'); // a stopped task never takes the freed seat
  });
});
