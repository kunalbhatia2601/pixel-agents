import { Button } from './ui/Button.js';

interface ErrorToastProps {
  error: string | null;
  onDismiss: () => void;
}

/** Top-right toast for a failed project/task request. Approvals live in each agent's chat. */
export function ErrorToast({ error, onDismiss }: ErrorToastProps) {
  if (!error) return null;
  return (
    <div className="absolute top-10 right-10 z-40 w-[420px] max-w-[90vw]">
      <div className="pixel-panel p-6 flex items-start justify-between gap-4" role="alert">
        <span className="text-status-error">{error}</span>
        <Button size="icon" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
          x
        </Button>
      </div>
    </div>
  );
}
