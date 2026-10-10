import type { ChangedFile, CodeChanges, UsageTotals } from '../../core/src/messages.js';

/** Most files kept per task for the chat's changed-files list. */
const CHANGED_FILES_MAX = 200;

interface ModelUsageLike {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** The SDK's per-model running totals → one total. Each result carries the session total so far. */
export function usageFromModelUsage(
  modelUsage: Record<string, ModelUsageLike> | undefined,
  costUsd: number | undefined,
): UsageTotals {
  const totals: UsageTotals = {
    costUsd,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const m of Object.values(modelUsage ?? {})) {
    totals.inputTokens += m.inputTokens ?? 0;
    totals.outputTokens += m.outputTokens ?? 0;
    totals.cacheReadTokens += m.cacheReadInputTokens ?? 0;
    totals.cacheWriteTokens += m.cacheCreationInputTokens ?? 0;
  }
  return totals;
}

/** Sum of two totals (separate queries, e.g. successive QA reviews); cost stays unknown only if both are. */
export function addUsage(a: UsageTotals | undefined, b: UsageTotals): UsageTotals {
  if (!a) return b;
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

/** `git diff --numstat` output → files, prefixed with the repo folder for multi-repo tasks. */
export function parseNumstat(output: string, prefix = ''): ChangedFile[] {
  return output
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 3)
    .map(([added, removed, ...rest]) => ({
      path: prefix + rest.join('\t'),
      // Binary files report "-": they changed, but have no line counts.
      added: Number(added) || 0,
      removed: Number(removed) || 0,
    }));
}

export function summarizeChanges(files: ChangedFile[]): {
  changes: CodeChanges;
  changedFiles: ChangedFile[];
} {
  return {
    changes: {
      files: files.length,
      added: files.reduce((n, f) => n + f.added, 0),
      removed: files.reduce((n, f) => n + f.removed, 0),
    },
    changedFiles: files.slice(0, CHANGED_FILES_MAX),
  };
}

/**
 * Token totals from a Claude Code transcript, for agents this server doesn't run.
 * One API message is written as several records (one per content block) that repeat its usage,
 * so usage is kept per message id, latest record winning.
 */
export class TranscriptUsage {
  private perMessage = new Map<string, Omit<UsageTotals, 'costUsd'>>();

  /** Returns true when the totals changed. */
  add(record: Record<string, unknown>): boolean {
    const message = record.message as
      { id?: string; usage?: Record<string, number | undefined> } | undefined;
    if (record.type !== 'assistant' || !message?.id || !message.usage) return false;
    const u = message.usage;
    this.perMessage.set(message.id, {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    });
    return true;
  }

  totals(): UsageTotals {
    // No cost: the transcript's cost-state record is written only now and then and reads stale.
    const t: UsageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    for (const u of this.perMessage.values()) {
      t.inputTokens += u.inputTokens;
      t.outputTokens += u.outputTokens;
      t.cacheReadTokens += u.cacheReadTokens;
      t.cacheWriteTokens += u.cacheWriteTokens;
    }
    return t;
  }
}
