import { useState } from 'react';

import type { Account, AccountKind, AccountRoles } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import { inputClass } from './ProjectRoomModal.js';
import { Button } from './ui/Button.js';

const KIND_LABEL: Record<AccountKind, string> = {
  subscription: 'Claude subscription',
  apiKey: 'API key',
};

const ROLES: Array<{ role: keyof AccountRoles; label: string }> = [
  { role: 'dev', label: 'Dev agents' },
  { role: 'qa', label: 'QA reviewers' },
  { role: 'router', label: 'Router (branch or not)' },
];

interface Draft {
  id: string;
  name: string;
  kind: AccountKind;
  secret: string;
}

/** A select of accounts for one role; empty = the owner's own Claude Code login (or "use defaults"). */
export function AccountSelect({
  accounts,
  value,
  onChange,
  emptyLabel,
}: {
  accounts: Account[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  emptyLabel: string;
}) {
  return (
    <select
      className={inputClass}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{emptyLabel}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({KIND_LABEL[a.kind]})
        </option>
      ))}
    </select>
  );
}

/** Claude accounts agents can run on, and which one each role uses by default. */
export function AccountsSection({ accounts, roles }: { accounts: Account[]; roles: AccountRoles }) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = () => {
    if (!draft) return;
    transport.send({
      type: 'saveAccount',
      id: draft.id,
      name: draft.name,
      kind: draft.kind,
      secret: draft.secret.trim() || undefined,
    });
    setDraft(null);
  };
  const setRole = (role: keyof AccountRoles, id: string | undefined) =>
    transport.send({ type: 'setAccountRoles', roles: { ...roles, [role]: id } });

  return (
    <div className="border-2 border-border p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-lg">Claude accounts</span>
        {!draft && (
          <Button
            size="sm"
            onClick={() => setDraft({ id: '', name: '', kind: 'subscription', secret: '' })}
          >
            + Account
          </Button>
        )}
      </div>

      {accounts.length === 0 && !draft && (
        <span className="text-sm text-text-muted">
          None yet — every agent uses your own Claude Code login. Add accounts to give teams their
          own.
        </span>
      )}

      {accounts.map((a) => (
        <div key={a.id} className="flex items-center gap-4 flex-wrap">
          <span className="min-w-[140px]">{a.name}</span>
          <span className="text-xs text-text-muted">{KIND_LABEL[a.kind]}</span>
          <code className="text-xs bg-bg-dark px-4">{a.masked}</code>
          {a.lastTest && (
            <span
              className={`text-xs ${a.lastTest.ok ? 'text-status-success' : 'text-status-error'}`}
              title={a.lastTest.message}
            >
              {a.lastTest.ok ? '✓ works' : `✗ ${a.lastTest.message ?? 'failed'}`}
            </span>
          )}
          <span className="flex-1" />
          <Button size="sm" onClick={() => transport.send({ type: 'testAccount', id: a.id })}>
            Test
          </Button>
          <Button
            size="sm"
            onClick={() => setDraft({ id: a.id, name: a.name, kind: a.kind, secret: '' })}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Delete "${a.name}"? Roles using it go back to your own login.`)) {
                transport.send({ type: 'deleteAccount', id: a.id });
              }
            }}
          >
            Delete
          </Button>
        </div>
      ))}

      {draft && (
        <div className="flex flex-col gap-4 border-2 border-accent p-6">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-2">
              Name
              <input
                className={inputClass}
                value={draft.name}
                placeholder="QA team"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2">
              Type
              <select
                className={inputClass}
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as AccountKind })}
              >
                <option value="subscription">Claude subscription (Pro / Max)</option>
                <option value="apiKey">Anthropic API key</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-2">
            {draft.kind === 'subscription' ? 'Token' : 'API key'}
            <input
              className={inputClass}
              type="password"
              autoComplete="off"
              value={draft.secret}
              placeholder={
                draft.id
                  ? 'Leave empty to keep the stored one'
                  : 'Paste it here (stays on your Mac)'
              }
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
            />
            <span className="text-xs text-text-muted">
              {draft.kind === 'subscription'
                ? 'Log into that account in a terminal and run: claude setup-token — then paste the sk-ant-oat… token it prints.'
                : 'Create one at console.anthropic.com → API keys (sk-ant-api…).'}
            </span>
          </label>
          <div className="flex gap-4 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="accent" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-4 pt-2">
          {ROLES.map(({ role, label }) => (
            <label key={role} className="flex flex-col gap-2 text-sm">
              {label}
              <AccountSelect
                accounts={accounts}
                value={roles[role]}
                onChange={(id) => setRole(role, id)}
                emptyLabel="Your own login"
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
