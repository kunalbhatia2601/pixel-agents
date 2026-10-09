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

  const r = (over: Record<string, string> = {}) => ({
    name: '',
    path: repo,
    defaultBranch: 'develop',
    ...over,
  });

  it('creates, lists, updates and deletes a project with docs/ and memory/ folders', () => {
    const created = saveProject({ id: '', name: ' Svc ', repos: [r({ path: '~/repo' })] });
    expect(created.name).toBe('Svc');
    expect(created.repos).toEqual([{ name: 'repo', path: repo, defaultBranch: 'develop' }]);
    expect(fs.existsSync(path.join(created.dir!, 'docs'))).toBe(true);
    expect(listProjects().map((p) => p.id)).toEqual([created.id]);

    fs.writeFileSync(path.join(created.dir!, 'docs', 'arch.md'), '# arch');
    expect(listProjectFiles(created, 'docs')).toEqual(['arch.md']);

    saveProject({ ...created, repos: [r({ testCommand: 'npm test' })] });
    expect(getProject(created.id)?.repos[0].testCommand).toBe('npm test');

    deleteProject(created.id);
    expect(listProjects()).toEqual([]);
    expect(fs.existsSync(repo)).toBe(true);
  });

  it('holds several repos as a workspace, with unique folder names', () => {
    const p = saveProject({
      id: '',
      name: 'XYZ',
      repos: [r({ name: 'Front End' }), r({ name: 'backend' })],
    });
    expect(p.repos.map((x) => x.name)).toEqual(['front-end', 'backend']);
    expect(() =>
      saveProject({ id: '', name: 'XYZ', repos: [r({ name: 'api' }), r({ name: 'API' })] }),
    ).toThrow(/share the folder name "api"/);
    expect(() => saveProject({ id: '', name: 'XYZ', repos: [] })).toThrow(/at least one repo/);
  });

  it('reads a pre-workspace single-repo project.json as one repo', () => {
    const p = saveProject({ id: '', name: 'Old', repos: [r()] });
    fs.writeFileSync(
      path.join(p.dir!, 'project.json'),
      JSON.stringify({
        id: p.id,
        name: 'Old',
        repoPath: repo,
        defaultBranch: 'develop',
        testCommand: 't',
      }),
    );
    expect(getProject(p.id)?.repos).toEqual([
      {
        name: 'repo',
        path: repo,
        defaultBranch: 'develop',
        setupCommand: undefined,
        testCommand: 't',
      },
    ]);
  });

  it('rejects a path that is not a git repo, and a missing branch', () => {
    expect(() =>
      saveProject({ id: '', name: 'x', repos: [r({ path: tempHome + '/nope' })] }),
    ).toThrow(/Not a git repository/);
    expect(() => saveProject({ id: '', name: 'x', repos: [r({ defaultBranch: 'main' })] })).toThrow(
      /Branch "main" not found/,
    );
  });

  it('refuses ids that could escape the projects folder', () => {
    expect(() => deleteProject('../../.ssh')).toThrow(/Invalid project id/);
    expect(() => saveProject({ id: '../evil', name: 'x', repos: [r()] })).toThrow(
      /Invalid project id/,
    );
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
