import { useEffect, useState } from 'react';

import type { Task } from '../../../../core/src/messages.js';
import { QA_PILE_MAX_SHEETS, QA_PILE_SHEET_OFFSET_PX, TILE_SIZE } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { getCatalogEntry } from '../layout/furnitureCatalog.js';
import { areaBounds } from '../layout/projectShelves.js';
import { overlayProjection } from '../projection.js';

interface RoomPileProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  /** The room (Area label) the pile sits in: on `onFurniture` if given, else its bottom-right corner. */
  area: string;
  /** Furniture type to rest the pile on (e.g. the room's coffee table), found inside the room. */
  onFurniture?: string;
  /** One sheet per task. */
  items: Task[];
  /** Tag above the pile, e.g. "3 to review · 1 in review". */
  label: string;
  /** Tooltip heading over the item titles. */
  heading: string;
  onOpen: () => void;
}

/** A stack of notes in a room: one sheet per task waiting there (the QA pile, the owner's inbox). */
export function RoomPile({
  officeState,
  containerRef,
  zoom,
  panRef,
  area,
  onFurniture,
  items,
  label,
  heading,
  onOpen,
}: RoomPileProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const layout = officeState.getLayout();
  const room = areaBounds(layout, area);
  if (!room) return null;
  const project = overlayProjection(
    layout,
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );
  // On the named furniture when the room has it (follows it if moved in the editor), else the
  // room's bottom-right corner, clear of the desks.
  const table = onFurniture
    ? layout.furniture.find(
        (f) =>
          f.type === onFurniture &&
          f.col >= room.minCol &&
          f.col <= room.maxCol &&
          f.row >= room.minRow &&
          f.row <= room.maxRow,
      )
    : undefined;
  const width = table ? (getCatalogEntry(table.type)?.footprintW ?? 1) : 0;
  const height = table ? (getCatalogEntry(table.type)?.footprintH ?? 1) : 0;
  const left = table
    ? project.toScreenX((table.col + width / 2) * TILE_SIZE)
    : project.toScreenX((room.maxCol - 1) * TILE_SIZE);
  const top = table
    ? project.toScreenY((table.row + height * 0.75) * TILE_SIZE)
    : project.toScreenY((room.maxRow - 0.5) * TILE_SIZE);
  const sheets = Math.min(items.length, QA_PILE_MAX_SHEETS);

  return (
    <button
      className="absolute z-10 flex flex-col items-center cursor-pointer -translate-x-1/2 -translate-y-full"
      style={{ left, top }}
      onClick={onOpen}
      title={items.length ? `${heading}:\n${items.map((t) => `• ${t.title}`).join('\n')}` : heading}
    >
      <span className="text-2xs bg-bg border-2 border-border px-4 mb-2 whitespace-nowrap shadow-pixel">
        {label}
      </span>
      <span className="relative block w-24 h-16">
        {Array.from({ length: Math.max(sheets, 1) }, (_, i) => (
          <span
            key={i}
            className={`absolute left-0 w-24 h-14 border-2 border-border ${sheets ? 'bg-text' : 'bg-bg-dark opacity-40'}`}
            style={{ bottom: i * QA_PILE_SHEET_OFFSET_PX, left: (i % 2) * 2 }}
          />
        ))}
      </span>
    </button>
  );
}
