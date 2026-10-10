import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Task } from '../../core/src/messages.js';
import { chatActivity } from '../src/taskStatus.js';

const task = (over: Partial<Task>): Task =>
  ({ id: 't', projectId: 'p', title: 't', status: 'done', createdAt: 0, ...over }) as Task;

test('dev chat follows its task: shown only while queued, preparing or running', () => {
  assert.deepEqual(
    chatActivity({ task: task({ status: 'done' }), isReviewer: false, agentActive: true }),
    {
      working: false,
    },
  );
  assert.equal(
    chatActivity({ task: task({ status: 'queued' }), isReviewer: false, agentActive: false }).label,
    'Waiting for a free seat in the Dev Team',
  );
  assert.deepEqual(
    chatActivity({ task: task({ status: 'running' }), isReviewer: false, agentActive: false }),
    {
      working: true,
      label: undefined,
    },
  );
  assert.equal(
    chatActivity({
      task: task({ status: 'running' }),
      isReviewer: false,
      agentActive: false,
      runningToolName: 'Bash',
    }).label,
    'Running Bash',
  );
});

test('QA chat follows the review, not the dev task', () => {
  const t = task({ status: 'running', stage: 'approved' });
  assert.equal(chatActivity({ task: t, isReviewer: true, agentActive: true }).working, false);
  assert.equal(
    chatActivity({ task: { ...t, stage: 'reviewing' }, isReviewer: true, agentActive: false })
      .working,
    true,
  );
});

test('other agents follow the office: nothing shown when idle', () => {
  assert.equal(chatActivity({ isReviewer: false, agentActive: false }).working, false);
  assert.equal(chatActivity({ isReviewer: false, agentActive: true }).working, true);
});
