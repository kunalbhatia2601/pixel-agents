import type { Task, TaskStage, UsageTotals } from '../../core/src/messages.js';
import { addUsageTotals } from './usageFormat.js';

export const STATUS_CLASS: Record<Task['status'], string> = {
  queued: 'text-text-muted',
  preparing: 'text-text-muted',
  running: 'text-status-active',
  done: 'text-status-success',
  failed: 'text-status-error',
  stopped: 'text-warning',
};

/** "waiting" for a finished turn whose session is still open for your next message. */
export function statusLabel(task: Task): string {
  if (task.status === 'queued') return 'queued for a seat';
  return task.status === 'done' && task.sessionOpen ? 'waiting' : task.status;
}

export const STAGE_CLASS: Record<TaskStage, string> = {
  review_queued: 'text-status-permission',
  reviewing: 'text-status-active',
  changes_requested: 'text-warning',
  approved: 'text-status-success',
  escalated: 'text-status-error',
};

/** Where the task is in the QA loop, e.g. "In review (round 2/3)". Empty before any review. */
export function stageLabel(task: Task): string {
  const max = task.maxReviewRounds ?? 0;
  const round = (task.reviews?.length ?? 0) + (task.stage === 'reviewing' ? 1 : 0);
  switch (task.stage) {
    case 'review_queued':
      return 'On the QA pile';
    case 'reviewing':
      return `In review (round ${round}/${max})`;
    case 'changes_requested':
      return `Fixing QA comments (round ${round}/${max})`;
    case 'approved':
      return 'Approved by QA — ready for you';
    case 'escalated':
      return 'Needs you';
    default:
      return '';
  }
}

/** Live = queued, preparing, running, waiting with its session open, or anywhere in the QA loop before a verdict. */
export function isLiveTask(task: Task): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'preparing' ||
    task.status === 'running' ||
    !!task.sessionOpen ||
    task.stage === 'review_queued' ||
    task.stage === 'reviewing' ||
    task.stage === 'changes_requested'
  );
}

/** Dev + QA spend for a task. */
export function taskUsage(task: Task): UsageTotals | undefined {
  if (!task.usage) return task.reviewUsage;
  return task.reviewUsage ? addUsageTotals(task.usage, task.reviewUsage) : task.usage;
}
