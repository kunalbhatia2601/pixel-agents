import { Button } from './ui/Button.js';

interface PagerProps {
  page: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
  /** Smaller variant for the room boards. */
  compact?: boolean;
}

/** "‹ Prev · Page 2 of 5 · Next ›" — hidden when everything fits on one page. */
export function Pager({ page, pages, onPrev, onNext, compact }: PagerProps) {
  if (pages <= 1) return null;
  if (compact) {
    return (
      <span className="flex items-center gap-2 text-2xs">
        <button
          className="px-2 cursor-pointer disabled:opacity-30"
          onClick={onPrev}
          disabled={page === 0}
          aria-label="Previous page"
        >
          ‹
        </button>
        {page + 1}/{pages}
        <button
          className="px-2 cursor-pointer disabled:opacity-30"
          onClick={onNext}
          disabled={page === pages - 1}
          aria-label="Next page"
        >
          ›
        </button>
      </span>
    );
  }
  return (
    <div className="flex items-center justify-center gap-6">
      <Button
        size="sm"
        variant={page === 0 ? 'disabled' : 'default'}
        disabled={page === 0}
        onClick={onPrev}
      >
        ‹ Prev
      </Button>
      <span className="text-sm text-text-muted">
        Page {page + 1} of {pages}
      </span>
      <Button
        size="sm"
        variant={page === pages - 1 ? 'disabled' : 'default'}
        disabled={page === pages - 1}
        onClick={onNext}
      >
        Next ›
      </Button>
    </div>
  );
}
