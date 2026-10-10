import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from 'vitest';

import { projectShelves } from '../src/office/layout/projectShelves.js';
import type { OfficeLayout } from '../src/office/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the bundled store room has 12 shelves: 4 on the wall first, then the floor rows', () => {
  const layout = JSON.parse(
    readFileSync(path.join(root, 'public/assets/default-layout-5.json'), 'utf8'),
  ) as OfficeLayout;
  const shelves = projectShelves(layout);
  assert.equal(shelves.length, 12);
  assert.deepEqual(
    shelves.slice(0, 5).map((s) => [s.row, s.col]),
    [
      [21, 11],
      [21, 17],
      [21, 19],
      [21, 21],
      [25, 12],
    ],
  );
});

test('shelves outside the Project Directory area are ignored', () => {
  const layout: OfficeLayout = {
    version: 1,
    cols: 4,
    rows: 4,
    tiles: Array(16).fill(1),
    furniture: [
      { uid: 'in', type: 'DOUBLE_BOOKSHELF', col: 0, row: 2 },
      { uid: 'out', type: 'DOUBLE_BOOKSHELF', col: 2, row: 2 },
      { uid: 'chair', type: 'WOODEN_CHAIR_SIDE', col: 1, row: 3 },
    ],
    areaTiles: Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? 'Project Directory' : null)),
  };
  assert.deepEqual(projectShelves(layout), [{ col: 0, row: 2, width: 2 }]);
});

test('the bundled Tasks room has Live over All, left of the Dev Team and Project Directory', async () => {
  const { areaBounds } = await import('../src/office/layout/projectShelves.js');
  const layout = JSON.parse(
    readFileSync(path.join(root, 'public/assets/default-layout-5.json'), 'utf8'),
  ) as OfficeLayout;
  const live = areaBounds(layout, 'Live Tasks');
  const all = areaBounds(layout, 'All Tasks');
  const dev = areaBounds(layout, 'Dev Team');
  assert.deepEqual(live, { minCol: 1, maxCol: 9, minRow: 11, maxRow: 20 });
  assert.deepEqual(all, { minCol: 1, maxCol: 9, minRow: 23, maxRow: 32 });
  assert.ok(dev && dev.minCol > live!.maxCol);
});
