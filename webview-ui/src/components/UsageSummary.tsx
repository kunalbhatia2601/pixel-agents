import type { CodeChanges, UsageTotals } from '../../../core/src/messages.js';
import { formatCost, formatTokens } from '../usageFormat.js';

interface UsageSummaryProps {
  usage?: UsageTotals;
  changes?: CodeChanges;
  /** One line for lists; the full breakdown otherwise. */
  compact?: boolean;
}

/** Tokens, estimated cost and code changes for a chat, task or project. */
export function UsageSummary({ usage, changes, compact }: UsageSummaryProps) {
  if (!usage && !changes) return null;
  const code = changes && (
    <span title="Files changed, lines added and removed (vs the default branch)">
      {changes.files} {changes.files === 1 ? 'file' : 'files'}{' '}
      <span className="text-status-success">+{changes.added}</span>{' '}
      <span className="text-status-error">−{changes.removed}</span>
    </span>
  );
  if (compact) {
    return (
      <span className="text-sm text-text-muted flex flex-wrap gap-x-8">
        {usage && (
          <span>
            {formatCost(usage.costUsd)} ·{' '}
            {formatTokens(
              usage.inputTokens +
                usage.outputTokens +
                usage.cacheReadTokens +
                usage.cacheWriteTokens,
            )}{' '}
            tokens
          </span>
        )}
        {code}
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-2 text-sm text-text-muted">
      {usage && (
        <>
          <span
            title={
              usage.costUsd === undefined
                ? 'Cost is only known for agents started as tasks here'
                : 'Estimated by Claude Code, not a billing statement'
            }
          >
            Cost <span className="text-text">{formatCost(usage.costUsd)}</span>
          </span>
          <span>
            In <span className="text-text">{formatTokens(usage.inputTokens)}</span>
          </span>
          <span>
            Out <span className="text-text">{formatTokens(usage.outputTokens)}</span>
          </span>
          <span title="Prompt cache reads (cheap) and writes">
            Cache <span className="text-text">{formatTokens(usage.cacheReadTokens)}</span> read /{' '}
            <span className="text-text">{formatTokens(usage.cacheWriteTokens)}</span> write
          </span>
        </>
      )}
      {code}
    </div>
  );
}
