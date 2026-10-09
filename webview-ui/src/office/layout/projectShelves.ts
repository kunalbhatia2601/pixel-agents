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

/** Shelves inside the Project Directory Area, top-left first. Re-derived from the live layout so edits move the tags. */
export function projectShelves(layout: OfficeLayout): Shelf[] {
  const { areaTiles, cols } = layout;
  if (!areaTiles) return [];
  let minC = Infinity,
    maxC = -1,
    minR = Infinity,
    maxR = -1;
  areaTiles.forEach((label, i) => {
    if (label !== PROJECT_DIRECTORY_AREA) return;
    const r = Math.floor(i / cols),
      c = i % cols;
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  });
  if (maxR < 0) return [];
  return layout.furniture
    .filter((f) => {
      const width = PROJECT_SHELF_WIDTHS[f.type];
      return (
        width !== undefined &&
        f.col >= minC &&
        f.col + width - 1 <= maxC &&
        f.row >= minR - PROJECT_SHELF_WALL_ROWS &&
        f.row <= maxR
      );
    })
    .map((f) => ({ col: f.col, row: f.row, width: PROJECT_SHELF_WIDTHS[f.type] }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}
