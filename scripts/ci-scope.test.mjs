import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { npmDependencyFloor, npmPublicationTag, requireComponentVersion } from './release/component-version.mjs';
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
  for (const file of [
    'runtime/proto/runtime-v1.baseline.json',
    'scripts/proto-breaking.test.mjs',
    'scripts/proto-baseline-refresh.mjs',
    'scripts/lib/proto-wire-baseline.mjs',
  ]) assert.equal(selectCiScope([file]).proto_changed, true, file);
});

test('native jobs follow their owners; portable Electron host checks follow the selected workspace', () => {
  const macJobs = paths => {
    const scope = selectCiScope(paths);
    return CI_LANES['macos-platform-tests'].some(flag => scope[flag]);
  };
  for (const file of [
    'runtime/internal/protectedlocal/local_app_revalidation_darwin.go',
    'runtime/internal/services/localservice/model_object_store.go',
    'kit/shell/protected-local-node/src/local_app.rs',
    'kit/shell/electron/src/main/app-host-profile.ts',
    'apps/desktop/src-electron/support-logs-host.ts',
    'scripts/doctor-dev.mjs',
  ]) assert.equal(macJobs([file]), true, file);
  for (const file of ['apps/web/src/view.tsx', 'apps/nimiday/src/nimiday/ui/shell.tsx', 'apps/desktop/AGENTS.md']) {
    assert.equal(macJobs([file]), false, file);
  }
  for (const app of ['utopia', 'nimigo', 'nimiday', 'lab']) {
    const files = [`apps/${app}/src-electron/main.ts`];
    assert.ok(selectCiScope(files).workspace_filters.includes(`./apps/${app}`));
    assert.equal(macJobs(files), false);
  }
  const needs = successfulResults(['kit/shell/electron/src/main/app-host-profile.ts']);
  assert.throws(() => assertCiResults({ ...needs, 'macos-platform-tests': { result: 'skipped' } }), /macos-platform-tests/u);
});

