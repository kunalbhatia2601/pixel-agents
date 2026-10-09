import { useEffect, useState } from 'react';

import type { Project } from '../../../../core/src/messages.js';
import { TILE_SIZE } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { projectShelves } from '../layout/projectShelves.js';
import { overlayProjection } from '../projection.js';

interface ProjectShelvesProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  projects: Project[];
  onOpenProject: (project: Project) => void;
  onAddProject: () => void;
  onOpenDirectory: () => void;
}

/** Name tags on the store room's shelves: one per project, then "+ Add project". */
export function ProjectShelves({
  officeState,
  containerRef,
  zoom,
  panRef,
  projects,
  onOpenProject,
  onAddProject,
  onOpenDirectory,
}: ProjectShelvesProps) {
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
  const shelves = projectShelves(layout);
  if (!shelves.length) return null;
  const project = overlayProjection(
    layout,
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  // With more projects than shelves, the last shelf opens the full directory instead.
  const overflow = projects.length > shelves.length;
  const shown = overflow ? projects.slice(0, shelves.length - 1) : projects;
  const tags = [
    ...shown.map((p) => ({
      key: p.id,
      label: p.name,
      onClick: () => onOpenProject(p),
      add: false,
    })),
    overflow
      ? {
          key: 'more',
          label: `+${projects.length - shown.length} more`,
          onClick: onOpenDirectory,
          add: true,
        }
      : { key: 'add', label: '+ Add project', onClick: onAddProject, add: true },
  ].slice(0, shelves.length);

  return (
    <>
      {tags.map((tag, i) => {
        const s = shelves[i];
        return (
          <button
            key={tag.key}
            onClick={tag.onClick}
            title={tag.add ? undefined : `Open ${tag.label}`}
            className={`absolute z-10 -translate-x-1/2 -translate-y-full px-4 text-2xs whitespace-nowrap border-2 cursor-pointer shadow-pixel ${
              tag.add
                ? 'bg-bg border-dashed border-border text-text-muted hover:text-text'
                : 'bg-bg border-accent text-text hover:bg-active-bg'
            }`}
            style={{
              left: project.toScreenX((s.col + s.width / 2) * TILE_SIZE),
              top: project.toScreenY(s.row * TILE_SIZE),
            }}
          >
            {tag.label}
          </button>
        );
      })}
    </>
  );
}
