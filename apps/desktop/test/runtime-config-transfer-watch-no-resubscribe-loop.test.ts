import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Regression guard for the runtime "模型" page health/discovery badge flicker
// (发现中 ↔ 检查中 cycling at high speed).
//
// Root cause was a self-sustaining feedback loop:
//   1. `commandInput` in the panel controller depended on volatile runtime-config
//      state, so `commands` / `refreshLocalSnapshot` / `onDownloadComplete` were
//      recreated on every state update.
//   2. The transfer-watch effect depended on `onDownloadComplete`, so it tore
//      down and re-subscribed the WatchLocalTransfers stream on every render.
//   3. WatchLocalTransfers replays every existing session on each subscribe, and
//      terminal (done) sessions arrive with done=true again, re-firing
//      onDownloadComplete -> refreshLocalSnapshot (discover + health) -> state
//      change -> new identities -> re-subscribe -> ... forever.
//
// These source-contract assertions are the mechanical enforcement so the two
// fixes (stable command identities + de-duplicated terminal replays) cannot be
// silently reverted.

const downloadsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-downloads.ts',
);
const controllerPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-panel-controller.ts',
);

const downloadsSource = readFileSync(downloadsPath, 'utf-8');
const controllerSource = readFileSync(controllerPath, 'utf-8');

test('transfer-watch effect does not re-subscribe on completion-handler identity churn', () => {
  // Completion handlers are read through refs so the effect need not list them
  // as dependencies.
  assert.match(downloadsSource, /onDownloadCompleteRef\.current\?\.\(/);
  assert.match(downloadsSource, /onProgressSettledRef\.current\?\.\(/);
  // The watch effect depends only on the profile-target mode flag.
  assert.match(downloadsSource, /\}, \[input\.isProfileTargetMode\]\);/);
  // It must NOT depend on the churn-prone handler identities (the old, looping
  // dependency array).
  assert.doesNotMatch(downloadsSource, /input\.onDownloadComplete,\s*input\.onProgressSettled\]/);
});

test('replayed terminal transfer events are de-duplicated before firing completion', () => {
  assert.match(downloadsSource, /seenTerminalSessionIdsRef/);
  assert.match(downloadsSource, /initialProgressBySessionIdRef/);
  assert.match(downloadsSource, /session\.event\.done/);
  assert.match(downloadsSource, /const effectStartedMs = bindings\.clock\.now\(\);/);
  assert.match(downloadsSource, /updatedAtMs > 0 && updatedAtMs < effectStartedMs/);
  // The done-branch is guarded by the seen-set so snapshot replays of already
  // completed sessions do not re-fire the completion handler.
  assert.match(
    downloadsSource,
    /if \(event\.done && !seenTerminalSessionIdsRef\.current\.has\(event\.installSessionId\)\)/,
  );
});

test('panel controller command context stays referentially stable across state updates', () => {
  // State/guard values are read via live refs, not captured in the memo deps.
  for (const ref of [
    'stateRef',
    'discoveringRef',
    'checkingHealthRef',
    'testingConnectorRef',
    'selectedConnectorRef',
  ]) {
    assert.match(controllerSource, new RegExp(`${ref}\\.current`));
  }
  assert.match(controllerSource, /get state\(\) \{ return stateRef\.current; \}/);

  // The commandInput dependency array must not include the volatile values that
  // change on every runtime-config state update; otherwise `commands` churns and
  // the transfer-watch effect starts re-subscribing again.
  const memoStart = controllerSource.indexOf('const commandInput = useMemo(');
  assert.notEqual(memoStart, -1, 'commandInput useMemo not found');
  const depsStart = controllerSource.indexOf('}), [', memoStart);
  assert.notEqual(depsStart, -1, 'commandInput dependency array not found');
  const depsEnd = controllerSource.indexOf(']);', depsStart);
  assert.notEqual(depsEnd, -1, 'commandInput dependency array end not found');
  const depsBlock = controllerSource.slice(depsStart, depsEnd);
  for (const volatile of [
    'panelState.state',
    'panelState.discovering',
    'panelState.checkingHealth',
    'panelState.testingConnector',
    'derived.selectedConnector',
  ]) {
    assert.ok(
      !depsBlock.includes(volatile),
      `commandInput deps must not include volatile value ${volatile}`,
    );
  }
});
