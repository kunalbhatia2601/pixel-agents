import type { ReviewRecord, ReviewSeverity } from '../../../core/src/messages.js';

const SEVERITY_CLASS: Record<ReviewSeverity, string> = {
  blocker: 'text-status-error',
  major: 'text-warning',
  minor: 'text-status-permission',
  nit: 'text-text-muted',
};

/** Every QA round of a task: verdict, summary, tests run and each comment. Newest first. */
export function ReviewHistory({ reviews }: { reviews: ReviewRecord[] }) {
  if (!reviews.length) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-text-muted">QA reviews ({reviews.length})</summary>
      <div className="flex flex-col gap-6 max-h-[260px] overflow-y-auto pt-4 pr-4">
        {[...reviews].reverse().map((r) => (
          <div key={r.round} className="border-2 border-border p-4 flex flex-col gap-2">
            <span>
              Round {r.round}:{' '}
              {r.error ? (
                <span className="text-status-error">review failed — {r.error}</span>
              ) : r.approved ? (
                <span className="text-status-success">approved</span>
              ) : (
                <span className="text-warning">changes requested</span>
              )}
            </span>
            {r.summary && <span className="text-text-muted whitespace-pre-wrap">{r.summary}</span>}
            {(r.comments ?? []).map((c, i) => (
              <div key={i} className="flex flex-col">
                <span>
                  <span className={SEVERITY_CLASS[c.severity]}>[{c.severity}]</span> {c.title}
                  {c.file && (
                    <span className="font-mono text-xs text-text-muted">
                      {' '}
                      {c.file}
                      {c.line ? `:${c.line}` : ''}
                    </span>
                  )}
                </span>
                <span className="text-xs text-text-muted whitespace-pre-wrap">{c.detail}</span>
                {c.suggestion && (
                  <span className="text-xs whitespace-pre-wrap">Fix: {c.suggestion}</span>
                )}
              </div>
            ))}
            {!!r.testsRun?.length && (
              <details className="text-xs">
                <summary className="cursor-pointer text-text-muted">
                  Tests run ({r.testsRun.length})
                </summary>
                <ul className="list-disc pl-10">
                  {r.testsRun.map((t, i) => (
                    <li key={i} className="whitespace-pre-wrap">
                      {t}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
