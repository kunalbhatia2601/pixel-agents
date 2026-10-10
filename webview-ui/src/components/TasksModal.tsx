import { useState } from 'react';

import type { PermissionAsked, Project, Task } from '../../../core/src/messages.js';
import { TASK_BOARD_PAGE_SIZE } from '../constants.js';
import { usePaging } from '../hooks/usePaging.js';
import {
  isLiveTask,
  STAGE_CLASS,
  stageLabel,
  STATUS_CLASS,
  statusLabel,
  taskUsage,
} from '../taskStatus.js';
import { transport } from '../transport/index.js';
import { describeAgentSettings } from './describeAgentSettings.js';
import { NewTaskForm } from './NewTaskForm.js';
import { Pager } from './Pager.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { UsageSummary } from './UsageSummary.js';

export type TaskBoardTab = 'live' | 'all';

/** What the board shows when opened: a tab, or a new-task form (optionally branching from a task). */
export interface TaskBoardView {
  tab: TaskBoardTab;
  form?: { fromTask?: Task };
}

interface TasksModalProps {
  view: TaskBoardView | null;
  onClose: () => void;
  projects: Project[];
  tasks: Task[];
  permissions: PermissionAsked[];
  onOpenChat: (task: Task) => void;
  onOpenProjects: () => void;
}

function TaskRow({
  task,
  projectName,
  parent,
  waiting,
  onOpen,
  onBranch,
}: {
  task: Task;
  projectName: string;
  parent?: Task;
  waiting: number;
  onOpen: () => void;
  onBranch: () => void;
}) {
  const live = isLiveTask(task);
  return (
    <div className="border-2 border-border p-6 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <button
          className="text-lg text-left cursor-pointer hover:text-accent-bright"
          onClick={onOpen}
          title="Open the chat"
        >
          {task.title}
        </button>
        <div className="flex items-center gap-4 shrink-0">
          {waiting > 0 && <span className="text-status-permission">needs you ({waiting})</span>}
          {task.stage && <span className={STAGE_CLASS[task.stage]}>{stageLabel(task)}</span>}
          <span className={STATUS_CLASS[task.status]}>{statusLabel(task)}</span>
        </div>
      </div>
      <span className="text-sm text-text-muted">
        {projectName} · {task.readOnly ? 'read-only, in your checkout' : task.branch}
        {task.agent && ` · ${describeAgentSettings(task.agent)}`}
      </span>
      {parent && <span className="text-xs text-text-muted">Branched from “{parent.title}”</span>}
      <UsageSummary usage={taskUsage(task)} changes={task.changes} compact />
      {task.error && <span className="text-sm text-status-error">{task.error}</span>}
      <div className="flex gap-4 justify-end">
        <Button size="sm" onClick={onOpen}>
          Chat
        </Button>
        <Button
          size="sm"
          onClick={onBranch}
          title="Start a new task with its own branch from this one"
        >
          New branch from here
        </Button>
        {live && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => transport.send({ type: 'stopTask', taskId: task.id })}
            title={
              task.status === 'done'
                ? 'The agent is waiting for messages; end its session (you can still message it later)'
                : 'Abort the agent'
            }
          >
            {task.status === 'done' ? 'End session' : 'Stop'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Task Board: Live and All tabs; every task opens its chat, any can branch into a new task. */
export function TasksModal({
  view,
  onClose,
  projects,
  tasks,
  permissions,
  onOpenChat,
  onOpenProjects,
}: TasksModalProps) {
  const [tab, setTab] = useState<TaskBoardTab>(view?.tab ?? 'live');
  const [form, setForm] = useState<TaskBoardView['form'] | null>(view?.form ?? null);
  const shown = tab === 'live' ? tasks.filter(isLiveTask) : tasks;
  const paging = usePaging(shown, TASK_BOARD_PAGE_SIZE);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Deleted project';

  return (
    <Modal
      isOpen={view !== null}
      onClose={onClose}
      title="Task Board"
      className="w-[760px] max-w-[95vw]"
    >
      <div className="flex flex-col gap-8 px-10 pb-8 max-h-[78vh] overflow-y-auto">
        {projects.length === 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-text-muted">
              Add a project first: click &quot;+ Add project&quot; on a shelf in the Project
              Directory room.
            </p>
            <Button variant="accent" onClick={onOpenProjects}>
              Add project
            </Button>
          </div>
        ) : form ? (
          <NewTaskForm
            key={form.fromTask?.id ?? 'new'}
            projects={projects}
            fromTask={form.fromTask}
            onStarted={() => {
              setForm(null);
              setTab('live');
            }}
            onCancel={() => setForm(null)}
          />
        ) : (
          <Button variant="accent" className="self-start" onClick={() => setForm({})}>
            + New task
          </Button>
        )}

        <div className="flex gap-4" role="tablist">
          {(['live', 'all'] as const).map((t) => (
            <Button
              key={t}
              size="md"
              role="tab"
              aria-selected={tab === t}
              variant={tab === t ? 'active' : 'default'}
              onClick={() => {
                setTab(t);
                paging.reset();
              }}
            >
              {t === 'live' ? `Live (${tasks.filter(isLiveTask).length})` : `All (${tasks.length})`}
            </Button>
          ))}
        </div>

        {shown.length === 0 && (
          <p className="text-text-muted">
            {tab === 'live' ? 'Nothing running or waiting right now.' : 'No tasks yet.'}
          </p>
        )}
        {paging.pageItems.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            projectName={projectName(t.projectId)}
            parent={t.parentTaskId ? tasks.find((p) => p.id === t.parentTaskId) : undefined}
            waiting={permissions.filter((p) => p.taskId === t.id).length}
            onOpen={() => onOpenChat(t)}
            onBranch={() => setForm({ fromTask: t })}
          />
        ))}
        <Pager page={paging.page} pages={paging.pages} onPrev={paging.prev} onNext={paging.next} />
      </div>
    </Modal>
  );
}
