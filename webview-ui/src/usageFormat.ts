import type { CodeChanges, Task, UsageTotals } from '../../core/src/messages.js';

/** 950 → "950", 12_300 → "12.3k", 4_560_000 → "4.56M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return '—';
  return usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

export function addUsageTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    costUsd:
      a.costUsd === undefined && b.costUsd === undefined
        ? undefined
        : (a.costUsd ?? 0) + (b.costUsd ?? 0),
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Totals across tasks (a project's): tokens and cost add up, as do diff counts. QA spend included. */
export function sumTasks(tasks: Task[]): { usage: UsageTotals; changes: CodeChanges } {
  const usage: UsageTotals = {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const changes: CodeChanges = { files: 0, added: 0, removed: 0 };
  for (const t of tasks) {
    for (const u of [t.usage, t.reviewUsage]) {
      if (!u) continue;
      usage.costUsd! += u.costUsd ?? 0;
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.cacheReadTokens += u.cacheReadTokens;
      usage.cacheWriteTokens += u.cacheWriteTokens;
    }
    if (t.changes) {
      changes.files += t.changes.files;
      changes.added += t.changes.added;
      changes.removed += t.changes.removed;
    }
  }
  return { usage, changes };
}
