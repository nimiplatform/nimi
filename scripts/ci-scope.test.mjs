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

test('additional SDK language sources select typed-core behavior without unrelated native lanes', () => {
  for (const file of [
    'sdks/go/coreclient/client.go',
    'sdks/python/core_client/__init__.py',
    'sdks/rust/core_client/mod.rs',
  ]) {
    const scope = selectCiScope([file]);
    assert.equal(scope.sdk_changed, true, file);
    assert.equal(scope.sdk_conformance_changed, true, file);
    assert.equal(scope.runtime_changed, false, file);
    assert.equal(scope.kit_native_changed, false, file);
    assert.equal(scope.desktop_native_changed, false, file);
  }
  for (const language of ['go', 'python', 'rust']) {
    const docs = selectCiScope([`sdks/${language}/README.md`]);
    assert.equal(docs.sdk_conformance_changed, false);
    assert.equal(docs.docs_changed, true);
  }
});

test('native and proto changes retain their supported platform checks', () => {
  const native = selectCiScope(['kit/shell/protected-local/src/lib.rs']);
  assert.equal(native.kit_native_changed, true);
  assert.equal(native.desktop_native_changed, true);
  const proto = selectCiScope(['proto/runtime/v1/model.proto']);
  for (const flag of ['proto_changed', 'sdk_changed', 'runtime_changed', 'kit_native_changed']) {
    assert.equal(proto[flag], true, flag);
  }
});

test('Mac checks follow native, Runtime and App Host changes without selecting ordinary renderer edits', () => {
  for (const file of [
    'runtime/internal/protectedlocal/local_app_revalidation_darwin.go',
    'runtime/internal/services/localservice/model_object_store.go',
    'kit/shell/protected-local-node/src/local_app.rs',
    'kit/shell/electron/src/main/app-host-profile.ts',
    'apps/nimigo/src-electron/main.ts',
    'apps/nimiday/scripts/bundle-electron-preload.mjs',
    'apps/lab/tsconfig.electron.json',
    'scripts/doctor-dev.mjs',
  ]) assert.equal(selectCiScope([file]).macos_platform_changed, true, file);
  for (const file of ['apps/web/src/view.tsx', 'apps/nimiday/src/nimiday/ui/shell.tsx', 'apps/desktop/AGENTS.md']) {
    assert.equal(selectCiScope([file]).macos_platform_changed, false, file);
  }
  const needs = successfulResults(['apps/nimigo/src-electron/main.ts']);
  assert.throws(() => assertCiResults({ ...needs, 'macos-platform-tests': { result: 'skipped' } }), /macos-platform-tests/u);
});

test('authority and shared command changes retain complete checks, workflow-only changes retain lint', () => {
  assert.equal(selectCiScope(['.nimi/spec/platform/core.authority.md']).authority_changed, true);
  assert.equal(selectCiScope(['scripts/lib/ci-scope.mjs']).scripts_changed, true);
  assert.equal(selectCiScope(['.github/workflows/security.yml']).core_changed, true);
  const full = selectCiScope([], { full: true });
  for (const flag of Object.values(CI_LANES).flat()) assert.equal(full[flag], true, flag);
});

function successfulResults(files) {
  const scope = selectCiScope(files);
  return {
    changes: { result: 'success', outputs: Object.fromEntries(Object.entries(scope).map(([key, value]) => [key, JSON.stringify(value)])) },
    ...Object.fromEntries(Object.entries(CI_LANES).map(([lane, flags]) => [lane, { result: [flags].flat().some((flag) => scope[flag]) ? 'success' : 'skipped' }])),
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

test('known check-only and methodology changes do not rebuild product workspaces', () => {
  for (const file of ['scripts/check-eol-noise.mjs', 'scripts/check-text-encoding-gate.mjs', 'scripts/lib/text-encoding-gate.mjs', '.nimi/methodology/authority-authoring.yaml', '.nimi/config/authority-verifiers.yaml']) {
    const scope = selectCiScope([file]);
    assert.equal(scope.core_changed, true, file);
    assert.equal(scope.workspace_changed, false, file);
    assert.deepEqual(scope.workspace_filters, [], file);
  }
  assert(selectCiScope(['scripts/lib/unknown-build-helper.mjs']).workspace_filters.includes('*'));
  assert(selectCiScope(['.nimi/spec/nimiday/assistant.authority.yaml']).workspace_filters.includes('*'));
});

test('Windows Runtime and App Tools changes select the native Windows lane', () => {
  for (const file of [
    'runtime/internal/protectedlocal/windows_pipe.go',
    'runtime/tools/repair-local-agent-chat/repair.go',
    'scripts/install-windows-runtime-service.ps1',
    'scripts/accept-runtime-fixed-service.mjs',
    'scripts/lib/windows-powershell.mjs',
  ]) {
    const scope = selectCiScope([file]);
    assert.equal(scope.windows_runtime_changed, true, file);
    assert.equal(scope.windows_app_tools_changed, false, file);
  }
  const appTools = selectCiScope(['app-tools/lib/app-scaffold.mjs']);
  assert.equal(appTools.windows_app_tools_changed, true);
  assert.equal(appTools.windows_runtime_changed, false);
  for (const file of ['apps/web/src/view.tsx', 'kit/features/chat/src/types.ts', 'docs/index.md']) {
    const scope = selectCiScope([file]);
    assert.equal(scope.windows_runtime_changed || scope.windows_app_tools_changed, false, file);
  }
  const needs = successfulResults(['scripts/install-windows-runtime-service.ps1']);
  assert.doesNotThrow(() => assertCiResults(needs));
  assert.throws(() => assertCiResults({ ...needs, 'windows-runtime-tests': { result: 'skipped' } }), /windows-runtime-tests/u);
  const unselected = successfulResults(['apps/web/src/view.tsx']);
  assert.throws(() => assertCiResults({ ...unselected, 'windows-runtime-tests': { result: 'success' } }), /windows-runtime-tests/u);
});
