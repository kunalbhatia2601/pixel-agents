import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Project, Task } from '../../core/src/messages.js';

let tempHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tempHome };
});

// Must import AFTER mock setup.
const { getProject, saveProject } = await import('../src/projects.js');
const { onDesk, TaskRunner } = await import('../src/taskRunner.js');

interface DeskInternals {
  prepareWorktree(task: Task, project: Project, base: Record<string, string>): Promise<void>;
  buildHandoff(task: Task, project: Project): Promise<void>;
}

// Real git (init, worktree add/remove) is slow when the whole suite runs in parallel.
describe("the owner's desk", { timeout: 30_000 }, () => {
  let repo: string;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-desk-test-'));
    repo = path.join(tempHome, 'repo');
    fs.mkdirSync(repo);
    git('init', '-b', 'main');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
    git('remote', 'add', 'origin', 'https://pat123@dev.azure.com/acme/My%20Proj/_git/api');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('shows branch, links and push command; Done removes the worktree and keeps the branch', async () => {
    const proto = TaskRunner.prototype as unknown as { execute: () => Promise<void> };
    vi.spyOn(proto, 'execute').mockImplementation(async () => {});
    const store = { broadcast: vi.fn(), values: () => [][Symbol.iterator]() };
    const runner = new TaskRunner(store as never, { startProjectScan: vi.fn() } as never);
    const desk = runner as unknown as DeskInternals;

    const project = getProject(
      saveProject({
        id: '',
        name: 'P',
        repos: [{ name: 'api', path: repo, defaultBranch: 'main' }],
      }).id,
    )!;
    const task = runner.start(project.id, 'Fix it', 'do it');
    await desk.prepareWorktree(task, project, { api: 'main' }); // explicit base: no network fetch
    execFileSync('git', [
      '-C',
      task.worktree!,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      'commit',
      '--allow-empty',
      '-m',
      'work',
    ]);
    task.status = 'done';
    task.stage = 'approved';
    await desk.buildHandoff(task, project);

    expect(onDesk(task)).toBe(true);
    const [h] = task.handoff!;
    expect(h).toMatchObject({
      repo: 'api',
      branch: task.branch,
      baseBranch: 'main',
      repoUrl: 'https://dev.azure.com/acme/My%20Proj/_git/api',
      pushCommand: `git -C "${repo}" push -u origin ${task.branch}`,
      commits: 1,
    });
    expect(JSON.stringify(task.handoff)).not.toContain('pat123');

    await runner.complete(task.id);
    expect(task.stage).toBe('delivered');
    expect(onDesk(task)).toBe(false);
    expect(fs.existsSync(task.worktree!)).toBe(false);
    expect(git('branch', '--list', task.branch!)).toContain(task.branch); // branch kept
    expect(git('log', '--oneline', '-1', task.branch!)).toContain('work'); // with its commit
  });

  it('refuses Done while the agent is still working', async () => {
    const proto = TaskRunner.prototype as unknown as { execute: () => Promise<void> };
    vi.spyOn(proto, 'execute').mockImplementation(async () => {});
    const runner = new TaskRunner(
      { broadcast: vi.fn(), values: () => [][Symbol.iterator]() } as never,
      { startProjectScan: vi.fn() } as never,
    );
    const id = saveProject({
      id: '',
      name: 'P',
      repos: [{ name: 'api', path: repo, defaultBranch: 'main' }],
    }).id;
    const task = runner.start(id, 'Busy', 'do it');
    expect(task.status).toBe('preparing');
    await expect(runner.complete(task.id)).rejects.toThrow(/still working/);
  });
});
