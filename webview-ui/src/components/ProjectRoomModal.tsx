import { useState } from 'react';

import type { AgentSettings, Project } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { AgentSettingsFields } from './AgentSettingsFields.js';
import { describeAgentSettings } from './describeAgentSettings.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export const inputClass =
  'w-full bg-bg-dark border-2 border-border rounded-none px-6 py-2 text-base text-text';

const EMPTY: Project = { id: '', name: '', repoPath: '', defaultBranch: 'main' };

interface ProjectRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  agentDefaults: AgentSettings;
}

export function ProjectRoomModal({
  isOpen,
  onClose,
  projects,
  agentDefaults,
}: ProjectRoomModalProps) {
  const [editing, setEditing] = useState<Project | null>(null);
  const [editingDefaults, setEditingDefaults] = useState<AgentSettings | null>(null);

  const set = (field: keyof Project) => (e: { target: { value: string } }) =>
    setEditing((p) => (p ? { ...p, [field]: e.target.value } : p));

  const save = () => {
    if (!editing) return;
    transport.send({ type: 'saveProject', project: editing });
    setEditing(null);
  };

  const remove = (p: Project) => {
    if (confirm(`Delete "${p.name}" with its docs and memory? The repo itself is not touched.`)) {
      transport.send({ type: 'deleteProject', id: p.id });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Project Room"
      className="w-[640px] max-w-[95vw]"
    >
      <div className="flex flex-col gap-8 px-10 pb-8 max-h-[70vh] overflow-y-auto">
        {editing ? (
          <>
            <label className="flex flex-col gap-2">
              Name
              <input className={inputClass} value={editing.name} onChange={set('name')} />
            </label>
            <label className="flex flex-col gap-2">
              Repo path
              <input
                className={inputClass}
                value={editing.repoPath}
                onChange={set('repoPath')}
                placeholder="~/code/my-service"
              />
            </label>
            <label className="flex flex-col gap-2">
              Default branch (each task branches from its latest)
              <input
                className={inputClass}
                value={editing.defaultBranch}
                onChange={set('defaultBranch')}
              />
            </label>
            <label className="flex flex-col gap-2">
              Setup command (optional, runs in each new worktree)
              <input
                className={inputClass}
                value={editing.setupCommand ?? ''}
                onChange={set('setupCommand')}
                placeholder="npm ci"
              />
            </label>
            <label className="flex flex-col gap-2">
              Test command (optional, given to the agent)
              <input
                className={inputClass}
                value={editing.testCommand ?? ''}
                onChange={set('testCommand')}
                placeholder="npm test"
              />
            </label>
            <div className="flex flex-col gap-2">
              Agent settings for this project (empty = use the defaults)
              <AgentSettingsFields
                value={editing.agent}
                onChange={(agent) => setEditing((p) => (p ? { ...p, agent } : p))}
                inheritLabel="defaults"
              />
            </div>
            <div className="flex gap-4 justify-end">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="accent" onClick={save}>
                Save
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="border-2 border-border p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-lg">Default agent settings</span>
                {editingDefaults ? (
                  <div className="flex gap-4">
                    <Button size="sm" variant="ghost" onClick={() => setEditingDefaults(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="accent"
                      onClick={() => {
                        transport.send({ type: 'saveAgentDefaults', defaults: editingDefaults });
                        setEditingDefaults(null);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" onClick={() => setEditingDefaults(agentDefaults)}>
                    Edit
                  </Button>
                )}
              </div>
              {editingDefaults ? (
                <AgentSettingsFields
                  value={editingDefaults}
                  onChange={setEditingDefaults}
                  inheritLabel="Claude Code default"
                />
              ) : (
                <span className="text-sm text-text-muted">
                  {describeAgentSettings(agentDefaults) || 'Claude Code defaults'} — projects and
                  tasks can override.
                </span>
              )}
            </div>
            {projects.length === 0 && (
              <p className="text-text-muted">No projects yet. Add one to start giving tasks.</p>
            )}
            {projects.map((p) => (
              <div key={p.id} className="border-2 border-border p-6 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-lg text-accent-bright">{p.name}</span>
                  <div className="flex gap-4">
                    <Button size="sm" onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <span className="text-sm text-text-muted">
                  {p.repoPath} · {p.defaultBranch}
                </span>
                {p.agent && (
                  <span className="text-sm text-text-muted">
                    Agents: {describeAgentSettings(p.agent)}
                  </span>
                )}
                <span className="text-xs text-text-muted">Docs + memory: {p.dir}</span>
              </div>
            ))}
            <Button variant="accent" onClick={() => setEditing(EMPTY)}>
              + Project
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
