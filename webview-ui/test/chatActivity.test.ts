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

test('resume command: the task folder plus its session, safely quoted; none once Done removed it', async () => {
  const { resumeCommand } = await import('../src/taskStatus.js');
  const t = task({ sessionId: 'abc-123', worktree: '/wt/vh/c231' });
  assert.equal(resumeCommand(t), 'cd "/wt/vh/c231" && claude --resume abc-123');
  assert.equal(
    resumeCommand(task({ sessionId: 's', worktree: '/a "b" $HOME `x`' })),
    'cd "/a \\"b\\" \\$HOME \\`x\\`" && claude --resume s',
  );
  assert.equal(resumeCommand(task({ worktree: '/wt' })), undefined, 'no session yet');
  assert.equal(resumeCommand({ ...t, stage: 'delivered' }), undefined, 'worktree removed by Done');
  assert.ok(
    resumeCommand({ ...t, stage: 'delivered', readOnly: true }),
    'read-only: your own repo stays',
  );
});
