import {
  PROJECT_DIRECTORY_AREA,
  PROJECT_SHELF_WALL_ROWS,
  PROJECT_SHELF_WIDTHS,
} from '../../constants.js';
import type { OfficeLayout } from '../types.js';

export interface Shelf {
  col: number;
  row: number;
  width: number;
}

/** Inclusive tile rectangle covering every tile of an Area; null when the layout has none. */
export interface AreaBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

export function areaBounds(layout: OfficeLayout, label: string): AreaBounds | null {
  const { areaTiles, cols } = layout;
  if (!areaTiles) return null;
  let minCol = Infinity,
    maxCol = -1,
    minRow = Infinity,
    maxRow = -1;
  areaTiles.forEach((tile, i) => {
    if (tile !== label) return;
    const r = Math.floor(i / cols),
      c = i % cols;
    minCol = Math.min(minCol, c);
    maxCol = Math.max(maxCol, c);
    minRow = Math.min(minRow, r);
    maxRow = Math.max(maxRow, r);
  });
  return maxRow < 0 ? null : { minCol, maxCol, minRow, maxRow };
}

/** Shelves inside the Project Directory Area, top-left first. Re-derived from the live layout so edits move the tags. */
export function projectShelves(layout: OfficeLayout): Shelf[] {
  const b = areaBounds(layout, PROJECT_DIRECTORY_AREA);
  if (!b) return [];
  return layout.furniture
    .filter((f) => {
      const width = PROJECT_SHELF_WIDTHS[f.type];
      return (
        width !== undefined &&
        f.col >= b.minCol &&
        f.col + width - 1 <= b.maxCol &&
        f.row >= b.minRow - PROJECT_SHELF_WALL_ROWS &&
        f.row <= b.maxRow
      );
    })
    .map((f) => ({ col: f.col, row: f.row, width: PROJECT_SHELF_WIDTHS[f.type] }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}
