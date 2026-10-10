import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import type { Project, Task } from '../../core/src/messages.js';
import { editOutsideWorkspace } from '../src/taskRunner.js';

const task = { worktree: '/wt/proj/abc' } as Task;
const project = { dir: '/home/me/.pixel-agents/projects/p1', repos: [] } as unknown as Project;

describe('editOutsideWorkspace', () => {
  it('allows edits in the worktree, the project folder and the plans folder', () => {
    for (const file of [
      'src/a.ts',
      '/wt/proj/abc/b.ts',
      '/home/me/.pixel-agents/projects/p1/docs/x.md',
      path.join(os.homedir(), '.claude', 'plans', 'plan.md'),
    ]) {
      expect(editOutsideWorkspace(task, project, 'Write', { file_path: file })).toBeUndefined();
    }
  });

  it("flags edits outside, including look-alike prefixes and '..' escapes", () => {
    expect(editOutsideWorkspace(task, project, 'Edit', { file_path: '/Users/me/repo/x.js' })).toBe(
      '/Users/me/repo/x.js',
    );
    expect(editOutsideWorkspace(task, project, 'Write', { file_path: '/wt/proj/abc-qa/x' })).toBe(
      '/wt/proj/abc-qa/x',
    );
    expect(editOutsideWorkspace(task, project, 'Write', { file_path: '../../etc/x' })).toBe(
      '/wt/etc/x',
    );
  });

  it('ignores read-only tasks (they cannot edit at all) and tools that are not file edits', () => {
    expect(
      editOutsideWorkspace({ ...task, readOnly: true }, project, 'Write', { file_path: '/x' }),
    ).toBeUndefined();
    expect(editOutsideWorkspace(task, project, 'Bash', { command: 'rm /x' })).toBeUndefined();
  });
});
