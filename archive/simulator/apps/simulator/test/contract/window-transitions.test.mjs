import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  windowFromRailIconKeyframes,
  windowToRailIconKeyframes,
} from '../../src/shell/chrome/window-transitions.ts';

const RECT = { x: 100, y: 100, w: 400, h: 300 };
const ICON = { x: 30, y: 300 };
// rect center (300, 250) → icon delta (-270, 50)

test('to-icon frames collapse the window toward the icon with vertical squash', () => {
  const frames = windowToRailIconKeyframes(RECT, ICON);
  assert.equal(frames.length, 3);

  assert.equal(frames[0].offset, 0);
  assert.equal(frames[0].transform, 'translate(0px, 0px) scale(1, 1)');
  assert.equal(frames[0].opacity, '1');

  assert.equal(frames[1].offset, 0.55);
  assert.equal(frames[1].transform, 'translate(-135px, 25px) scale(0.55, 0.42)');
  assert.equal(frames[1].opacity, '0.85');

  const last = frames[2];
  assert.equal(last.offset, 1);
  assert.equal(last.opacity, '0');
  assert.equal(last.transform, 'translate(-270px, 50px) scale(0.09, 0.04)');
});

test('to-icon end scale always squashes vertically harder than horizontally', () => {
  for (const rect of [
    { x: 0, y: 0, w: 200, h: 150 },
    { x: 0, y: 0, w: 800, h: 600 },
    { x: 0, y: 0, w: 1200, h: 900 },
  ]) {
    const last = windowToRailIconKeyframes(rect, ICON).at(-1);
    const match = /scale\(([\d.]+), ([\d.]+)\)$/u.exec(String(last?.transform));
    assert.ok(match, `scale pair present in ${String(last?.transform)}`);
    const sx = Number(match[1]);
    const sy = Number(match[2]);
    assert.ok(sy < sx, `sy ${sy} < sx ${sx}`);
    assert.ok(sx <= 0.18 && sy <= 0.1, 'end scale stays collapsed');
  }
});

test('from-icon frames mirror the collapse and settle at identity', () => {
  const frames = windowFromRailIconKeyframes(RECT, ICON);
  assert.equal(frames.length, 3);

  const collapsed = windowToRailIconKeyframes(RECT, ICON).at(-1);
  assert.equal(frames[0].offset, 0);
  assert.equal(frames[0].transform, collapsed?.transform);
  assert.equal(frames[0].opacity, '0');

  assert.equal(frames[1].offset, 0.7);
  assert.equal(frames[1].opacity, '1');
  assert.match(String(frames[1].transform), /scale\(1\.02, 1\.015\)$/u);

  assert.equal(frames[2].offset, 1);
  assert.equal(frames[2].transform, 'translate(0px, 0px) scale(1, 1)');
  assert.equal(frames[2].opacity, '1');
});

test('icon target inside the window rect still produces finite frames', () => {
  const frames = windowToRailIconKeyframes(RECT, { x: 300, y: 250 });
  assert.equal(frames.at(-1)?.transform, 'translate(0px, 0px) scale(0.09, 0.04)');
});
