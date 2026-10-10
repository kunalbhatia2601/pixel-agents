import * as fs from 'fs';

import type { ChatEntry, UsageTotals } from '../../core/src/messages.js';
import { TranscriptUsage } from './usage.js';

/** Replies and prompts are what the owner reads: only a runaway message is cut. */
const TEXT_MAX_CHARS = 200_000;
/** Thinking is collapsed by default; long chains are trimmed. */
const THINKING_MAX_CHARS = 20_000;
/** Tool calls and output can be huge (file dumps, logs): a preview is enough. */
const TOOL_MAX_CHARS = 1500;
/** History sent when a chat opens; long sessions would otherwise ship megabytes. */
const HISTORY_MAX_ENTRIES = 300;
const POLL_MS = 500;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more chars)` : text;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b: { type?: string; text?: string }) => (b?.type === 'text' ? (b.text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** One Claude Code transcript line → the chat entries a human cares about. */
export function chatEntriesFromLine(line: string): ChatEntry[] {
  const record = parseRecord(line);
  return record ? chatEntriesFromRecord(record) : [];
}

function chatEntriesFromRecord(record: Record<string, unknown>): ChatEntry[] {
  if (record.isMeta) return [];
  const message = record.message as { content?: unknown } | undefined;
  const ts = typeof record.timestamp === 'string' ? record.timestamp : undefined;
  const entries: ChatEntry[] = [];

  if (record.type === 'user' && message) {
    if (typeof message.content === 'string') {
      if (message.content.trim()) {
        entries.push({ kind: 'user', text: clip(message.content, TEXT_MAX_CHARS), ts });
      }
      return entries;
    }
    for (const block of (message.content as Array<Record<string, unknown>>) ?? []) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        entries.push({ kind: 'user', text: clip(block.text, TEXT_MAX_CHARS), ts });
      } else if (block.type === 'tool_result') {
        const text = blockText(block.content);
        if (text) entries.push({ kind: 'toolResult', text: clip(text, TOOL_MAX_CHARS), ts });
      }
    }
  } else if (record.type === 'assistant' && message) {
    for (const block of (message.content as Array<Record<string, unknown>>) ?? []) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        entries.push({ kind: 'assistant', text: clip(block.text, TEXT_MAX_CHARS), ts });
      } else if (
        block.type === 'thinking' &&
        typeof block.thinking === 'string' &&
        block.thinking
      ) {
        entries.push({ kind: 'thinking', text: clip(block.thinking, THINKING_MAX_CHARS), ts });
      } else if (block.type === 'tool_use') {
        const input = block.input as Record<string, unknown> | undefined;
        const text =
          typeof input?.command === 'string'
            ? input.command
            : typeof input?.file_path === 'string'
              ? input.file_path
              : JSON.stringify(input ?? {});
        entries.push({
          kind: 'tool',
          toolName: String(block.name),
          text: clip(text, TOOL_MAX_CHARS),
          ts,
        });
      }
    }
  }
  return entries;
}

/** usage is included when the transcript's token totals changed (always on reset). */
type Send = (entries: ChatEntry[], reset: boolean, usage?: UsageTotals) => void;

/** Tails one transcript for one client: full (capped) history first, then appended lines. */
export class ChatTail {
  private offset = 0;
  private partial = '';
  private usage = new TranscriptUsage();
  private usageChanged = false;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private file: string,
    private send: Send,
  ) {
    const history = this.readNew();
    this.send(history.slice(-HISTORY_MAX_ENTRIES), true, this.takeUsage(true));
    this.timer = setInterval(() => {
      const entries = this.readNew();
      const usage = this.takeUsage(false);
      if (entries.length || usage) this.send(entries, false, usage);
    }, POLL_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  private takeUsage(force: boolean): UsageTotals | undefined {
    if (!force && !this.usageChanged) return undefined;
    this.usageChanged = false;
    return this.usage.totals();
  }

  private readNew(): ChatEntry[] {
    let chunk: string;
    try {
      const size = fs.statSync(this.file).size;
      if (size < this.offset) this.offset = 0; // file replaced
      if (size === this.offset) return [];
      const fd = fs.openSync(this.file, 'r');
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      fs.closeSync(fd);
      this.offset = size;
      chunk = this.partial + buf.toString('utf-8');
    } catch {
      return []; // not written yet
    }
    const lines = chunk.split('\n');
    this.partial = lines.pop() ?? ''; // carry an unterminated line to the next read
    return lines.flatMap((line) => {
      const record = line.trim() ? parseRecord(line) : null;
      if (!record) return [];
      if (this.usage.add(record)) this.usageChanged = true;
      return chatEntriesFromRecord(record);
    });
  }
}
