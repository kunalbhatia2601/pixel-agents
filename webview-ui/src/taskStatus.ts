import type { Account, Task, TaskStage, UsageTotals } from '../../core/src/messages.js';
import { addUsageTotals } from './usageFormat.js';

export const STATUS_CLASS: Record<Task['status'], string> = {
  queued: 'text-text-muted',
  preparing: 'text-text-muted',
  running: 'text-status-active',
  done: 'text-status-success',
  failed: 'text-status-error',
  stopped: 'text-warning',
};

/** The dev agent's state in words. A finished turn reads "done" whether or not its session is still open. */
export function statusLabel(task: Task): string {
  return task.status === 'queued' ? 'queued for a seat' : task.status;
}

export const STAGE_CLASS: Record<TaskStage, string> = {
  review_queued: 'text-status-permission',
  reviewing: 'text-status-active',
  changes_requested: 'text-warning',
  approved: 'text-status-success',
  escalated: 'text-status-error',
  ready: 'text-status-success',
  delivered: 'text-text-muted',
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
    case 'ready':
      return 'Ready for you (no QA)';
    case 'delivered':
      return 'Done';
    default:
      return '';
  }
}

/**
 * Live = work is happening or about to: queued for a seat, preparing, running, or in the QA loop
 * before a verdict. A finished turn is not live, even while its session stays open for follow-ups.
 */
export function isLiveTask(task: Task): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'preparing' ||
    task.status === 'running' ||
    task.stage === 'review_queued' ||
    task.stage === 'reviewing' ||
    task.stage === 'changes_requested'
  );
}

/** Waiting on the owner's desk: approved by QA, escalated, or ready with QA off. */
export function onDesk(task: Task): boolean {
  return task.stage === 'approved' || task.stage === 'escalated' || task.stage === 'ready';
}

/** Dev + QA spend for a task. */
export function taskUsage(task: Task): UsageTotals | undefined {
  if (!task.usage) return task.reviewUsage;
  return task.reviewUsage ? addUsageTotals(task.usage, task.reviewUsage) : task.usage;
}

/**
 * Whether a chat's agent is working right now, and what to say about it. A dev chat follows its task,
 * a QA chat follows the review, and any other agent follows the office's live activity.
 */
export function chatActivity(ctx: {
  task?: Task;
  isReviewer: boolean;
  agentActive: boolean;
  runningToolName?: string;
}): { working: boolean; label?: string } {
  const { task, isReviewer } = ctx;
  if (isReviewer) {
    const working = task?.stage === 'reviewing';
    return {
      working,
      label: working && ctx.runningToolName ? `Running ${ctx.runningToolName}` : undefined,
    };
  }
  if (task) {
    if (task.status === 'queued')
      return { working: true, label: 'Waiting for a free seat in the Dev Team' };
    if (task.status === 'preparing') return { working: true, label: 'Setting up the workspace' };
    if (task.status !== 'running') return { working: false };
  } else if (!ctx.agentActive) {
    return { working: false };
  }
  return {
    working: true,
    label: ctx.runningToolName ? `Running ${ctx.runningToolName}` : undefined,
  };
}

/**
 * The terminal command that reopens a task's Claude session with its full history. Claude Code finds
 * sessions per folder, so it must run from the task's folder: its worktree (or the owner's repo for a
 * read-only task). None once Done removed the worktree, or before a session exists.
 */
export function resumeCommand(task: Task, account?: Account): string | undefined {
  if (!task.sessionId || !task.worktree) return undefined;
  if (task.stage === 'delivered' && !task.readOnly) return undefined;
  const dir = task.worktree.replace(/(["\\$`])/g, '\\$1');
  // On an account: read its credential from the stored file (never spelled out in the command).
  const credential = account
    ? `${account.kind === 'subscription' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'}="$(cat ~/.pixel-agents/accounts/${account.id}.secret)" `
    : '';
  return `cd "${dir}" && ${credential}claude --resume ${task.sessionId}`;
}
