import { useState } from 'react';

import type { AgentSettings, Project, Task } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { AgentSettingsFields } from './AgentSettingsFields.js';
import { describeAgentSettings } from './describeAgentSettings.js';
import { inputClass } from './ProjectRoomModal.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { UsageSummary } from './UsageSummary.js';

const STATUS_CLASS: Record<Task['status'], string> = {
  preparing: 'text-text-muted',
  running: 'text-status-active',
  done: 'text-status-success',
  failed: 'text-status-error',
  stopped: 'text-warning',
};

interface TasksModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  tasks: Task[];
  onOpenProjects: () => void;
}

export function TasksModal({ isOpen, onClose, projects, tasks, onOpenProjects }: TasksModalProps) {
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState<AgentSettings>({});
  const selected = projectId || projects[0]?.id || '';
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Deleted project';

  const start = () => {
    transport.send({ type: 'startTask', projectId: selected, title, prompt, agent });
    setTitle('');
    setPrompt('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Tasks" className="w-[720px] max-w-[95vw]">
      <div className="flex flex-col gap-8 px-10 pb-8 max-h-[75vh] overflow-y-auto">
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
        ) : (
          <div className="flex flex-col gap-6 border-2 border-border p-6">
            <label className="flex flex-col gap-2">
              Project
              <select
                className={inputClass}
                value={selected}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.repos.map((r) => r.name).join(' + ')})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              Title
              <input
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              Instructions
              <textarea
                className={`${inputClass} min-h-[120px]`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            <details>
              <summary className="cursor-pointer text-text-muted">
                Agent settings for this task (empty = project / defaults)
              </summary>
              <div className="pt-4">
                <AgentSettingsFields value={agent} onChange={setAgent} inheritLabel="inherit" />
              </div>
            </details>
            <Button
              variant={title.trim() && prompt.trim() ? 'accent' : 'disabled'}
              disabled={!title.trim() || !prompt.trim()}
              onClick={start}
            >
              Start task
            </Button>
          </div>
        )}

        {tasks.map((t) => (
          <div key={t.id} className="border-2 border-border p-6 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-lg">{t.title}</span>
              <div className="flex items-center gap-4">
                <span className={STATUS_CLASS[t.status]}>{t.status}</span>
                {(t.status === 'running' || t.status === 'preparing' || t.sessionOpen) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => transport.send({ type: 'stopTask', taskId: t.id })}
                    title={
                      t.status === 'done'
                        ? 'The agent is waiting for messages; end its session'
                        : 'Abort the agent'
                    }
                  >
                    {t.status === 'done' ? 'End session' : 'Stop'}
                  </Button>
                )}
              </div>
            </div>
            <span className="text-sm text-text-muted">
              {projectName(t.projectId)} · {t.branch}
              {t.agent && ` · ${describeAgentSettings(t.agent)}`}
            </span>
            <UsageSummary usage={t.usage} changes={t.changes} compact />
            {t.worktree && <span className="text-xs text-text-muted">{t.worktree}</span>}
            {t.error && <span className="text-sm text-status-error">{t.error}</span>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
