import { useEffect, useState } from 'react';

import type { AgentSettings, PermissionAsked, Project, Task } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';

/** Blank form for a new project: one empty repo. */
export const NEW_PROJECT: Project = {
  id: '',
  name: '',
  repos: [{ name: '', path: '', defaultBranch: 'main' }],
};

export interface TasksState {
  projects: Project[];
  tasks: Task[];
  permissions: PermissionAsked[];
  agentDefaults: AgentSettings;
  reviewerDefaults: AgentSettings;
  error: string | null;
  clearError: () => void;
}

/** Project Room + task state. Must be called before useExtensionMessages, which sends webviewReady. */
export function useTasks(): TasksState {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [permissions, setPermissions] = useState<PermissionAsked[]>([]);
  const [agentDefaults, setAgentDefaults] = useState<AgentSettings>({});
  const [reviewerDefaults, setReviewerDefaults] = useState<AgentSettings>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      transport.onMessage((msg) => {
        switch (msg.type) {
          case 'projectsLoaded':
            setProjects(msg.projects);
            break;
          case 'tasksLoaded':
            setTasks(msg.tasks);
            break;
          case 'permissionAsked':
            setPermissions((list) =>
              list.some((p) => p.requestId === msg.requestId) ? list : [...list, msg],
            );
            break;
          case 'permissionResolved':
            setPermissions((list) => list.filter((p) => p.requestId !== msg.requestId));
            break;
          case 'agentDefaultsLoaded':
            setAgentDefaults(msg.defaults);
            setReviewerDefaults(msg.reviewer ?? {});
            break;
          case 'actionError':
            setError(msg.message);
            break;
        }
      }),
    [],
  );

  return {
    projects,
    tasks,
    permissions,
    agentDefaults,
    reviewerDefaults,
    error,
    clearError: () => setError(null),
  };
}
