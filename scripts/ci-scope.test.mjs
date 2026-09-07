import assert from 'node:assert/strict';
import test from 'node:test';
import { CI_LANES, selectCiScope, assertCiResults } from './lib/ci-scope.mjs';

test('Runtime-only changes retain Linux checks without building unrelated Apps', () => {
  const scope = selectCiScope(['runtime/go.mod', 'runtime/go.sum']);
  assert.equal(scope.runtime_changed, true);
  assert.equal(scope.workspace_changed, false);
  assert.equal(scope.desktop_changed, false);
  assert.equal(scope.kit_native_changed, false);
  assert.equal(scope.authority_changed, false);
});

test('App source selects its own workspace while documentation does not select code', () => {
  const app = selectCiScope(['apps/desktop/src-electron/main.ts']);
  assert.deepEqual(app.workspace_filters, ['./apps/desktop']);
  assert.equal(app.desktop_native_changed, false);
  const docs = selectCiScope(['docs/avatar/index.md', 'apps/desktop/AGENTS.md']);
  assert.equal(docs.docs_changed, true);
  assert.equal(docs.workspace_changed, false);
  assert.equal(docs.desktop_changed, false);
});

test('Kit and SDK contracts select pnpm consumers and the source-copy App Tools consumer', () => {
  const kit = selectCiScope(['kit/features/chat/src/types.ts']);
  assert.deepEqual(kit.workspace_filters, ['...@nimiplatform/kit', '@nimiplatform/app-tools']);
  assert.equal(kit.kit_changed, true);
  assert.equal(kit.runtime_changed, false);
  const sdk = selectCiScope(['sdks/typescript/core/runtime/client.ts']);
  assert.ok(sdk.workspace_filters.includes('...@nimiplatform/sdk'));
  assert.equal(sdk.sdk_changed, true);
  assert.equal(sdk.kit_changed, true);
  assert.ok(selectCiScope(['apps/lab/src/lab/view.tsx']).workspace_filters.includes('@nimiplatform/app-tools'));
});

test('native and proto changes retain their supported platform checks', () => {
  const native = selectCiScope(['kit/shell/protected-local/src/lib.rs']);
  assert.equal(native.kit_native_changed, true);
  assert.equal(native.lab_native_changed, true);
  assert.equal(native.desktop_native_changed, true);
  const proto = selectCiScope(['proto/runtime/v1/model.proto']);
  for (const flag of ['proto_changed', 'sdk_changed', 'runtime_changed', 'kit_native_changed']) {
    assert.equal(proto[flag], true, flag);
  }
});

test('authority and shared command changes retain complete checks, workflow-only changes retain lint', () => {
  assert.equal(selectCiScope(['.nimi/spec/platform/core.authority.md']).authority_changed, true);
  assert.equal(selectCiScope(['scripts/lib/ci-scope.mjs']).scripts_changed, true);
  assert.equal(selectCiScope(['.github/workflows/security.yml']).core_changed, true);
  const full = selectCiScope([], { full: true });
  for (const flag of Object.values(CI_LANES)) assert.equal(full[flag], true, flag);
});

function successfulResults(files) {
  const scope = selectCiScope(files);
  return {
    changes: { result: 'success', outputs: Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, JSON.stringify(value)])) },
    ...Object.fromEntries(Object.entries(CI_LANES).map(([lane, flag]) => [lane, { result: scope[flag] ? 'success' : 'skipped' }])),
  };
}

test('only expected unselected lanes may be skipped; selector and required-lane failures remain failures', () => {
  const needs = successfulResults(['runtime/go.mod']);
  assert.doesNotThrow(() => assertCiResults(needs));
  for (const result of ['skipped', 'failure', 'cancelled', undefined]) {
    assert.throws(() => assertCiResults({ ...needs, 'runtime-quality': { result } }), /runtime-quality/u);
  }
  assert.throws(() => assertCiResults({ ...needs, changes: { result: 'failure' } }), /selection/u);
  assert.throws(() => assertCiResults({ ...needs, changes: { result: 'success', outputs: {} } }), /selection/u);
});
