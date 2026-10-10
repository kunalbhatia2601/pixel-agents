import { useState } from 'react';

import type { AgentQuestion, PermissionAsked, PermissionMode } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { ChatMarkdown } from './ChatMarkdown.js';
import { inputClass } from './ProjectRoomModal.js';
import { Button } from './ui/Button.js';

function ApprovalCard({ request }: { request: PermissionAsked }) {
  const [reason, setReason] = useState('');
  const answer = (allow: boolean) =>
    transport.send({
      type: 'answerPermission',
      requestId: request.requestId,
      allow,
      message: allow ? undefined : reason,
    });
  return (
    <div className="border-2 border-status-permission p-6 flex flex-col gap-4" role="alertdialog">
      <span className="text-status-permission">Needs approval: {request.toolName}</span>
      <pre className="text-xs whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto bg-bg-dark p-4">
        {request.detail}
      </pre>
      <input
        className={inputClass}
        placeholder="Reason, if rejecting (optional, sent to the agent)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-4 justify-end">
        <Button size="sm" variant="ghost" onClick={() => answer(false)}>
          Reject
        </Button>
        <Button size="sm" variant="accent" onClick={() => answer(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}

interface Choice {
  selected: string[];
  other: string;
}

function QuestionBlock({
  q,
  choice,
  onChange,
}: {
  q: AgentQuestion;
  choice: Choice;
  onChange: (c: Choice) => void;
}) {
  const toggle = (label: string) =>
    onChange({
      ...choice,
      selected: q.multiSelect
        ? choice.selected.includes(label)
          ? choice.selected.filter((l) => l !== label)
          : [...choice.selected, label]
        : [label],
    });
  const preview = q.options.find((o) => choice.selected.includes(o.label) && o.preview)?.preview;
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="flex items-center gap-4 pb-4">
        <span className="text-xs border-2 border-border px-4">{q.header}</span>
        <span>{q.question}</span>
      </legend>
      <span className="text-xs text-text-muted">
        {q.multiSelect ? 'Choose any that apply' : 'Choose one'}
      </span>
      {q.options.map((o) => (
        <label
          key={o.label}
          className={`flex gap-6 items-start p-4 border-2 cursor-pointer ${
            choice.selected.includes(o.label) ? 'border-accent bg-active-bg' : 'border-border'
          }`}
        >
          <input
            type={q.multiSelect ? 'checkbox' : 'radio'}
            name={q.question}
            checked={choice.selected.includes(o.label)}
            onChange={() => toggle(o.label)}
            className="mt-2"
          />
          <span className="flex flex-col gap-1">
            <span>{o.label}</span>
            <span className="text-sm text-text-muted">{o.description}</span>
          </span>
        </label>
      ))}
      {preview && (
        <pre className="text-xs whitespace-pre-wrap bg-bg-dark p-4 max-h-[240px] overflow-y-auto">
          {preview}
        </pre>
      )}
      <input
        className={inputClass}
        placeholder="Other (type your own answer)"
        value={choice.other}
        onChange={(e) => onChange({ ...choice, other: e.target.value })}
      />
    </fieldset>
  );
}

function QuestionCard({ request }: { request: PermissionAsked }) {
  const questions = request.questions ?? [];
  const [choices, setChoices] = useState<Choice[]>(() =>
    questions.map(() => ({ selected: [], other: '' })),
  );
  const answerFor = (c: Choice) => [...c.selected, c.other.trim()].filter(Boolean).join(', ');
  const complete = choices.every((c) => answerFor(c));
  const submit = () =>
    transport.send({
      type: 'answerPermission',
      requestId: request.requestId,
      allow: true,
      answers: Object.fromEntries(questions.map((q, i) => [q.question, answerFor(choices[i])])),
    });
  return (
    <div className="border-2 border-accent p-6 flex flex-col gap-8" role="dialog">
      <span className="text-accent-bright">The agent has a question</span>
      {questions.map((q, i) => (
        <QuestionBlock
          key={q.question}
          q={q}
          choice={choices[i]}
          onChange={(c) => setChoices((all) => all.map((old, j) => (j === i ? c : old)))}
        />
      ))}
      <div className="flex gap-4 justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            transport.send({
              type: 'answerPermission',
              requestId: request.requestId,
              allow: false,
              message: 'The user declined to answer; decide yourself or ask in chat.',
            })
          }
        >
          Skip
        </Button>
        <Button
          size="sm"
          variant={complete ? 'accent' : 'disabled'}
          disabled={!complete}
          onClick={submit}
        >
          Submit answers
        </Button>
      </div>
    </div>
  );
}

/** A Plan-mode agent's plan: read it, then approve into a mode or send it back with feedback. */
function PlanCard({ request }: { request: PermissionAsked }) {
  const [feedback, setFeedback] = useState('');
  const approve = (mode: PermissionMode) =>
    transport.send({ type: 'answerPermission', requestId: request.requestId, allow: true, mode });
  return (
    <div className="border-2 border-accent p-6 flex flex-col gap-4" role="dialog">
      <span className="text-accent-bright">The agent&apos;s plan — approve to let it start</span>
      <div className="max-h-[300px] overflow-y-auto bg-bg-dark p-6">
        <ChatMarkdown text={request.detail} />
      </div>
      <input
        className={inputClass}
        placeholder="What should change in the plan? (for Keep planning)"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
      <div className="flex flex-wrap gap-4 justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            transport.send({
              type: 'answerPermission',
              requestId: request.requestId,
              allow: false,
              message: feedback.trim() || 'Keep planning: the plan is not approved yet.',
            })
          }
        >
          Keep planning
        </Button>
        <Button size="sm" onClick={() => approve('default')} title="Then ask before each edit">
          Approve, ask for edits
        </Button>
        <Button size="sm" variant="accent" onClick={() => approve('acceptEdits')}>
          Approve, auto-accept edits
        </Button>
      </div>
    </div>
  );
}

/** An agent's open approvals and questions, shown inside its chat. */
export function PendingRequests({ requests }: { requests: PermissionAsked[] }) {
  if (!requests.length) return null;
  return (
    <div className="flex flex-col gap-6 max-h-[45vh] overflow-y-auto">
      {requests.map((r) =>
        r.questions?.length ? (
          <QuestionCard key={r.requestId} request={r} />
        ) : r.toolName === 'ExitPlanMode' ? (
          <PlanCard key={r.requestId} request={r} />
        ) : (
          <ApprovalCard key={r.requestId} request={r} />
        ),
      )}
    </div>
  );
}
