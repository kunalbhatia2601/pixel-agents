import { useState } from 'react';

import { COPIED_FEEDBACK_MS } from '../constants.js';
import { Button } from './ui/Button.js';

interface CopyFieldProps {
  label: string;
  value: string;
  /** A URL: also offer to open it in a new tab. */
  link?: boolean;
}

/** A labelled value with a copy button (and an open button for links). */
export function CopyField({ label, value, link }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard blocked (e.g. insecure context): the value is selectable as a fallback.
      setCopied(false);
    }
  };
  return (
    <div className="flex items-center gap-4 min-w-0">
      <span className="text-sm text-text-muted w-[110px] shrink-0">{label}</span>
      <code
        className="flex-1 min-w-0 truncate bg-bg-dark px-4 py-1 text-xs select-all"
        title={value}
      >
        {value}
      </code>
      {link && (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-accent-bright underline shrink-0"
          aria-label={`Open ${label}`}
        >
          open ↗
        </a>
      )}
      <Button size="sm" className="shrink-0" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? 'Copied ✓' : 'Copy'}
      </Button>
    </div>
  );
}
