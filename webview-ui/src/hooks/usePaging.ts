import { useState } from 'react';

/** Page count and the requested page clamped into range (a shrinking list never shows an empty page). */
export function pageWindow(total: number, pageSize: number, requested: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(0, requested), pages - 1);
  return { pages, page, start: page * pageSize, end: (page + 1) * pageSize };
}

/** Splits a list into pages. The page clamps into range when the list shrinks (e.g. tasks finish). */
export function usePaging<T>(items: T[], pageSize: number) {
  const [requested, setRequested] = useState(0);
  const { pages, page, start, end } = pageWindow(items.length, pageSize, requested);
  return {
    pageItems: items.slice(start, end),
    page,
    pages,
    prev: () => setRequested(Math.max(0, page - 1)),
    next: () => setRequested(Math.min(pages - 1, page + 1)),
    reset: () => setRequested(0),
  };
}
