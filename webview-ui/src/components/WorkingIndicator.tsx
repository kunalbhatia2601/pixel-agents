import { useEffect, useState } from 'react';

import { WORKING_FRAME_MS, WORKING_WORD_MS, WORKING_WORDS } from '../constants.js';

/** Spinner glyphs, cycled like Claude Code's own working indicator. */
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

interface WorkingIndicatorProps {
  /** Fixed text (e.g. "Running Bash", "Waiting for a free seat"); otherwise a rotating word. */
  label?: string;
  /** When this stretch of work began (ms epoch); defaults to when the indicator appeared. */
  since?: number;
}

/** "✻ Brewing… 42s" — shown at the end of a chat only while its agent is working. */
export function WorkingIndicator({ label, since }: WorkingIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  const [word, setWord] = useState(
    () => WORKING_WORDS[Math.floor(Math.random() * WORKING_WORDS.length)],
  );

  useEffect(() => {
    const frame = setInterval(() => setNow(Date.now()), WORKING_FRAME_MS);
    const words = setInterval(
      () => setWord(WORKING_WORDS[Math.floor(Math.random() * WORKING_WORDS.length)]),
      WORKING_WORD_MS,
    );
    return () => {
      clearInterval(frame);
      clearInterval(words);
    };
  }, []);

  const glyph = FRAMES[Math.floor(now / WORKING_FRAME_MS) % FRAMES.length];
  return (
    <div
      className="self-start flex items-center gap-4 text-accent-bright"
      role="status"
      aria-live="polite"
    >
      <span className="inline-block w-12 text-center" aria-hidden="true">
        {glyph}
      </span>
      <span>{label ?? `${word}…`}</span>
      <span className="text-text-muted text-sm">{elapsed(now - (since ?? mountedAt))}</span>
    </div>
  );
}
