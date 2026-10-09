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
    readFileSync(path.join(root, 'public/assets/default-layout-3.json'), 'utf8'),
  ) as OfficeLayout;
  const shelves = projectShelves(layout);
  assert.equal(shelves.length, 12);
  assert.deepEqual(
    shelves.slice(0, 5).map((s) => [s.row, s.col]),
    [
      [21, 1],
      [21, 7],
      [21, 9],
      [21, 11],
      [25, 2],
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
