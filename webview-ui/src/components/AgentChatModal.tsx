import { useEffect, useRef, useState } from 'react';

import type {
  ChatEntry,
  PermissionAsked,
  PermissionMode,
  Task,
  UsageTotals,
} from '../../../core/src/messages.js';
import { effectiveMode, PERMISSION_MODES, READ_ONLY_MODES } from '../permissionModes.js';
import { STAGE_CLASS, stageLabel } from '../taskStatus.js';
import { transport } from '../transport/index.js';
import { formatCost } from '../usageFormat.js';
import { ChatMarkdown } from './ChatMarkdown.js';
import { PendingRequests } from './PendingRequests.js';
import { inputClass } from './ProjectRoomModal.js';
import { ReviewHistory } from './ReviewHistory.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { UsageSummary } from './UsageSummary.js';

/** Pixels from the bottom within which new entries keep the view pinned to the latest. */
const STICK_TO_BOTTOM_PX = 80;

/** A chat is opened for an office character (agentId) or for a task (taskId). */
export interface ChatTarget {
  agentId?: number;
  taskId?: string;
}

interface AgentChatModalProps {
  target: ChatTarget | null;
  title: string;
  /** Start a new task branching from this chat's task. */
  onBranch: (task: Task) => void;
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
        <div className="self-end max-w-[85%] bg-active-bg border-2 border-accent p-6">
          <ChatMarkdown text={entry.text} />
        </div>
      );
    case 'assistant':
      return (
        <div className="self-start max-w-[92%] bg-btn-bg p-8">
          <ChatMarkdown text={entry.text} />
        </div>
      );
    case 'thinking':
      return (
        <details className="self-start max-w-[85%] text-text-muted text-sm">
          <summary className="cursor-pointer">Thinking</summary>
          <div className="p-4 opacity-80">
            <ChatMarkdown text={entry.text} />
          </div>
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
export function AgentChatModal({
  target,
  title,
  onBranch,
  onClose,
  requests,
  tasks,
}: AgentChatModalProps) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [controllable, setControllable] = useState(false);
  const [taskId, setTaskId] = useState<string | undefined>(target?.taskId);
  const [transcriptUsage, setTranscriptUsage] = useState<UsageTotals | undefined>();
  const task = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // The server answers in kind: by task when watched by task, by agent id otherwise.
  const agentId = target?.agentId;
  const targetTaskId = target?.taskId;
  useEffect(() => {
    if (agentId === undefined && targetTaskId === undefined) return;
    const address = targetTaskId !== undefined ? { taskId: targetTaskId } : { id: agentId };
    setEntries([]);
    setTaskId(targetTaskId);
    setTranscriptUsage(undefined);
    stickRef.current = true;
    const unsubscribe = transport.onMessage((msg) => {
      if (msg.type !== 'agentChat') return;
      const mine =
        targetTaskId !== undefined
          ? msg.id === undefined && msg.taskId === targetTaskId
          : msg.id === agentId;
      if (!mine) return;
      setControllable(msg.controllable);
      setTaskId(msg.taskId);
      if (msg.usage) setTranscriptUsage(msg.usage);
      setEntries((prev) => (msg.reset ? msg.entries : [...prev, ...msg.entries]));
    });
    transport.send({ type: 'watchAgentChat', ...address });
    return () => {
      unsubscribe();
      transport.send({ type: 'unwatchAgentChat', ...address });
    };
  }, [agentId, targetTaskId]);
  const address = taskId !== undefined ? { taskId } : { id: agentId };

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const send = () => {
    if (!target || !draft.trim()) return;
    transport.send({ type: 'sendAgentMessage', ...address, text: draft });
    setDraft('');
    stickRef.current = true;
  };

  return (
    <Modal
      isOpen={target !== null}
      onClose={onClose}
      title={title}
      className="w-[820px] max-w-[95vw]"
    >
      <div className="flex flex-col gap-6 px-10 pb-8 h-[75vh]">
        <div className="flex flex-col gap-2 border-b-2 border-border pb-4">
          {/* Task agents: the SDK's totals (with cost). Others: summed from the transcript. */}
          <div className="flex items-start justify-between gap-4">
            <UsageSummary usage={task?.usage ?? transcriptUsage} changes={task?.changes} />
            {task && (
              <Button size="sm" className="shrink-0" onClick={() => onBranch(task)}>
                New branch from here
              </Button>
            )}
          </div>
          {task && controllable && (
            <label className="flex items-center gap-4 text-sm">
              Mode
              <select
                className={`${inputClass} w-auto py-0`}
                value={effectiveMode(task)}
                onChange={(e) =>
                  transport.send({
                    type: 'setAgentMode',
                    ...address,
                    mode: e.target.value as PermissionMode,
                  })
                }
              >
                {PERMISSION_MODES.filter((m) => !task.readOnly || READ_ONLY_MODES.has(m.value)).map(
                  (m) => (
                    <option key={m.value} value={m.value} title={m.hint}>
                      {m.label}
                    </option>
                  ),
                )}
              </select>
              <span className="text-xs text-text-muted">
                {PERMISSION_MODES.find((m) => m.value === effectiveMode(task))?.hint}
              </span>
            </label>
          )}
          {task && (
            <span className="text-xs text-text-muted">
              {task.readOnly ? (
                <>Read-only, in your checkout (no branch). For changes, use New branch from here.</>
              ) : (
                <>
                  Branch <span className="font-mono">{task.branch}</span> — messages continue this
                  branch.
                </>
              )}
            </span>
          )}
          {task?.stage && (
            <span className={`text-sm ${STAGE_CLASS[task.stage]}`}>{stageLabel(task)}</span>
          )}
          {task?.reviewUsage && (
            <span className="text-xs text-text-muted">
              QA spend: {formatCost(task.reviewUsage.costUsd)} (the totals above are the dev
              agent&apos;s)
            </span>
          )}
          {!!task?.reviews?.length && <ReviewHistory reviews={task.reviews} />}
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
                onClick={() => transport.send({ type: 'interruptAgent', ...address })}
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
