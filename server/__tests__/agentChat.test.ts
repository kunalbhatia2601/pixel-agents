import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEntry } from '../../core/src/messages.js';
import { chatEntriesFromLine, ChatTail } from '../src/agentChat.js';

const line = (record: unknown) => JSON.stringify(record);

describe('chatEntriesFromLine', () => {
  it('maps prompts, replies, thinking, tool calls and tool results', () => {
    expect(
      chatEntriesFromLine(line({ type: 'user', message: { content: 'fix the bug' } })),
    ).toEqual([{ kind: 'user', text: 'fix the bug', ts: undefined }]);
    const assistant = chatEntriesFromLine(
      line({
        type: 'assistant',
        timestamp: 't1',
        message: {
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'text', text: 'On it.' },
            { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts', old_string: 'x' } },
          ],
        },
      }),
    );
    expect(assistant.map((e) => [e.kind, e.toolName, e.text])).toEqual([
      ['thinking', undefined, 'hmm'],
      ['assistant', undefined, 'On it.'],
      ['tool', 'Bash', 'npm test'],
      ['tool', 'Edit', '/a.ts'],
    ]);
    const result = chatEntriesFromLine(
      line({
        type: 'user',
        message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ok' }] }] },
      }),
    );
    expect(result).toEqual([{ kind: 'toolResult', text: 'ok', ts: undefined }]);
  });

  it('ignores meta records, other record types and malformed lines', () => {
    expect(
      chatEntriesFromLine(line({ type: 'user', isMeta: true, message: { content: 'x' } })),
    ).toEqual([]);
    expect(chatEntriesFromLine(line({ type: 'system', subtype: 'turn_duration' }))).toEqual([]);
    expect(chatEntriesFromLine('{not json')).toEqual([]);
  });

  it('keeps long replies whole and clips only tool output', () => {
    const [reply] = chatEntriesFromLine(
      line({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'a'.repeat(10000) }] },
      }),
    );
    expect(reply.text).toHaveLength(10000);
    const [result] = chatEntriesFromLine(
      line({
        type: 'user',
        message: { content: [{ type: 'tool_result', content: 'b'.repeat(5000) }] },
      }),
    );
    expect(result.text).toContain('3500 more chars');
  });
});

describe('ChatTail', () => {
  let tail: ChatTail | undefined;
  let dir: string;
  afterEach(() => {
    tail?.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sends history with reset, then appended lines, carrying partial lines', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-chat-'));
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(file, line({ type: 'user', message: { content: 'one' } }) + '\n');
    const calls: Array<[string[], boolean]> = [];
    tail = new ChatTail(file, (entries: ChatEntry[], reset) =>
      calls.push([entries.map((e) => e.text), reset]),
    );
    expect(calls).toEqual([[['one'], true]]);

    const two = line({ type: 'user', message: { content: 'two' } });
    fs.appendFileSync(file, two.slice(0, 10)); // half a line: nothing yet
    await new Promise((r) => setTimeout(r, 700));
    fs.appendFileSync(file, two.slice(10) + '\n');
    await new Promise((r) => setTimeout(r, 700));
    expect(calls.slice(1)).toEqual([[['two'], false]]);
  });
});
