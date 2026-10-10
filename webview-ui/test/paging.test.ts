import assert from 'node:assert/strict';

import { test } from 'vitest';

import { pageWindow } from '../src/hooks/usePaging.js';

test('pages a list and clamps the page when the list shrinks', () => {
  assert.deepEqual(pageWindow(45, 20, 0), { pages: 3, page: 0, start: 0, end: 20 });
  assert.deepEqual(pageWindow(45, 20, 2), { pages: 3, page: 2, start: 40, end: 60 });
  // On page 3 of 3, tasks finish and only 15 remain: back to the last real page, never an empty one.
  assert.deepEqual(pageWindow(15, 20, 2), { pages: 1, page: 0, start: 0, end: 20 });
  assert.deepEqual(pageWindow(0, 20, 0), { pages: 1, page: 0, start: 0, end: 20 });
});
