import { describe, expect, it } from 'vitest';

import type { Project } from '../../core/src/messages.js';
import { cleanBaseBranches } from '../src/taskRunner.js';

const project: Project = {
  id: 'p',
  name: 'XYZ',
  repos: [
    { name: 'frontend', path: '/fe', defaultBranch: 'main' },
    { name: 'backend', path: '/be', defaultBranch: 'develop' },
  ],
};

describe('cleanBaseBranches', () => {
  it("keeps the project's repos only and drops blanks (blank = default branch)", () => {
    expect(
      cleanBaseBranches(project, { frontend: ' origin/feature/x ', backend: '', other: 'main' }),
    ).toEqual({ frontend: 'origin/feature/x' });
    expect(cleanBaseBranches(project, undefined)).toEqual({});
  });

  it('refuses names git would read as an option, or with whitespace', () => {
    expect(() => cleanBaseBranches(project, { frontend: '--upload-pack=evil' })).toThrow(
      /Invalid branch name/,
    );
    expect(() => cleanBaseBranches(project, { backend: 'a b' })).toThrow(/Invalid branch name/);
  });
});
