import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  Account,
  AccountKind,
  AccountRoles,
  AccountTest,
  Project,
} from '../../core/src/messages.js';
import { SERVER_JSON_DIR } from './constants.js';

/**
 * Claude accounts agents run on. Metadata in ~/.pixel-agents/accounts.json; each secret in its own
 * owner-only file, ~/.pixel-agents/accounts/<id>.secret, so it never travels with the metadata and a
 * terminal command can reference it with $(cat …) instead of spelling it out.
 */
const root = () => path.join(os.homedir(), SERVER_JSON_DIR);
const metaFile = () => path.join(root(), 'accounts.json');
const secretsDir = () => path.join(root(), 'accounts');
export const secretFile = (id: string) => path.join(secretsDir(), `${id}.secret`);

/** Environment variable each kind of account is passed to Claude Code in. */
export const CREDENTIAL_ENV: Record<AccountKind, string> = {
  subscription: 'CLAUDE_CODE_OAUTH_TOKEN',
  apiKey: 'ANTHROPIC_API_KEY',
};

interface StoredAccount {
  id: string;
  name: string;
  kind: AccountKind;
  masked: string;
  lastTest?: AccountTest;
}

interface Store {
  accounts: StoredAccount[];
  roles: AccountRoles;
}

function read(): Store {
  try {
    const s = JSON.parse(fs.readFileSync(metaFile(), 'utf-8')) as Partial<Store>;
    return { accounts: s.accounts ?? [], roles: s.roles ?? {} };
  } catch {
    return { accounts: [], roles: {} };
  }
}

function write(store: Store): void {
  fs.mkdirSync(root(), { recursive: true });
  const tmp = `${metaFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, metaFile());
}

function validId(id: string): string {
  // Ids are server-minted UUIDs; anything else could reach outside the secrets folder.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`Invalid account id: ${id}`);
  }
  return id;
}

/** "sk-ant-oat01-…Xy9z": enough to recognise a key, never enough to use it. */
export function maskSecret(secret: string): string {
  return secret.length <= 12 ? '••••' : `${secret.slice(0, 10)}…${secret.slice(-4)}`;
}

/** A pasted secret must look like what its kind produces (catches pasting the wrong one). */
export function checkSecret(kind: AccountKind, secret: string): string {
  const s = secret.trim();
  if (!s) throw new Error('Paste the token or key');
  if (/\s/.test(s)) throw new Error('The token or key must be a single line without spaces');
  if (kind === 'apiKey' && !s.startsWith('sk-ant-api')) {
    throw new Error('That does not look like an Anthropic API key (sk-ant-api…)');
  }
  if (kind === 'subscription' && !s.startsWith('sk-ant-oat')) {
    throw new Error('That does not look like a `claude setup-token` token (sk-ant-oat…)');
  }
  return s;
}

export function listAccounts(): { accounts: Account[]; roles: AccountRoles } {
  return read();
}

export function saveAccount(input: {
  id: string;
  name: string;
  kind: AccountKind;
  secret?: string;
}): Account {
  const name = input.name.trim();
  if (!name) throw new Error('Give the account a name');
  if (input.kind !== 'subscription' && input.kind !== 'apiKey') throw new Error('Unknown kind');
  const store = read();
  const existing = input.id ? store.accounts.find((a) => a.id === validId(input.id)) : undefined;
  if (input.id && !existing) throw new Error('Unknown account');
  const kindChanged = existing && existing.kind !== input.kind;
  if (!existing || input.secret?.trim() || kindChanged) {
    // New accounts, a new secret, or a kind change all need a (matching) secret.
    const secret = checkSecret(input.kind, input.secret ?? '');
    const id = existing?.id ?? crypto.randomUUID();
    fs.mkdirSync(secretsDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(secretFile(id), secret, { encoding: 'utf-8', mode: 0o600 });
    const account: StoredAccount = { id, name, kind: input.kind, masked: maskSecret(secret) };
    store.accounts = existing
      ? store.accounts.map((a) => (a.id === id ? account : a))
      : [...store.accounts, account];
    write(store);
    return account;
  }
  existing.name = name;
  write(store);
  return existing;
}

/** Removes the account and its secret; roles using it fall back to the owner's own login. */
export function deleteAccount(id: string): void {
  validId(id);
  const store = read();
  store.accounts = store.accounts.filter((a) => a.id !== id);
  for (const role of ['dev', 'qa', 'router'] as const) {
    if (store.roles[role] === id) delete store.roles[role];
  }
  write(store);
  fs.rmSync(secretFile(id), { force: true });
}

export function setRoles(roles: AccountRoles): AccountRoles {
  const store = read();
  const known = new Set(store.accounts.map((a) => a.id));
  const clean: AccountRoles = {};
  for (const role of ['dev', 'qa', 'router'] as const) {
    const id = roles[role];
    if (id && known.has(id)) clean[role] = id;
  }
  store.roles = clean;
  write(store);
  return clean;
}

export function recordTest(id: string, test: AccountTest): void {
  const store = read();
  const account = store.accounts.find((a) => a.id === id);
  if (!account) return;
  account.lastTest = test;
  write(store);
}

/** The account a role runs on for a project: the project's choice, else the global one, else none. */
export function accountFor(role: keyof AccountRoles, project?: Project): string | undefined {
  const store = read();
  const exists = (id?: string) => !!id && store.accounts.some((a) => a.id === id);
  // A project's pick that was since deleted falls back to the global one.
  for (const id of [project?.accountRoles?.[role], store.roles[role]]) if (exists(id)) return id;
  return undefined;
}

/**
 * The environment an agent process starts with: the server's own, with exactly one credential —
 * the account's — set, and the other kind removed so it can't take precedence. No account: the
 * owner's own Claude Code login, untouched.
 */
export function envForAccount(
  id: string | undefined,
): Record<string, string | undefined> | undefined {
  if (!id) return undefined;
  const account = read().accounts.find((a) => a.id === id);
  if (!account) throw new Error('The account this agent runs on no longer exists');
  const secret = fs.readFileSync(secretFile(validId(id)), 'utf-8').trim();
  const env: Record<string, string | undefined> = { ...process.env };
  for (const name of Object.values(CREDENTIAL_ENV)) delete env[name];
  env[CREDENTIAL_ENV[account.kind]] = secret;
  return env;
}
