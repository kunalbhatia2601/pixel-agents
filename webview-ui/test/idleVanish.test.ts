import assert from 'node:assert/strict';

import { test } from 'vitest';

import { IDLE_VANISH_SEC } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { MATRIX_EFFECT_DURATION, TileType } from '../src/office/types.js';

function floorLayout(cols = 9, rows = 7): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
  };
}

/** Advance in small steps, the way the game loop does. */
function run(os: OfficeState, seconds: number, step = 1): void {
  for (let t = 0; t < seconds; t += step) os.update(step);
}

test('starts idle and standing, never seated', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0, undefined, true, 'P');
  const ch = os.characters.get(1)!;
  assert.equal(ch.isActive, false);
  assert.equal(ch.seatId, null);
});

test('idle for 10 minutes: fades out but stays tracked; activity brings the same character back', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 3, 0, undefined, true, 'P');
  run(os, IDLE_VANISH_SEC - 5);
  assert.ok(
    os.getCharacters().some((c) => c.id === 1),
    'still visible before 10 minutes',
  );

  run(os, 5 + MATRIX_EFFECT_DURATION + 1);
  const ch = os.characters.get(1)!;
  assert.equal(ch.dormant, true, 'dormant, not deleted');
  assert.equal(os.getCharacters().length, 0, 'not drawn');
  assert.equal(os.getCharacterAt(ch.x, ch.y), null, 'not clickable');

  os.setAgentActive(1, true); // the agent works again (follow-up, QA feedback, resume)
  assert.equal(os.characters.get(1), ch, 'same character: same id, palette, label');
  assert.equal(ch.dormant, false);
  assert.equal(ch.palette, 3);
  assert.equal(ch.folderName, 'P');
  assert.equal(ch.matrixEffect, 'spawn', 'reappears with the spawn effect');
});

test('an approval request wakes it, and waiting on approval never counts as idle', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0, undefined, true);
  run(os, IDLE_VANISH_SEC + MATRIX_EFFECT_DURATION + 1);
  assert.equal(os.characters.get(1)!.dormant, true);
  os.showPermissionBubble(1);
  assert.equal(os.characters.get(1)!.dormant, false);
  run(os, IDLE_VANISH_SEC * 2);
  assert.equal(os.characters.get(1)!.dormant, false, 'stays while the owner is needed');
});

test('closing a dormant agent removes it for good', () => {
  const os = new OfficeState(floorLayout());
  os.addAgent(1, 0, 0, undefined, true);
  run(os, IDLE_VANISH_SEC + MATRIX_EFFECT_DURATION + 1);
  os.removeAgent(1);
  assert.equal(os.characters.has(1), false);
});