test('the shipping updater and compiler inputs select the credential-free Apple Silicon build', () => {
  for (const file of [
    'apps/desktop/macos/product-updater/main.swift', 'apps/desktop/scripts/build-macos-product-updater.mjs',
    'apps/desktop/scripts/lib/macos-release-process.mjs', 'apps/desktop/scripts/lib/release-source-maps.mjs',
    'config/product-update-policy.mjs',
  ]) assert.equal(selectCiScope([file]).macos_updater_changed, true, file);
  const swift = ['apps/desktop/macos/product-updater/main.swift'];
  const scope = selectCiScope(swift);
  assert.equal(CI_LANES['macos-platform-tests'].some(flag => scope[flag]), false);
  assert.equal(selectCiScope(['apps/web/src/site.css']).macos_updater_changed, false);
  assert.throws(() => assertCiResults({ ...successfulResults(swift), 'macos-updater-build': { result: 'skipped' } }), /macos-updater-build/u);
  const workflow = parse(readFileSync(new URL('../.github/workflows/build-macos-production.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on).sort(), ['workflow_call', 'workflow_dispatch']);
});

test('Web generator inputs, shared TypeScript config and lockfile reach their consumers', () => {
  const componentDocs = selectCiScope(['kit/CHANGELOG.md', 'sdks/typescript/CHANGELOG.md']);
  assert.equal(componentDocs.docs_changed, true);
  assert.equal(componentDocs.web_changed, false);
  const catalog = selectCiScope(['runtime/catalog/providers/xai.yaml']);
  assert.equal(catalog.web_changed, true);
  assert.ok(catalog.workspace_filters.includes('./apps/web'));
  assert.equal(catalog.runtime_changed, true);
  assert.equal(catalog.native_runtime_changed || catalog.windows_runtime_changed, false);
  assert.equal(selectCiScope(['tsconfig.json']).sdk_changed, true);
  const lock = selectCiScope(['pnpm-lock.yaml']);
  for (const flags of Object.values(CI_LANES)) assert.ok([flags].flat().some(flag => lock[flag]));
  assert.equal(lock.kit_windows_package_changed && lock.kit_macos_package_changed, true);
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

test('SDK and adapter changes compile the SDK examples; example edits run the docs gate', async () => {
  const { readFile } = await import('node:fs/promises');
  const examples = JSON.parse(await readFile(new URL('../examples/package.json', import.meta.url), 'utf8'));
  // The workspace lane runs each selected package's `test`; SDK consumers
  // include the examples package, whose test is its compile gate.
  assert.equal(examples.dependencies['@nimiplatform/sdk'], 'workspace:*');
  assert.match(examples.scripts.test, /\bpnpm run check\b/u);
  assert.match(examples.scripts.check, /\btsc -p tsconfig\.json --noEmit\b/u);
  for (const file of ['sdks/typescript/core/app/local-app-runtime-platform.ts', 'sdks/typescript/adapters/vercel-ai/index.ts']) {
    const scope = selectCiScope([file]);
    assert.equal(scope.workspace_changed, true, file);
    assert.ok(scope.workspace_filters.includes('...@nimiplatform/sdk'), file);
  }
  const edited = selectCiScope(['examples/sdk/01-first-call.ts']);
  assert.equal(edited.docs_changed, true);
});

test('remote client checks follow shared contracts and mapped guides without every prose edit', () => {
  assert.equal(selectCiScope(['docs/avatar/index.md'], { docsReviewTargets: ['docs/avatar/index.md'] }).remote_clients_changed, false);
  for (const file of ['sdks/typescript/runtime/remote.ts', 'kit/auth/src/app/mobile.ts', 'examples/remote-runtime-web/src/client.ts']) {
    const scope = selectCiScope([file]);
    assert.equal(scope.docs_changed, true);
    assert.equal(scope.remote_clients_changed, true);
  }
  const scope = selectCiScope(['.nimi/spec/runtime/remote-access.authority.yaml'], { docsReviewTargets: ['docs/sdk/runtime-client.md'] });
  assert.equal(scope.remote_clients_changed, true);
});

test('docs checks run when their own scripts change', () => {
  const preparation = selectCiScope(['scripts/prepare-docs-mobile-reference.mjs']);
  assert.equal(preparation.docs_changed, true);
  assert.equal(preparation.remote_clients_changed, true);

  for (const file of ['scripts/check-docs-source.mjs', 'scripts/docs-source.test.mjs', 'scripts/ci-scope.test.mjs', 'scripts/lib/docs-source.mjs']) {
    const scope = selectCiScope([file]);
    assert.equal(scope.docs_changed, true);
    assert.equal(scope.remote_clients_changed, false);
  }
});

test('private SDK unit tests run the SDK suite and public testing changes retain consumers', () => {
  const testPath = 'sdks/typescript/core/app/local-app-conversation-quote.test.ts';
  assert.deepEqual(selectCiScope([testPath]).workspace_filters, ['@nimiplatform/sdk']);
  assert.equal(selectCiScope([testPath]).sdk_changed, false);
  assert.equal(selectCiScope([testPath]).remote_clients_changed, false);
  assert.deepEqual(selectCiScope(['scripts/ci-scope.test.mjs']).workspace_filters, []);
  const needs = successfulResults([testPath]);
  assert.throws(() => assertCiResults({ ...needs, 'workspace-regression': { result: 'failure' } }), /workspace-regression/u);
  assert.equal(selectCiScope([testPath, 'sdks/typescript/testing/index.ts']).sdk_changed, true);
});

test('component validation across the full PR follows both sides of a rename', () => {
  const releases = ['release', 'release-kit', 'release-app-tools', 'release-sdk-adapter-vercel-ai'].map(name =>
    parse(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')));
  function selectedWorkflows(paths) {
    return releases.filter(workflow =>
      paths.some(file => workflow.on.pull_request.paths.reduce((include, glob) => {
        const negative = glob.startsWith('!');
        return path.posix.matchesGlob(file, negative ? glob.slice(1) : glob) ? !negative : include;
      }, false))).map(workflow => workflow.name);
  }
  const unit = 'sdks/typescript/core/app/local-app-conversation-quote.test.ts';
  assert.deepEqual(selectedWorkflows([unit]), []);
  assert.deepEqual(selectedWorkflows(['scripts/ci-scope.test.mjs']), []);
  for (const paths of [
    ['sdks/typescript/core/app/old.ts', unit],
    [unit, 'sdks/typescript/core/app/new.ts'],
    ['sdks/typescript/testing/index.ts'],
  ]) {
    assert.deepEqual(selectedWorkflows(paths), ['release', 'release-kit', 'release-sdk-adapter-vercel-ai']);
    const scope = selectCiScope(paths);
    assert.equal(scope.kit_macos_package_changed || scope.kit_windows_package_changed, false);
  }
  for (const [file, mac, win] of [
    ['kit/shell/protected-local/src/lib.rs', true, true],
    ['kit/shell/protected-local-node/npm/darwin-arm64/package.json', true, false],
    ['kit/shell/protected-local-node/scripts/build-windows-x64-package.mjs', false, true],
    ['kit/features/chat/src/types.ts', false, false],
  ]) {
    assert.ok(selectedWorkflows([file]).includes('release-kit'));
    const scope = selectCiScope([file]);
    assert.equal(scope.kit_macos_package_changed, mac, file);
    assert.equal(scope.kit_windows_package_changed, win, file);
  }
  for (const w of releases) assert.deepEqual(w.on.push.tags.length, 1);
});

test('candidate version admission is limited to stable and canonical rc versions', () => {
  assert.equal(requireComponentVersion('1.2.3', false), '1.2.3');
  assert.equal(requireComponentVersion('1.2.3-rc.7', true), '1.2.3-rc.7');
  for (const version of ['1.2.3-rc.07', '1.2.3-beta.1', 'v1.2.3', '']) assert.throws(() => requireComponentVersion(version, true));
  assert.throws(() => requireComponentVersion('1.2.3-rc.7', false));
});

test('RC component publication selects pre and keeps stable dependency checks', () => {
  assert.equal(npmPublicationTag('1.2.3-rc.4'), 'pre');
  assert.equal(npmPublicationTag('1.2.3'), 'latest');
  assert.equal(npmPublicationTag('0.12.4', 'maintenance-0.12'), 'maintenance-0.12');
  assert.equal(npmDependencyFloor('1.2.3-rc.4', '^1.0.0-rc.2'), '1.0.0-rc.2');
  assert.throws(() => npmDependencyFloor('1.2.3', '^1.0.0-rc.2'));
  assert.throws(() => npmDependencyFloor('1.2.3-rc.4', 'latest'));
});
