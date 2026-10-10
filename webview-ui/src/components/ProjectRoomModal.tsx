import { useState } from 'react';

import type {
  Account,
  AccountRoles,
  AgentSettings,
  Project,
  ProjectRepo,
  Task,
} from '../../../core/src/messages.js';
import { NEW_PROJECT } from '../hooks/useTasks.js';
import { transport } from '../transport/index.js';
import { sumTasks } from '../usageFormat.js';
import { AccountSelect, AccountsSection } from './AccountsSection.js';
import { AgentSettingsFields } from './AgentSettingsFields.js';
import { describeAgentSettings } from './describeAgentSettings.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { UsageSummary } from './UsageSummary.js';

export const inputClass =
  'w-full bg-bg-dark border-2 border-border rounded-none px-6 py-2 text-base text-text';

/** Opens the server's native folder dialog; resolves to the chosen path, or undefined if cancelled. */
function pickFolder(): Promise<string | undefined> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const unsubscribe = transport.onMessage((msg) => {
      if (msg.type !== 'folderPicked' || msg.requestId !== requestId) return;
      unsubscribe();
      resolve(msg.path);
    });
    transport.send({ type: 'pickFolder', requestId });
  });
}

function RepoFields({
  repo,
  onChange,
  onRemove,
}: {
  repo: ProjectRepo;
  onChange: (repo: ProjectRepo) => void;
  onRemove?: () => void;
}) {
  const set = (field: keyof ProjectRepo) => (e: { target: { value: string } }) =>
    onChange({ ...repo, [field]: e.target.value });
  const browse = async () => {
    const path = await pickFolder();
    if (path) onChange({ ...repo, path, name: repo.name || path.split('/').pop() || '' });
  };
  return (
    <div className="border-2 border-border p-6 flex flex-col gap-4">
      <div className="flex gap-4 items-end">
        <label className="flex flex-col gap-2 flex-1">
          Folder
          <input
            className={inputClass}
            value={repo.path}
            onChange={set('path')}
            placeholder="~/code/my-service"
          />
        </label>
        <Button size="md" onClick={browse}>
          Browse…
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-2">
          Name in workspace
          <input
            className={inputClass}
            value={repo.name}
            onChange={set('name')}
            placeholder="frontend"
          />
        </label>
        <label className="flex flex-col gap-2">
          Default branch
          <input
            className={inputClass}
            value={repo.defaultBranch}
            onChange={set('defaultBranch')}
          />
        </label>
        <label className="flex flex-col gap-2">
          Setup command
          <input
            className={inputClass}
            value={repo.setupCommand ?? ''}
            onChange={set('setupCommand')}
            placeholder="npm ci"
          />
        </label>
        <label className="flex flex-col gap-2">
          Test command
          <input
            className={inputClass}
            value={repo.testCommand ?? ''}
            onChange={set('testCommand')}
            placeholder="npm test"
          />
        </label>
      </div>
      {onRemove && (
        <Button size="sm" variant="ghost" className="self-end" onClick={onRemove}>
          Remove repo
        </Button>
      )}
    </div>
  );
}

function ProjectTotals({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return <span className="text-sm text-text-muted">No tasks yet</span>;
  const { usage, changes } = sumTasks(tasks);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-text-muted">
        {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} — totals:
      </span>
      <UsageSummary usage={usage} changes={changes} />
    </div>
  );
}

interface ProjectRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  agentDefaults: AgentSettings;
  reviewerDefaults: AgentSettings;
  accounts: Account[];
  accountRoles: AccountRoles;
  /** For per-project usage and code totals. */
  tasks: Task[];
  /** Open straight into this project's form (NEW_PROJECT for a new one); null shows the list. */
  initialEdit: Project | null;
}

