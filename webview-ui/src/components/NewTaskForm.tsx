import { useState } from 'react';

import type { AgentSettings, BranchMode, Project, Task } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { AgentSettingsFields } from './AgentSettingsFields.js';
import { BranchPicker } from './BranchPicker.js';
import { inputClass } from './ProjectRoomModal.js';
import { Button } from './ui/Button.js';

interface NewTaskFormProps {
  projects: Project[];
  /** "New branch from here": the project is fixed and its branch preselected in every repo. */
  fromTask?: Task;
  onStarted: () => void;
  onCancel: () => void;
}

export function NewTaskForm({ projects, fromTask, onStarted, onCancel }: NewTaskFormProps) {
  const [projectId, setProjectId] = useState(fromTask?.projectId ?? projects[0]?.id ?? '');
  const project = projects.find((p) => p.id === projectId);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState<AgentSettings>({});
  const [carryContext, setCarryContext] = useState(!!fromTask?.sessionId);
  const [branchMode, setBranchMode] = useState<BranchMode>('auto');
  const [baseBranches, setBaseBranches] = useState<Record<string, string>>(() =>
    fromTask?.branch && project
      ? Object.fromEntries(project.repos.map((r) => [r.name, fromTask.branch!]))
      : {},
  );

  const ready = !!project && !!title.trim() && !!prompt.trim();
  const start = () => {
    transport.send({
      type: 'startTask',
      projectId,
      title,
      prompt,
      agent,
      baseBranches,
      fromTaskId: fromTask?.id,
      branchMode: fromTask ? 'branch' : branchMode,
      carryContext: fromTask ? carryContext : undefined,
    });
    onStarted();
  };

  return (
    <div className="flex flex-col gap-6 border-2 border-accent p-6">
      <span className="text-accent-bright">
        {fromTask ? `New branch from "${fromTask.title}"` : 'New task'}
      </span>
      {!fromTask && (
        <label className="flex flex-col gap-2">
          Project
          <select
            className={inputClass}
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setBaseBranches({});
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.repos.map((r) => r.name).join(' + ')})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-2">
        Title
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-2">
        Instructions
        <textarea
          className={`${inputClass} min-h-[110px]`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      {!fromTask && (
        <label className="flex flex-col gap-2">
          Branch
          <select
            className={inputClass}
            value={branchMode}
            onChange={(e) => setBranchMode(e.target.value as BranchMode)}
          >
            <option value="auto">
              Auto — Haiku decides: changes get a branch, questions don&apos;t
            </option>
            <option value="branch">Always cut a branch</option>
            <option value="none">No branch — read-only, in my checkout</option>
          </select>
        </label>
      )}
      {project && branchMode !== 'none' && (
        <BranchPicker
          key={project.id}
          project={project}
          value={baseBranches}
          onChange={setBaseBranches}
        />
      )}
      {fromTask && (
        <label className="flex gap-4 items-start">
          <input
            type="checkbox"
            className="mt-2"
            checked={carryContext}
            disabled={!fromTask.sessionId}
            onChange={(e) => setCarryContext(e.target.checked)}
          />
          <span className="flex flex-col">
            Carry the conversation over
            <span className="text-sm text-text-muted">
              The new agent starts as a copy of this task&apos;s chat and remembers everything; this
              task is left untouched. Off: a fresh agent with the project brief, docs and memory.
            </span>
          </span>
        </label>
      )}
      <details>
        <summary className="cursor-pointer text-text-muted">
          Agent settings for this task (empty = project / defaults)
        </summary>
        <div className="pt-4">
          <AgentSettingsFields value={agent} onChange={setAgent} inheritLabel="inherit" />
        </div>
      </details>
      <div className="flex gap-4 justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={ready ? 'accent' : 'disabled'} disabled={!ready} onClick={start}>
          Start task
        </Button>
      </div>
    </div>
  );
}
