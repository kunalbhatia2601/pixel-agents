import { useEffect, useState } from 'react';

import type { PermissionAsked, Project, Task } from '../../../../core/src/messages.js';
import {
  ALL_TASKS_AREA,
  LIVE_TASKS_AREA,
  TASK_BOARD_INSET_TILES,
  TILE_SIZE,
} from '../../constants.js';
import {
  isLiveTask,
  STAGE_CLASS,
  stageLabel,
  STATUS_CLASS,
  statusLabel,
} from '../../taskStatus.js';
import type { OfficeState } from '../engine/officeState.js';
import { areaBounds } from '../layout/projectShelves.js';
import { overlayProjection } from '../projection.js';

interface TaskRoomBoardsProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  projects: Project[];
  tasks: Task[];
  permissions: PermissionAsked[];
  onOpenTask: (task: Task) => void;
  onOpenBoard: (tab: 'live' | 'all') => void;
}

/** The Tasks room's two halves as boards: Live (running / waiting) and All. Rows open the task's chat. */
export function TaskRoomBoards({
  officeState,
  containerRef,
  zoom,
  panRef,
  projects,
  tasks,
  permissions,
  onOpenTask,
  onOpenBoard,
}: TaskRoomBoardsProps) {
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
  const project = overlayProjection(
    layout,
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? '—';

  const boards = [
    { area: LIVE_TASKS_AREA, tab: 'live' as const, title: 'LIVE', list: tasks.filter(isLiveTask) },
    { area: ALL_TASKS_AREA, tab: 'all' as const, title: 'ALL TASKS', list: tasks },
  ];

  return (
    <>
      {boards.map((board) => {
        const b = areaBounds(layout, board.area);
        if (!b) return null;
        const left = project.toScreenX((b.minCol + TASK_BOARD_INSET_TILES) * TILE_SIZE);
        const top = project.toScreenY((b.minRow + TASK_BOARD_INSET_TILES) * TILE_SIZE);
        const right = project.toScreenX((b.maxCol + 1 - TASK_BOARD_INSET_TILES) * TILE_SIZE);
        const bottom = project.toScreenY((b.maxRow + 1 - TASK_BOARD_INSET_TILES) * TILE_SIZE);
        return (
          <div
            key={board.area}
            className="absolute z-10 flex flex-col bg-bg/90 border-2 border-border shadow-pixel overflow-hidden"
            style={{ left, top, width: right - left, height: bottom - top }}
          >
            <button
              className="flex justify-between items-center px-4 py-1 text-xs border-b-2 border-border cursor-pointer hover:bg-btn-hover"
              onClick={() => onOpenBoard(board.tab)}
              title="Open the Task Board"
            >
              <span className="text-accent-bright">{board.title}</span>
              <span className="text-text-muted">{board.list.length}</span>
            </button>
            <div className="flex-1 overflow-y-auto">
              {board.list.length === 0 && (
                <span className="block px-4 py-1 text-2xs text-text-muted">
                  {board.tab === 'live' ? 'Nothing running' : 'No tasks yet'}
                </span>
              )}
              {board.list.map((t) => {
                const waiting = permissions.some((p) => p.taskId === t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => onOpenTask(t)}
                    title={`${t.title} — ${projectName(t.projectId)} · ${t.readOnly ? 'read-only' : t.branch}`}
                    className="w-full flex flex-col text-left px-4 py-1 border-b border-border cursor-pointer hover:bg-active-bg"
                  >
                    <span className="text-2xs truncate w-full">
                      {waiting && <span className="text-status-permission">● </span>}
                      {t.title}
                    </span>
                    <span className="text-2xs text-text-muted truncate w-full">
                      {t.stage ? (
                        <span className={STAGE_CLASS[t.stage]}>{stageLabel(t)}</span>
                      ) : (
                        <span className={STATUS_CLASS[t.status]}>{statusLabel(t)}</span>
                      )}{' '}
                      · {projectName(t.projectId)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
