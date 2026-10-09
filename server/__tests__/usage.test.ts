import { describe, expect, it } from 'vitest';

import {
  parseNumstat,
  summarizeChanges,
  TranscriptUsage,
  usageFromModelUsage,
} from '../src/usage.js';

describe('usageFromModelUsage', () => {
  it('sums every model and keeps the reported cost', () => {
    const m = (i: number) => ({
      inputTokens: i,
      outputTokens: 10 * i,
      cacheReadInputTokens: 100 * i,
      cacheCreationInputTokens: 1000 * i,
    });
    expect(usageFromModelUsage({ opus: m(1), haiku: m(2) }, 0.5)).toEqual({
      costUsd: 0.5,
      inputTokens: 3,
      outputTokens: 30,
      cacheReadTokens: 300,
      cacheWriteTokens: 3000,
    });
  });
});

describe('parseNumstat + summarizeChanges', () => {
  it('prefixes repo folders and counts binary files without lines', () => {
    const files = parseNumstat('3\t1\tsrc/a.ts\n-\t-\tlogo.png\n', 'frontend/');
    expect(files).toEqual([
      { path: 'frontend/src/a.ts', added: 3, removed: 1 },
      { path: 'frontend/logo.png', added: 0, removed: 0 },
    ]);
    expect(summarizeChanges(files).changes).toEqual({ files: 2, added: 3, removed: 1 });
  });
});

describe('TranscriptUsage', () => {
  it('counts each API message once, latest record winning, and reports no cost', () => {
    const t = new TranscriptUsage();
    const rec = (id: string, out: number) => ({
      type: 'assistant',
      message: {
        id,
        usage: {
          input_tokens: 5,
          output_tokens: out,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 0,
        },
      },
    });
    expect(t.add(rec('m1', 2))).toBe(true);
    t.add(rec('m1', 40)); // same message, later content block
    t.add(rec('m2', 7));
    expect(t.add({ type: 'user', message: { content: 'x' } })).toBe(false);
    expect(t.add({ type: 'cost-state', totalCostUSD: 0.02 })).toBe(false);
    expect(t.totals()).toEqual({
      inputTokens: 10,
      outputTokens: 47,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
    });
  });
});
