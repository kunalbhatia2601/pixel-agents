import { useEffect, useState } from 'react';

import type { Task } from '../../../../core/src/messages.js';
import { QA_PILE_MAX_SHEETS, QA_PILE_SHEET_OFFSET_PX, TILE_SIZE } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { areaBounds } from '../layout/projectShelves.js';
import { overlayProjection } from '../projection.js';

interface QaPileProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  tasks: Task[];
  onOpen: () => void;
}

/** A stack of review notes in the QA room: one sheet per task waiting on the QA pile. */
export function QaPile({ officeState, containerRef, zoom, panRef, tasks, onOpen }: QaPileProps) {
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
  const room = areaBounds(layout, 'QA / Review');
  if (!room) return null;
  const pending = tasks.filter((t) => t.stage === 'review_queued');
  const inReview = tasks.filter((t) => t.stage === 'reviewing');
  const project = overlayProjection(
    layout,
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );
  // Bottom-right corner of the room, clear of the desks.
  const left = project.toScreenX((room.maxCol - 1) * TILE_SIZE);
  const top = project.toScreenY((room.maxRow - 0.5) * TILE_SIZE);
  const sheets = Math.min(pending.length, QA_PILE_MAX_SHEETS);

  return (
    <button
      className="absolute z-10 flex flex-col items-center cursor-pointer -translate-x-1/2 -translate-y-full"
      style={{ left, top }}
      onClick={onOpen}
      title={
        pending.length
          ? `Waiting for QA:\n${pending.map((t) => `• ${t.title}`).join('\n')}`
          : 'No reviews waiting'
      }
    >
      <span className="text-2xs bg-bg border-2 border-border px-4 mb-2 whitespace-nowrap shadow-pixel">
        {pending.length} to review{inReview.length ? ` · ${inReview.length} in review` : ''}
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
