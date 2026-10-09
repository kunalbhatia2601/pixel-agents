import type { Task } from '../../core/src/messages.js';

export const STATUS_CLASS: Record<Task['status'], string> = {
  preparing: 'text-text-muted',
  running: 'text-status-active',
  done: 'text-status-success',
  failed: 'text-status-error',
  stopped: 'text-warning',
};

/** "waiting" for a finished turn whose session is still open for your next message. */
export function statusLabel(task: Task): string {
  return task.status === 'done' && task.sessionOpen ? 'waiting' : task.status;
}

/** Live = preparing, running, or waiting with its session open for your next message. */
export function isLiveTask(task: Task): boolean {
  return task.status === 'preparing' || task.status === 'running' || !!task.sessionOpen;
}
