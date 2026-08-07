import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build, transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadProjectionModule() {
  const source = readFileSync(path.join(root, 'src/shell/agent/agent-inventory-projection.ts'), 'utf8');
  const output = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

async function loadInventoryModule(hasElectronRuntime = true) {
  const output = (await build({
    entryPoints: [path.join(root, 'src/shell/agent/agent-inventory.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    plugins: [{
      name: 'zhiyu-agent-inventory-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/renderer\/bridge$/ }, () => ({
          path: 'kit-bridge-stub', namespace: 'stub',
        }));
        buildApi.onLoad({ filter: /kit-bridge-stub/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `export function hasElectronRuntime() { return ${String(hasElectronRuntime)}; }`,
        }));
      },
    }],
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}

const unavailable = Object.freeze({
  transport: 'electron-ipc',
  ready: false,
  reasonCode: 'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
  actionHint: 'wait_for_app_access_admission',
  source: 'sdk',
  message: 'Local Agent inventory is unavailable until protected App Access is admitted.',
  ownerUserId: null,
  count: 0,
  localAgents: Object.freeze([]),
});

test('Zhiyu manifest declares raw App Access without an item-level workflow', () => {
  const manifest = readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8');
  assert.match(manifest, /^app_access:/mu);
  assert.doesNotMatch(manifest, /^permissions:/mu);
  assert.doesNotMatch(manifest, /^\s+reason:/mu);
});

test('inventory remains typed unavailable without calling a protected carrier', async () => {
  globalThis.window = {};
  const { probeZhiyuRuntimeAgentInventory } = await loadInventoryModule();
  assert.deepEqual(await probeZhiyuRuntimeAgentInventory(), unavailable);
});

test('missing Electron transport remains independent from App Access availability', async () => {
  globalThis.window = {};
  const { probeZhiyuRuntimeAgentInventory } = await loadInventoryModule(false);
  const result = await probeZhiyuRuntimeAgentInventory();
  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'electron-runtime-bridge-unavailable');
  assert.equal(result.count, 0);
});

test('inventory comparison observes independent access availability changes', async () => {
  const { sameZhiyuRuntimeAgentInventory } = await loadProjectionModule();
  assert.equal(sameZhiyuRuntimeAgentInventory(unavailable, { ...unavailable }), true);
  assert.equal(sameZhiyuRuntimeAgentInventory(unavailable, {
    ...unavailable,
    reasonCode: 'electron-runtime-bridge-unavailable',
    source: 'renderer',
  }), false);
});