export function ProjectRoomModal({
  isOpen,
  onClose,
  projects,
  agentDefaults,
  reviewerDefaults,
  accounts,
  accountRoles,
  tasks,
  initialEdit,
}: ProjectRoomModalProps) {
  const [editing, setEditing] = useState<Project | null>(initialEdit);
  const [editingDefaults, setEditingDefaults] = useState<{
    defaults: AgentSettings;
    reviewer: AgentSettings;
  } | null>(null);

  const setRepo = (i: number, repo: ProjectRepo | null) =>
    setEditing((p) =>
      p
        ? {
            ...p,
            repos: repo
              ? p.repos.map((r, j) => (j === i ? repo : r))
              : p.repos.filter((_, j) => j !== i),
          }
        : p,
    );

  const save = () => {
    if (!editing) return;
    transport.send({ type: 'saveProject', project: editing });
    setEditing(null);
  };

  const remove = (p: Project) => {
    if (confirm(`Delete "${p.name}" with its docs and memory? The repos are not touched.`)) {
      transport.send({ type: 'deleteProject', id: p.id });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Project Directory"
      className="w-[720px] max-w-[95vw]"
    >
      <div className="flex flex-col gap-8 px-10 pb-8 max-h-[75vh] overflow-y-auto">
        {editing ? (
          <>
            <label className="flex flex-col gap-2">
              Project name
              <input
                className={inputClass}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </label>
            <div className="flex flex-col gap-4">
              <span>
                Repos — one for a single repo, several for a workspace (e.g. frontend + backend).
                Each task gets its own branch in every repo.
              </span>
              {editing.repos.map((repo, i) => (
                <RepoFields
                  key={i}
                  repo={repo}
                  onChange={(r) => setRepo(i, r)}
                  onRemove={editing.repos.length > 1 ? () => setRepo(i, null) : undefined}
                />
              ))}
              <Button
                size="md"
                className="self-start"
                onClick={() =>
                  setEditing({ ...editing, repos: [...editing.repos, NEW_PROJECT.repos[0]] })
                }
              >
                + Add repo
              </Button>
            </div>
            {accounts.length > 0 && (
              <div className="flex flex-col gap-2">
                Claude accounts for this project (empty = the defaults)
                <div className="grid grid-cols-2 gap-4">
                  {(['dev', 'qa'] as const).map((role) => (
                    <label key={role} className="flex flex-col gap-2 text-sm">
                      {role === 'dev' ? 'Dev agents' : 'QA reviewers'}
                      <AccountSelect
                        accounts={accounts}
                        value={editing.accountRoles?.[role]}
                        onChange={(id) =>
                          setEditing({
                            ...editing,
                            accountRoles: { ...editing.accountRoles, [role]: id },
                          })
                        }
                        emptyLabel="Use the defaults"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex flex-col gap-2">
              QA review rounds per task (0 = no QA review; empty = 3)
              <input
                className={`${inputClass} w-[120px]`}
                type="number"
                min={0}
                max={10}
                value={editing.maxReviewRounds ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    maxReviewRounds: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
            <div className="flex flex-col gap-2">
              Agent settings for this project (empty = use the defaults)
              <AgentSettingsFields
                value={editing.agent}
                onChange={(agent) => setEditing({ ...editing, agent })}
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
                        transport.send({ type: 'saveAgentDefaults', ...editingDefaults });
                        setEditingDefaults(null);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditingDefaults({ defaults: agentDefaults, reviewer: reviewerDefaults })
                    }
                  >
                    Edit
                  </Button>
                )}
              </div>
              {editingDefaults ? (
                <>
                  <span className="text-sm">Dev agents</span>
                  <AgentSettingsFields
                    value={editingDefaults.defaults}
                    onChange={(defaults) => setEditingDefaults({ ...editingDefaults, defaults })}
                    inheritLabel="Claude Code default"
                  />
                  <span className="text-sm">QA reviewer (overrides the task&apos;s settings)</span>
                  <AgentSettingsFields
                    value={editingDefaults.reviewer}
                    onChange={(reviewer) => setEditingDefaults({ ...editingDefaults, reviewer })}
                    inheritLabel="same as the task"
                  />
                </>
              ) : (
                <span className="text-sm text-text-muted">
                  Devs: {describeAgentSettings(agentDefaults) || 'Claude Code defaults'} · QA:{' '}
                  {describeAgentSettings(reviewerDefaults) || 'same as the task'} — projects and
                  tasks can override the dev settings.
                </span>
              )}
            </div>
            <AccountsSection accounts={accounts} roles={accountRoles} />
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
                {p.repos.map((r) => (
                  <span key={r.name} className="text-sm text-text-muted">
                    {r.name}: {r.path} · {r.defaultBranch}
                  </span>
                ))}
                {p.agent && (
                  <span className="text-sm text-text-muted">
                    Agents: {describeAgentSettings(p.agent)}
                  </span>
                )}
                <ProjectTotals tasks={tasks.filter((t) => t.projectId === p.id)} />
                <span className="text-xs text-text-muted">Docs + memory: {p.dir}</span>
              </div>
            ))}
            <Button variant="accent" onClick={() => setEditing(NEW_PROJECT)}>
              + Project
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
