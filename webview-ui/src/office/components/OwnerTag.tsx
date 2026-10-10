import { useEffect, useState } from 'react';

import { TOOL_OVERLAY_VERTICAL_OFFSET } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';

interface OwnerTagProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** A "You" name tag over the owner's character, following it as it walks. */
export function OwnerTag({ officeState, containerRef, zoom, panRef }: OwnerTagProps) {
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
  const ch = officeState.owner;
  if (!el || !ch || ch.matrixEffect) return null;
  const project = overlayProjection(
    officeState.getLayout(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );
  return (
    <span
      className="absolute z-10 -translate-x-1/2 -translate-y-full px-4 text-2xs bg-accent text-text border-2 border-accent-bright shadow-pixel pointer-events-none whitespace-nowrap"
      style={{
        left: project.toScreenX(ch.x),
        top: project.toScreenY(ch.y - TOOL_OVERLAY_VERTICAL_OFFSET),
      }}
    >
      You
    </span>
  );
}
