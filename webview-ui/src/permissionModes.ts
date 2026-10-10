import type { PermissionMode, Task } from '../../core/src/messages.js';

/** Every Claude Code permission mode, in the order Claude Code cycles them, with what it means. */
export const PERMISSION_MODES: Array<{ value: PermissionMode; label: string; hint: string }> = [
  { value: 'default', label: 'Ask', hint: 'Asks you before risky actions' },
  {
    value: 'acceptEdits',
    label: 'Auto-accept edits',
    hint: 'File edits run unasked; commands ask',
  },
  { value: 'plan', label: 'Plan', hint: 'Reads and plans only; you approve the plan first' },
  { value: 'auto', label: 'Auto', hint: 'A classifier approves or denies for you' },
  { value: 'dontAsk', label: "Don't ask", hint: 'Anything not pre-approved is denied' },
  { value: 'bypassPermissions', label: 'Bypass', hint: 'No checks at all — use with care' },
];

/** Read-only tasks work in your own checkout: only modes that can't write unasked. */
export const READ_ONLY_MODES: ReadonlySet<PermissionMode> = new Set(['default', 'plan', 'dontAsk']);

export function modeLabel(mode: PermissionMode): string {
  return PERMISSION_MODES.find((m) => m.value === mode)?.label ?? mode;
}

/** The mode a task's agent runs in (mirrors the server: branch tasks auto-accept edits by default). */
export function effectiveMode(task: Task): PermissionMode {
  const chosen = task.agent?.permissionMode;
  if (task.readOnly) return chosen && READ_ONLY_MODES.has(chosen) ? chosen : 'default';
  return chosen ?? 'acceptEdits';
}
