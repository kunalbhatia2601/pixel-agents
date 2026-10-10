import type { Account, Project, Task } from '../../../core/src/messages.js';
import { onDesk, resumeCommand, STAGE_CLASS, stageLabel, taskUsage } from '../taskStatus.js';
import { transport } from '../transport/index.js';
import { ChatMarkdown } from './ChatMarkdown.js';
import { CopyField } from './CopyField.js';
import { ReviewHistory } from './ReviewHistory.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { UsageSummary } from './UsageSummary.js';

interface OwnerDeskModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  projects: Project[];
  accounts: Account[];
  onOpenChat: (task: Task) => void;
}

function DeskCard({
  task,
  projectName,
  account,
  onOpenChat,
}: {
  task: Task;
  projectName: string;
  account?: Account;
  onOpenChat: () => void;
}) {
  const done = () => {
    if (
      confirm(
        `Done with "${task.title}"? Its session ends and its worktrees are removed. ` +
          'The branch stays in the repo, so everything committed is kept.',
      )
    ) {
      transport.send({ type: 'completeTask', taskId: task.id });
    }
  };
  return (
    <div className="border-2 border-border p-8 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xl">{task.title}</span>
          <span className="text-sm text-text-muted">
            {projectName}
            {account && ` · runs on "${account.name}"`}
          </span>
        </div>
        {task.stage && (
          <span className={`shrink-0 ${STAGE_CLASS[task.stage]}`}>{stageLabel(task)}</span>
        )}
      </div>
      <UsageSummary usage={taskUsage(task)} changes={task.changes} />

      <div className="flex flex-col gap-3">
        {(task.handoff ?? []).map((h) => (
          <div key={h.repo} className="flex flex-col gap-3 bg-bg-dark/40 p-4">
            {(task.handoff?.length ?? 0) > 1 && (
              <span className="text-sm text-accent-bright">{h.repo}</span>
            )}
            <CopyField label="Branch" value={h.branch} />
            <CopyField label="Target" value={h.baseBranch} />
            {h.repoUrl && <CopyField label="Repo" value={h.repoUrl} link />}
            {h.branchUrl && <CopyField label="Branch link" value={h.branchUrl} link />}
            {h.createPrUrl && <CopyField label="New PR page" value={h.createPrUrl} link />}
            <CopyField label="Push" value={h.pushCommand} />
            {h.worktree && <CopyField label="Worktree" value={h.worktree} />}
            {h.commits !== undefined && (
              <span className="text-xs text-text-muted">
                {h.commits} commit{h.commits === 1 ? '' : 's'} on the branch
              </span>
            )}
          </div>
        ))}
        {!task.handoff?.length && (
          <span className="text-sm text-text-muted">Collecting the branch details…</span>
        )}
        {resumeCommand(task, account) && (
          <div className="flex flex-col gap-1">
            <CopyField label="Open in terminal" value={resumeCommand(task, account)!} />
            {task.sessionOpen && (
              <span className="text-xs text-warning">
                The office still has this session open: press End session in the task list first (or
                it closes itself after 30 idle minutes), so two Claude processes never write to the
                same session.
              </span>
            )}
          </div>
        )}
      </div>

      {task.prompt && (
        <details className="text-sm">
          <summary className="cursor-pointer text-text-muted">The task</summary>
          <div className="pt-2">
            <ChatMarkdown text={task.prompt} />
          </div>
        </details>
      )}
      {task.summary && (
        <details className="text-sm" open>
          <summary className="cursor-pointer text-text-muted">What the dev agent did</summary>
          <div className="pt-2 max-h-[260px] overflow-y-auto">
            <ChatMarkdown text={task.summary} />
          </div>
        </details>
      )}
      {!!task.reviews?.length && <ReviewHistory reviews={task.reviews} />}

      <div className="flex gap-4 justify-end">
        <Button size="md" onClick={onOpenChat} title="Ask the dev agent for help or more changes">
          Open chat
        </Button>
        <Button size="md" variant="accent" onClick={done}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** The owner's desk: every task waiting on you, with the branch, links and push command to copy. */
export function OwnerDeskModal({
  isOpen,
  onClose,
  tasks,
  projects,
  accounts,
  onOpenChat,
}: OwnerDeskModalProps) {
  const desk = tasks.filter(onDesk);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Deleted project';
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Your desk" className="w-[820px] max-w-[95vw]">
      <div className="flex flex-col gap-8 px-10 pb-8 max-h-[80vh] overflow-y-auto">
        {desk.length === 0 ? (
          <p className="text-text-muted">
            Nothing on your desk. Tasks land here when QA approves them, when they need you, or — on
            projects without QA — once the dev agent commits.
          </p>
        ) : (
          desk.map((t) => (
            <DeskCard
              key={t.id}
              task={t}
              projectName={projectName(t.projectId)}
              account={accounts.find((a) => a.id === t.accountId)}
              onOpenChat={() => onOpenChat(t)}
            />
          ))
        )}
      </div>
    </Modal>
  );
}
