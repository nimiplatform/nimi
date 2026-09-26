import assert from 'node:assert/strict';
import test from 'node:test';
import { startDownloadPolling } from '../src/shell/renderer/features/runtime-config/download-polling.js';

test('download polling backs off when idle, wakes on focus and never overlaps reads', async () => {
  let wake = () => {};
  let timer: { callback: () => void; delay: number } | undefined;
  let active = false;
  let calls = 0;
  let release: (() => void) | undefined;
  let block = false;
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const polling = startDownloadPolling(async () => {
    calls += 1;
    if (block) await new Promise<void>((resolve) => { release = resolve; });
  }, () => active, {
    schedule(callback, delay) { timer = { callback, delay }; return timer; },
    cancel() { timer = undefined; },
    visible: () => true,
    onWake(callback) { wake = callback; return () => { wake = () => {}; }; },
  });
  await settle();
  assert.equal(calls, 1);
  assert.equal(timer?.delay, 30_000);
  active = true;
  wake();
  await settle();
  assert.equal(calls, 2);
  assert.equal(timer?.delay, 2_000);
  block = true;
  timer?.callback();
  wake();
  wake();
  assert.equal(calls, 3);
  block = false;
  release?.();
  await settle();
  assert.equal(timer?.delay, 0);
  polling.stop();
  wake();
  assert.equal(calls, 3);
  assert.equal(timer, undefined);
});
