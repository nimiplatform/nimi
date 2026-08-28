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
        buildApi.onResolve({ filter: /auth\/runtime-platform$/ }, () => ({
          path: 'runtime-platform-stub', namespace: 'stub',
        }));
        buildApi.onLoad({ filter: /runtime-platform-stub/, namespace: 'stub' }, () => ({
          loader: 'js',
          contents: `
            export function getZhiyuLocalAppClient() {
              return { agents: { listReferences: () => globalThis.__zhiyuListAgentReferences() } };
            }
          `,
        }));
      },
    }],
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}

const unavailable = Object.freeze({
  transport: 'electron-ipc',
  ready: false,
  reasonCode: 'runtime-agent-reference-list-denied',
  actionHint: 'refresh_app_access',
  source: 'runtime',
  message: 'Agent reference list denied.',
  ownerUserId: null,
  count: 0,
  localAgents: Object.freeze([]),
});

test('Zhiyu manifest declares Conversation and Agent Center without broad AI consume coverage', () => {
  const manifest = readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8');
  assert.match(manifest, /^app_access:/mu);
  assert.doesNotMatch(manifest, /^\s+- runtime\.consume$/mu);
  assert.match(manifest, /^\s+- agent\.local$/mu);
  assert.match(manifest, /^\s+- agent\.configure$/mu);
  assert.doesNotMatch(manifest, /^permissions:/mu);
  assert.doesNotMatch(manifest, /^\s+reason:/mu);
});

test('inventory projects only the exact session-scoped Agent reference fields', async () => {
  globalThis.window = {};
  globalThis.__zhiyuListAgentReferences = async () => [{
    agentHandle: 'agent_ref_opaque',
    displayName: 'Aster',
    avatarUrl: 'https://assets.example.test/aster.png',
  }];
  const { probeZhiyuRuntimeAgentInventory } = await loadInventoryModule();
  const result = await probeZhiyuRuntimeAgentInventory();

  assert.equal(result.ready, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.localAgents, [{
    agentHandle: 'agent_ref_opaque',
    displayName: 'Aster',
    avatarUrl: 'https://assets.example.test/aster.png',
  }]);
  assert.deepEqual(Object.keys(result.localAgents[0]).sort(), ['agentHandle', 'avatarUrl', 'displayName']);
});

test('inventory preserves typed Agent reference denial without pseudo data', async () => {
  globalThis.window = {};
  globalThis.__zhiyuListAgentReferences = async () => {
    throw Object.assign(new Error('Agent reference list denied.'), {
      reasonCode: 'runtime-agent-reference-list-denied',
      actionHint: 'refresh_app_access',
      source: 'runtime',
    });
  };
  const { probeZhiyuRuntimeAgentInventory } = await loadInventoryModule();
  assert.deepEqual(await probeZhiyuRuntimeAgentInventory(), unavailable);
});

test('missing Electron transport fails before Agent reference listing', async () => {
  globalThis.window = {};
  globalThis.__zhiyuListAgentReferences = async () => {
    throw new Error('must not list');
  };
  const { probeZhiyuRuntimeAgentInventory } = await loadInventoryModule(false);
  const result = await probeZhiyuRuntimeAgentInventory();
  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'electron-runtime-bridge-unavailable');
  assert.equal(result.count, 0);
});

test('inventory comparison observes reference and availability changes', async () => {
  const { sameZhiyuRuntimeAgentInventory } = await loadProjectionModule();
  assert.equal(sameZhiyuRuntimeAgentInventory(unavailable, { ...unavailable }), true);
  assert.equal(sameZhiyuRuntimeAgentInventory(unavailable, {
    ...unavailable,
    reasonCode: 'electron-runtime-bridge-unavailable',
    source: 'renderer',
  }), false);
});
