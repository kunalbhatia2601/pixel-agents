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
const { loadLayout, writeLayoutToFile } = await import('../src/layoutPersistence.js');

describe('layout updates', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-layout-test-'));
  });
  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  const backups = () =>
    fs
      .readdirSync(path.join(tempHome, '.pixel-agents'))
      .filter((f) => f.startsWith('layout.backup-'));

  it('backs up the saved layout before a newer bundled one replaces it', () => {
    const mine = { version: 1, cols: 3, rows: 3, layoutRevision: 4, mine: true };
    writeLayoutToFile(mine);
    const result = loadLayout({ version: 1, cols: 5, rows: 5, layoutRevision: 5 });
    expect(result?.wasReset).toBe(true);
    expect(result?.layout.layoutRevision).toBe(5);
    const [backup] = backups();
    expect(backup).toBeDefined();
    const saved = JSON.parse(
      fs.readFileSync(path.join(tempHome, '.pixel-agents', backup), 'utf-8'),
    );
    expect(saved.mine).toBe(true);
  });

  it('keeps an up-to-date layout and makes no backup', () => {
    writeLayoutToFile({ version: 1, cols: 3, rows: 3, layoutRevision: 5, mine: true });
    const result = loadLayout({ version: 1, cols: 5, rows: 5, layoutRevision: 5 });
    expect(result?.wasReset).toBe(false);
    expect((result?.layout as { mine?: boolean }).mine).toBe(true);
    expect(backups()).toEqual([]);
  });
});
