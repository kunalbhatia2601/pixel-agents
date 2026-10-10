import { describe, expect, it } from 'vitest';

import { feedbackMessage, parseVerdict } from '../src/reviewer.js';

describe('parseVerdict', () => {
  it('re-derives approval: a blocker or major comment always rejects', () => {
    const v = parseVerdict({
      approved: true,
      summary: 'ok',
      testsRun: ['npm test: pass'],
      comments: [{ severity: 'major', title: 'Off by one', detail: 'Loop skips the last item' }],
    });
    expect(v.approved).toBe(false);
    expect(
      parseVerdict({
        approved: true,
        summary: 's',
        comments: [{ severity: 'nit', title: 't', detail: 'd' }],
        testsRun: [],
      }).approved,
    ).toBe(true);
  });

  it('treats unknown severities as major and junk as no verdict', () => {
    const v = parseVerdict({
      approved: true,
      comments: [{ severity: 'critical', title: 't', detail: 'd' }],
    });
    expect(v.comments[0].severity).toBe('major');
    expect(v.approved).toBe(false);
    expect(() => parseVerdict(undefined)).toThrow(/no verdict/);
  });
});

describe('feedbackMessage', () => {
  it('lists comments with severity, location and fix, and asks for commits', () => {
    const text = feedbackMessage(
      {
        round: 1,
        at: 0,
        approved: false,
        summary: 'Two problems.',
        comments: [
          {
            severity: 'blocker',
            title: 'Crash on empty list',
            detail: 'max([]) throws',
            file: 'src/a.ts',
            line: 12,
            suggestion: 'Guard empty input',
          },
        ],
      },
      3,
    );
    expect(text).toContain('round 1 of 3');
    expect(text).toContain('1. [BLOCKER] Crash on empty list (src/a.ts:12)');
    expect(text).toContain('Suggested fix: Guard empty input');
    expect(text).toContain('commit');
  });
});
