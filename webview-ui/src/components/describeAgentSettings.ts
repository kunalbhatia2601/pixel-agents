import type { AgentSettings } from '../../../core/src/messages.js';
import { modeLabel } from '../permissionModes.js';

/** "opus · high · thinking off" for display; empty when nothing is set. */
export function describeAgentSettings(s: AgentSettings | undefined): string {
  if (!s) return '';
  return [
    s.model,
    s.effort,
    s.thinking === 'disabled' ? 'thinking off' : s.thinking,
    s.permissionMode && modeLabel(s.permissionMode),
  ]
    .filter(Boolean)
    .join(' · ');
}
