import { describe, expect, it } from 'vitest';

import { parseRouterAnswer } from '../src/taskRouter.js';

describe('parseRouterAnswer', () => {
  it('only an explicit "false" skips the branch', () => {
    expect(parseRouterAnswer('false')).toBe(false);
    expect(parseRouterAnswer(' False.\n')).toBe(false);
    expect(parseRouterAnswer('true')).toBe(true);
  });

  it('anything unclear, empty or failed cuts a branch (the safe default)', () => {
    expect(parseRouterAnswer('')).toBe(true);
    expect(parseRouterAnswer('I think this is false')).toBe(true);
    expect(parseRouterAnswer('falsey')).toBe(true);
  });
});
