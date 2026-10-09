import { useEffect, useRef, useState } from 'react';

import type { ChatEntry, PermissionAsked, Task, UsageTotals } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { PendingRequests } from './PendingRequests.js';
import { inputClass } from './ProjectRoomModal.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { UsageSummary } from './UsageSummary.js';

/** Pixels from the bottom within which new entries keep the view pinned to the latest. */
const STICK_TO_BOTTOM_PX = 80;

interface AgentChatModalProps {
  agentId: number | null;
  title: string;
  onClose: () => void;
  /** Approvals and questions this agent is waiting on. */
  requests: PermissionAsked[];
  /** All tasks; the one this agent ran supplies authoritative usage and the changed files. */
  tasks: Task[];
}

function Entry({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="self-end max-w-[85%] bg-active-bg border-2 border-accent p-6 whitespace-pre-wrap break-words">
          {entry.text}
        </div>
      );
    case 'assistant':
      return (
        <div className="self-start max-w-[85%] bg-btn-bg p-6 whitespace-pre-wrap break-words">
          {entry.text}
        </div>
      );
    case 'thinking':
      return (
        <details className="self-start max-w-[85%] text-text-muted text-sm">
          <summary className="cursor-pointer">Thinking</summary>
          <div className="whitespace-pre-wrap break-words p-4">{entry.text}</div>
        </details>
      );
    case 'tool':
      return (
        <div className="self-start max-w-[85%] text-sm font-mono">
          <span className="text-status-active">{entry.toolName}</span>{' '}
          <span className="text-text-muted whitespace-pre-wrap break-all">{entry.text}</span>
        </div>
      );
    case 'toolResult':
      return (
        <details className="self-start max-w-[85%] text-xs text-text-muted">
          <summary className="cursor-pointer">Result</summary>
          <pre className="whitespace-pre-wrap break-all bg-bg-dark p-4">{entry.text}</pre>
        </details>
      );
  }
}

/** Live conversation of one agent. Task agents can be messaged and interrupted. */
export function AgentChatModal({ agentId, title, onClose, requests, tasks }: AgentChatModalProps) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [controllable, setControllable] = useState(false);
  const [taskId, setTaskId] = useState<string | undefined>();
  const [transcriptUsage, setTranscriptUsage] = useState<UsageTotals | undefined>();
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (agentId === null) return;
    setEntries([]);
    setTaskId(undefined);
    setTranscriptUsage(undefined);
    stickRef.current = true;
    const unsubscribe = transport.onMessage((msg) => {
      if (msg.type !== 'agentChat' || msg.id !== agentId) return;
      setControllable(msg.controllable);
      setTaskId(msg.taskId);
      if (msg.usage) setTranscriptUsage(msg.usage);
      setEntries((prev) => (msg.reset ? msg.entries : [...prev, ...msg.entries]));
    });
    transport.send({ type: 'watchAgentChat', id: agentId });
    return () => {
      unsubscribe();
      transport.send({ type: 'unwatchAgentChat', id: agentId });
    };
  }, [agentId]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const send = () => {
    if (agentId === null || !draft.trim()) return;
    transport.send({ type: 'sendAgentMessage', id: agentId, text: draft });
    setDraft('');
    stickRef.current = true;
  };

  return (
    <Modal
      isOpen={agentId !== null}
      onClose={onClose}
      title={title}
      className="w-[820px] max-w-[95vw]"
    >
      <div className="flex flex-col gap-6 px-10 pb-8 h-[75vh]">
        <div className="flex flex-col gap-2 border-b-2 border-border pb-4">
          {/* Task agents: the SDK's totals (with cost). Others: summed from the transcript. */}
          <UsageSummary usage={task?.usage ?? transcriptUsage} changes={task?.changes} />
          {!!task?.changedFiles?.length && (
            <details className="text-sm">
              <summary className="cursor-pointer text-text-muted">Changed files</summary>
              <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto pt-2 font-mono text-xs">
                {task.changedFiles.map((f) => (
                  <span key={f.path}>
                    <span className="text-status-success">+{f.added}</span>{' '}
                    <span className="text-status-error">−{f.removed}</span> {f.path}
                  </span>
                ))}
              </div>
            </details>
          )}
        </div>
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto flex flex-col gap-6 pr-4"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
          }}
        >
          {entries.length === 0 && <p className="text-text-muted">No messages yet.</p>}
          {entries.map((entry, i) => (
            <Entry key={i} entry={entry} />
          ))}
        </div>
        <PendingRequests requests={requests} />
        {controllable ? (
          <div className="flex flex-col gap-4">
            <textarea
              className={`${inputClass} min-h-[70px]`}
              placeholder="Message the agent (Enter to send, Shift+Enter for a new line)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="flex gap-4 justify-end">
              <Button
                variant="ghost"
                onClick={() =>
                  agentId !== null && transport.send({ type: 'interruptAgent', id: agentId })
                }
                title="Stop the current turn; the agent waits for your next message"
              >
                Interrupt
              </Button>
              <Button
                variant={draft.trim() ? 'accent' : 'disabled'}
                disabled={!draft.trim()}
                onClick={send}
              >
                Send
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-muted">
            Read-only: only agents started as tasks from this office can be messaged.
          </p>
        )}
      </div>
    </Modal>
  );
}
