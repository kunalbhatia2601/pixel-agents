import { useEffect, useState } from 'react';

import type { Project, RepoBranches } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { inputClass } from './ProjectRoomModal.js';

/** Most matches listed under a search box; typing narrows further. */
const MAX_SHOWN = 50;

interface BranchPickerProps {
  project: Project;
  /** Repo name → chosen base branch; missing = the repo's default branch. */
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

/** One searchable branch list per repo, fetched fresh (all remotes) when the project changes. */
export function BranchPicker({ project, value, onChange }: BranchPickerProps) {
  const [repos, setRepos] = useState<RepoBranches[] | null>(null);
  const [query, setQuery] = useState<Record<string, string>>({});

  useEffect(() => {
    setRepos(null);
    const requestId = crypto.randomUUID();
    const unsubscribe = transport.onMessage((msg) => {
      if (msg.type !== 'branchesListed' || msg.requestId !== requestId) return;
      unsubscribe();
      setRepos(msg.repos);
    });
    transport.send({ type: 'listBranches', requestId, projectId: project.id });
    return unsubscribe;
  }, [project.id]);

  if (!repos) return <span className="text-sm text-text-muted">Fetching branches…</span>;

  return (
    <div className="flex flex-col gap-6">
      {project.repos.map((repo) => {
        const listed = repos.find((r) => r.repo === repo.name);
        const chosen = value[repo.name] ?? '';
        const q = (query[repo.name] ?? '').toLowerCase();
        const matches = (listed?.branches ?? []).filter((b) => b.toLowerCase().includes(q));
        const pick = (branch: string) => {
          const next = { ...value };
          if (branch) next[repo.name] = branch;
          else delete next[repo.name];
          onChange(next);
        };
        return (
          <div key={repo.name} className="flex flex-col gap-2">
            <span>
              {project.repos.length > 1 ? `${repo.name}: ` : ''}start from{' '}
              <span className="text-accent-bright">
                {chosen || `${repo.defaultBranch} (default, latest from origin)`}
              </span>
            </span>
            {listed?.fetchError && (
              <span className="text-xs text-warning">
                Couldn&apos;t fetch ({listed.fetchError}); showing branches known locally.
              </span>
            )}
            <input
              className={inputClass}
              placeholder={`Search ${listed?.branches.length ?? 0} branches…`}
              value={query[repo.name] ?? ''}
              onChange={(e) => setQuery({ ...query, [repo.name]: e.target.value })}
            />
            <div
              className="flex flex-col max-h-[150px] overflow-y-auto border-2 border-border"
              role="listbox"
              aria-label={`Branches of ${repo.name}`}
            >
              <button
                role="option"
                aria-selected={!chosen}
                onClick={() => pick('')}
                className={`text-left px-6 py-1 text-sm cursor-pointer ${!chosen ? 'bg-active-bg' : 'hover:bg-btn-hover'}`}
              >
                Default branch ({repo.defaultBranch})
              </button>
              {matches.slice(0, MAX_SHOWN).map((b) => (
                <button
                  key={b}
                  role="option"
                  aria-selected={b === chosen}
                  onClick={() => pick(b)}
                  className={`text-left px-6 py-1 text-sm font-mono cursor-pointer ${b === chosen ? 'bg-active-bg' : 'hover:bg-btn-hover'}`}
                >
                  {b}
                </button>
              ))}
              {matches.length > MAX_SHOWN && (
                <span className="px-6 py-1 text-xs text-text-muted">
                  {matches.length - MAX_SHOWN} more — keep typing to narrow
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
