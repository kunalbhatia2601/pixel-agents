import type { AgentSettings } from '../../../core/src/messages.js';

/** "opus · high · thinking off" for display; empty when nothing is set. */
export function describeAgentSettings(s: AgentSettings | undefined): string {
  if (!s) return '';
  return [s.model, s.effort, s.thinking === 'disabled' ? 'thinking off' : s.thinking]
    .filter(Boolean)
    .join(' · ');
}
