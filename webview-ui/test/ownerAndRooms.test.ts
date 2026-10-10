import assert from 'node:assert/strict';

import { test } from 'vitest';

import { OWNER_ID } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';
import { MATRIX_EFFECT_DURATION, TileType } from '../src/office/types.js';

/** 10x4 floor: cols 0-3 a closed Tasks room, 4-5 a hallway, 6-9 the Owner room. No walls between. */
function layout(): OfficeLayout {
  const cols = 10;
  const rows = 4;
  return {
    version: 1,
    cols,
    rows,
    tiles: new Array<TileType>(cols * rows).fill(TileType.FLOOR_1),
    furniture: [],
    areaTiles: Array.from({ length: cols * rows }, (_, i) => {
      const c = i % cols;
      return c <= 3 ? 'Live Tasks' : c >= 6 ? 'Owner' : null;
    }),
  };
}

const inOwnerRoom = (col: number) => col >= 6;

test('closed rooms are off the map: no walkable tile, no path in', () => {
  const os = new OfficeState(layout());
  assert.ok(os.walkableTiles.length > 0);
  assert.ok(
    os.walkableTiles.every((t) => t.col >= 4),
    'no walkable tile in the closed room',
  );
});

test('"You" appears in the Owner room, keeps to it while roaming, and is not clickable', () => {
  const os = new OfficeState(layout());
  os.showOwner();
  const ch = os.owner!;
  assert.equal(ch.id, OWNER_ID);
  assert.ok(inOwnerRoom(ch.tileCol));
  for (let t = 0; t < 120; t += 0.1) {
    os.update(0.1);
    assert.ok(inOwnerRoom(os.owner!.tileCol), `left the Owner room at t=${t.toFixed(1)}`);
  }
  assert.ok(
    os.getCharacters().some((c) => c.id === OWNER_ID),
    'drawn',
  );
  assert.equal(os.getCharacterAt(ch.x, ch.y), null, 'clicks pass through');
});

test('steering walks it anywhere open, never into a closed room; Roam sends it back', () => {
  const os = new OfficeState(layout());
  os.showOwner();
  os.update(MATRIX_EFFECT_DURATION + 0.1);
  const ch = os.owner!;
  // Walk left until the hallway's edge (col 4); the closed room (col 3) must refuse it.
  for (let i = 0; i < 20; i++) {
    os.moveOwner(-1, 0);
    for (let t = 0; t < 1; t += 0.05) os.update(0.05);
  }
  assert.equal(ch.tileCol, 4, 'stopped at the closed room');
  assert.equal(os.ownerManual, true);
  for (let t = 0; t < 60; t += 0.1) os.update(0.1);
  assert.equal(ch.tileCol, 4, 'stays where it was left while steered');

  os.roamOwner();
  for (let t = 0; t < 120 && !inOwnerRoom(ch.tileCol); t += 0.1) os.update(0.1);
  assert.ok(inOwnerRoom(ch.tileCol), 'roams back into the Owner room');
});

test('hiding removes it after the despawn effect', () => {
  const os = new OfficeState(layout());
  os.showOwner();
  os.hideOwner();
  os.update(MATRIX_EFFECT_DURATION + 0.1);
  assert.equal(os.owner, null);
});
