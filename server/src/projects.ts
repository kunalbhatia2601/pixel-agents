import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentSettings, Project, ProjectRepo } from '../../core/src/messages.js';
import { SERVER_JSON_DIR } from './constants.js';

/** Project Room storage: ~/.pixel-agents/projects/<id>/{project.json,docs/,memory/}. */
const projectsRoot = () => path.join(os.homedir(), SERVER_JSON_DIR, 'projects');

function projectDir(id: string): string {
  // ids are server-minted UUIDs; reject anything else so a client can't path-traverse
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`Invalid project id: ${id}`);
  }
  return path.join(projectsRoot(), id);
}

export function listProjects(): Project[] {
  let ids: string[];
  try {
    ids = fs.readdirSync(projectsRoot());
  } catch {
    return [];
  }
  const projects: Project[] = [];
  for (const id of ids) {
    const project = getProject(id);
    if (project) projects.push(project);
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/** Single-repo project.json files written before workspaces existed. */
interface LegacyProject {
  repoPath?: string;
  defaultBranch?: string;
  setupCommand?: string;
  testCommand?: string;
}

export function getProject(id: string): Project | null {
  try {
    const dir = projectDir(id);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf-8')) as Project &
      LegacyProject;
    const { repoPath, defaultBranch, setupCommand, testCommand, ...project } = raw;
    if (!project.repos && repoPath && defaultBranch) {
      project.repos = [
        { name: path.basename(repoPath), path: repoPath, defaultBranch, setupCommand, testCommand },
      ];
    }
    return { ...project, id, dir };
  } catch {
    return null;
  }
}

function validateRepo(input: ProjectRepo): ProjectRepo {
  const repoPath = path.resolve(input.path.trim().replace(/^~(?=$|\/)/, os.homedir()));
  const defaultBranch = input.defaultBranch.trim();
  const name = slugify(input.name || path.basename(repoPath));
  if (!defaultBranch) throw new Error(`Default branch is required for ${repoPath}`);
  try {
    execFileSync('git', ['-C', repoPath, 'rev-parse', '--git-dir'], { stdio: 'ignore' });
  } catch {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
  try {
    execFileSync('git', ['-C', repoPath, 'rev-parse', '--verify', '--quiet', defaultBranch], {
      stdio: 'ignore',
    });
  } catch {
    throw new Error(`Branch "${defaultBranch}" not found in ${repoPath}`);
  }
  return {
    name,
    path: repoPath,
    defaultBranch,
    setupCommand: input.setupCommand?.trim() || undefined,
    testCommand: input.testCommand?.trim() || undefined,
  };
}

/** Folder-safe repo name: it becomes a directory inside each task's workspace. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'repo'
  );
}

/** Validates every repo + branch, then writes atomically. Empty id = create. */
export function saveProject(input: Project): Project {
  const name = input.name.trim();
  if (!name) throw new Error('Project name is required');
  if (!input.repos?.length) throw new Error('Add at least one repo');
  const repos = input.repos.map(validateRepo);
  const names = repos.map((r) => r.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`Two repos would share the folder name "${dup}"; rename one`);

  const id = input.id || crypto.randomUUID();
  const dir = projectDir(id);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const project: Project = {
    id,
    name,
    repos,
    agent: cleanAgentSettings(input.agent),
    maxReviewRounds: cleanReviewRounds(input.maxReviewRounds),
  };
  writeJson(path.join(dir, 'project.json'), project);
  return { ...project, dir };
}

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const THINKING = new Set(['adaptive', 'disabled']);

/** Keeps only known, non-empty fields, so empty form inputs mean "inherit". Undefined when nothing is set. */
export function cleanAgentSettings(input: AgentSettings | undefined): AgentSettings | undefined {
  const out: AgentSettings = {};
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  if (model) out.model = model;
  if (input?.effort && EFFORTS.has(input.effort)) out.effort = input.effort;
  if (input?.thinking && THINKING.has(input.thinking)) out.thinking = input.thinking;
  return Object.keys(out).length ? out : undefined;
}

const defaultsFile = () => path.join(os.homedir(), SERVER_JSON_DIR, 'agent-defaults.json');

/** agent-defaults.json: the dev defaults at the top level, the QA reviewer's under `reviewer`. */
function readDefaultsFile(): AgentSettings & { reviewer?: AgentSettings } {
  try {
    return JSON.parse(fs.readFileSync(defaultsFile(), 'utf-8'));
  } catch {
    return {};
  }
}

export function getAgentDefaults(): AgentSettings {
  return cleanAgentSettings(readDefaultsFile()) ?? {};
}

/** Reviewer overrides on top of the task's own settings (e.g. a stronger model for QA). */
export function getReviewerDefaults(): AgentSettings {
  return cleanAgentSettings(readDefaultsFile().reviewer) ?? {};
}

export function saveAgentDefaults(
  input: AgentSettings,
  reviewerInput?: AgentSettings,
): { defaults: AgentSettings; reviewer: AgentSettings } {
  const defaults = cleanAgentSettings(input) ?? {};
  const reviewer = cleanAgentSettings(reviewerInput) ?? {};
  fs.mkdirSync(path.dirname(defaultsFile()), { recursive: true });
  writeJson(defaultsFile(), { ...defaults, reviewer });
  return { defaults, reviewer };
}

/** Review rounds a project allows per task: a whole number 0–10 (0 turns QA off), else undefined (default). */
function cleanReviewRounds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10
    ? value
    : undefined;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(`${file}.tmp`, file);
}

/** Removes the project's record, docs and memory. Never touches the repo itself. */
export function deleteProject(id: string): void {
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

/** Files directly under a project's subfolder, for the brief's index. */
export function listProjectFiles(project: Project, sub: 'docs' | 'memory'): string[] {
  try {
    return fs
      .readdirSync(path.join(project.dir!, sub), { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
