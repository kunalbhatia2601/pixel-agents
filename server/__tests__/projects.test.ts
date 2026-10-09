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
const { deleteProject, getProject, listProjectFiles, listProjects, saveProject } =
  await import('../src/projects.js');

describe('projects', () => {
  let repo: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-projects-test-'));
    repo = path.join(tempHome, 'repo');
    fs.mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('init', '-b', 'develop');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init');
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('creates, lists, updates and deletes a project with docs/ and memory/ folders', () => {
    const created = saveProject({
      id: '',
      name: ' Svc ',
      repoPath: '~/repo',
      defaultBranch: 'develop',
    });
    expect(created.name).toBe('Svc');
    expect(created.repoPath).toBe(repo);
    expect(fs.existsSync(path.join(created.dir!, 'docs'))).toBe(true);
    expect(listProjects().map((p) => p.id)).toEqual([created.id]);

    fs.writeFileSync(path.join(created.dir!, 'docs', 'arch.md'), '# arch');
    expect(listProjectFiles(created, 'docs')).toEqual(['arch.md']);

    saveProject({ ...created, testCommand: 'npm test' });
    expect(getProject(created.id)?.testCommand).toBe('npm test');

    deleteProject(created.id);
    expect(listProjects()).toEqual([]);
    expect(fs.existsSync(repo)).toBe(true);
  });

  it('rejects a path that is not a git repo, and a missing branch', () => {
    expect(() =>
      saveProject({ id: '', name: 'x', repoPath: tempHome + '/nope', defaultBranch: 'main' }),
    ).toThrow(/Not a git repository/);
    expect(() => saveProject({ id: '', name: 'x', repoPath: repo, defaultBranch: 'main' })).toThrow(
      /Branch "main" not found/,
    );
  });

  it('refuses ids that could escape the projects folder', () => {
    expect(() => deleteProject('../../.ssh')).toThrow(/Invalid project id/);
    expect(() =>
      saveProject({ id: '../evil', name: 'x', repoPath: repo, defaultBranch: 'develop' }),
    ).toThrow(/Invalid project id/);
  });
});

describe('agent settings', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-settings-test-'));
  });
  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('drops empty and unknown values so they inherit', async () => {
    const { cleanAgentSettings } = await import('../src/projects.js');
    expect(
      cleanAgentSettings({ model: '  ', effort: 'turbo' as never, thinking: 'adaptive' }),
    ).toEqual({
      thinking: 'adaptive',
    });
    expect(cleanAgentSettings({})).toBeUndefined();
    expect(cleanAgentSettings(undefined)).toBeUndefined();
  });

  it('round-trips global defaults', async () => {
    const { getAgentDefaults, saveAgentDefaults } = await import('../src/projects.js');
    expect(getAgentDefaults()).toEqual({});
    saveAgentDefaults({ model: 'opus', effort: 'high' });
    expect(getAgentDefaults()).toEqual({ model: 'opus', effort: 'high' });
  });
});
