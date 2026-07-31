import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build, transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const source = readFileSync(path.join(root, 'src/shell/agent/agent-inventory-projection.ts'), 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

async function loadInventoryModule() {
  const output = (await build({
    entryPoints: [path.join(root, 'src/shell/agent/agent-inventory.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    plugins: [{
      name: 'zhiyu-account-agent-inventory-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/renderer\/bridge$/ }, () => ({
          path: 'kit-bridge-stub',
          namespace: 'zhiyu-agent-inventory-stub',
        }));
        buildApi.onResolve({ filter: /auth\/runtime-platform$/ }, () => ({
          path: 'runtime-platform-stub',
          namespace: 'zhiyu-agent-inventory-stub',
        }));
        buildApi.onLoad({ filter: /kit-bridge-stub/, namespace: 'zhiyu-agent-inventory-stub' }, () => ({
          loader: 'js',
          contents: 'export function hasElectronRuntime() { return true; }',
        }));
        buildApi.onLoad({ filter: /runtime-platform-stub/, namespace: 'zhiyu-agent-inventory-stub' }, () => ({
          loader: 'js',
          contents: `
            export function getZhiyuLocalAppClient() {
              return {
                permissions: {
                  async status() { return globalThis.__zhiyuAccountAgentPermissionStatus; },
                  async request() { return globalThis.__zhiyuAccountAgentPermissionStatus; },
                },
              };
            }
          `,
        }));
      },
    }],
  })).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${Math.random()}`);
}

const pending = Object.freeze({
  transport: 'electron-ipc',
  ready: false,
  reasonCode: 'zhiyu-agents-interact-permission-pending',
  actionHint: 'wait_for_agents_interact_permission_decision',
  source: 'runtime',
  message: 'Waiting for permission.',
  ownerUserId: null,
  count: 0,
  localAgents: Object.freeze([]),
});

const granted = Object.freeze({
  ...pending,
  ready: true,
  reasonCode: 'runtime-local-agent-grant-projection-ready',
  actionHint: 'open_runtime_agent_home',
  message: 'Granted Agent projection loaded.',
  count: 1,
  localAgents: Object.freeze([Object.freeze({
    agentHandle: 'opaque-handle',
    displayName: '伙伴甲',
    avatarUrl: null,
    sourceReady: true,
  })]),
});

test('declares the same account-wide current-and-future Agent scope in the manifest and request copy', async () => {
  const { ZHIYU_AGENTS_INTERACT_REASON } = await loadInventoryModule();
  const manifest = readFileSync(path.join(root, 'nimi.app.yaml'), 'utf8');
  const manifestReason = manifest.match(/^\s+reason:\s*(.+)$/mu)?.[1]?.trim();
  assert.equal(manifestReason, ZHIYU_AGENTS_INTERACT_REASON);
  assert.equal(manifestReason, '与您账户中当前及未来的全部 Agent 开始和继续对话。');
});

test('detects account permission posture and covered-Agent projection changes', async () => {
  const { sameZhiyuRuntimeAgentInventory } = await loadModule();
  assert.equal(sameZhiyuRuntimeAgentInventory(pending, { ...pending }), true);
  assert.equal(sameZhiyuRuntimeAgentInventory(pending, granted), false);
  assert.equal(sameZhiyuRuntimeAgentInventory(granted, {
    ...granted,
    localAgents: [{ ...granted.localAgents[0], displayName: '伙伴乙' }],
  }), false);
  assert.equal(sameZhiyuRuntimeAgentInventory(granted, {
    ...granted,
    localAgents: [{ ...granted.localAgents[0], avatarUrl: 'https://assets.example.test/agent.png' }],
  }), false);
});

test('projects every current covered Agent and keeps opaque handles explicit', async () => {
  globalThis.window = {};
  globalThis.__zhiyuAccountAgentPermissionStatus = {
    permissionId: 'agents.interact',
    posture: 'granted',
    canRequest: false,
    agents: [
      {
        agentHandle: 'opaque-agent-a',
        displayName: '伙伴甲',
        avatarUrl: 'https://assets.example.test/agent-a.png',
      },
      { agentHandle: 'opaque-agent-b', displayName: '伙伴乙', avatarUrl: null },
    ],
  };
  const { probeZhiyuRuntimeAgentInventory } = await loadInventoryModule();
  const result = await probeZhiyuRuntimeAgentInventory();
  assert.equal(result.ready, true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.localAgents.map((agent) => agent.agentHandle), [
    'opaque-agent-a',
    'opaque-agent-b',
  ]);
  assert.deepEqual(result.localAgents.map((agent) => agent.avatarUrl), [
    'https://assets.example.test/agent-a.png',
    null,
  ]);
  assert.equal('localAgentRef' in result.localAgents[0], false);
  assert.equal('ownerUserId' in result.localAgents[0], false);
});

test('treats granted account scope with zero current Agents as valid', async () => {
  globalThis.window = {};
  globalThis.__zhiyuAccountAgentPermissionStatus = {
    permissionId: 'agents.interact',
    posture: 'granted',
    canRequest: false,
    agents: [],
  };
  const { probeZhiyuRuntimeAgentInventory } = await loadInventoryModule();
  const result = await probeZhiyuRuntimeAgentInventory();
  assert.equal(result.ready, true);
  assert.equal(result.count, 0);
  assert.equal(result.actionHint, 'wait_for_account_agent_inventory');
  assert.match(result.message, /后续新增 Agent 将自动纳入/);
});
