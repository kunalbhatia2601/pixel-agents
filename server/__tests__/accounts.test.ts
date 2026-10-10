import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tempHome };
});

// Must import AFTER mock setup.
const {
  accountFor,
  deleteAccount,
  envForAccount,
  listAccounts,
  saveAccount,
  secretFile,
  setRoles,
} = await import('../src/accounts.js');

const TOKEN = 'sk-ant-oat01-' + 'a'.repeat(40) + 'WXYZ';
const KEY = 'sk-ant-api03-' + 'b'.repeat(40) + 'K3Y9';

describe('accounts', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-accounts-test-'));
  });
  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('stores the secret apart, owner-only, and only ever lists a masked preview', () => {
    const a = saveAccount({ id: '', name: 'Dev team', kind: 'subscription', secret: TOKEN });
    const listed = JSON.stringify(listAccounts());
    expect(listed).not.toContain(TOKEN);
    expect(listed).toContain('sk-ant-oat…WXYZ');
    expect(fs.readFileSync(secretFile(a.id), 'utf-8')).toBe(TOKEN);
    expect(fs.statSync(secretFile(a.id)).mode & 0o777).toBe(0o600);
    const meta = fs.readFileSync(path.join(tempHome, '.pixel-agents', 'accounts.json'), 'utf-8');
    expect(meta).not.toContain(TOKEN);
  });

  it('rejects the wrong kind of secret, and keeps the old secret on a rename', () => {
    expect(() => saveAccount({ id: '', name: 'x', kind: 'apiKey', secret: TOKEN })).toThrow(
      /API key/,
    );
    expect(() => saveAccount({ id: '', name: 'x', kind: 'subscription', secret: KEY })).toThrow(
      /setup-token/,
    );
    const a = saveAccount({ id: '', name: 'QA', kind: 'apiKey', secret: KEY });
    saveAccount({ id: a.id, name: 'QA team', kind: 'apiKey' });
    expect(listAccounts().accounts[0].name).toBe('QA team');
    expect(fs.readFileSync(secretFile(a.id), 'utf-8')).toBe(KEY);
  });

  it('gives each agent exactly its own credential, and nothing for the owner login', () => {
    const sub = saveAccount({ id: '', name: 'Dev', kind: 'subscription', secret: TOKEN });
    const api = saveAccount({ id: '', name: 'QA', kind: 'apiKey', secret: KEY });
    process.env.ANTHROPIC_API_KEY = 'inherited-should-not-leak';
    try {
      const devEnv = envForAccount(sub.id)!;
      expect(devEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
      expect(devEnv.ANTHROPIC_API_KEY).toBeUndefined();
      expect(devEnv.PATH).toBe(process.env.PATH);
      const qaEnv = envForAccount(api.id)!;
      expect(qaEnv.ANTHROPIC_API_KEY).toBe(KEY);
      expect(qaEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(envForAccount(undefined)).toBeUndefined();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('roles: project override > global > owner login; deleting an account frees its roles', () => {
    const dev = saveAccount({ id: '', name: 'Dev', kind: 'subscription', secret: TOKEN });
    const qa = saveAccount({ id: '', name: 'QA', kind: 'apiKey', secret: KEY });
    setRoles({ dev: dev.id, qa: qa.id, router: 'not-an-account' });
    expect(listAccounts().roles).toEqual({ dev: dev.id, qa: qa.id });
    const project = { id: 'p', name: 'P', repos: [], accountRoles: { dev: qa.id } };
    expect(accountFor('dev', project)).toBe(qa.id);
    expect(accountFor('qa', project)).toBe(qa.id);
    expect(accountFor('router')).toBeUndefined();

    deleteAccount(qa.id);
    expect(fs.existsSync(secretFile(qa.id))).toBe(false);
    expect(listAccounts().roles).toEqual({ dev: dev.id });
    expect(accountFor('dev', project)).toBe(dev.id); // the project's pick is gone: global applies
  });

  it('refuses ids that could escape the secrets folder', () => {
    expect(() => deleteAccount('../../.ssh/id_rsa')).toThrow(/Invalid account id/);
  });
});
