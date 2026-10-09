import { describe, expect, it } from 'vitest';

import { inputQueue } from '../src/taskRunner.js';

describe('inputQueue', () => {
  it('yields queued and later-pushed messages in order, then ends', async () => {
    const q = inputQueue();
    q.push('first');
    const seen: string[] = [];
    const done = (async () => {
      for await (const m of q.messages()) seen.push(m.message.content);
    })();
    await new Promise((r) => setTimeout(r, 10));
    q.push('second');
    await new Promise((r) => setTimeout(r, 10));
    q.end();
    await done;
    expect(seen).toEqual(['first', 'second']);
  });
});
