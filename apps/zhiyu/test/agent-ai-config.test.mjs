import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu projects shared AIConfig intent without claiming execution readiness', async () => {
  const module = await importAgentAIConfigModule();
  const route = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot());

  assert.equal(route.ready, false);
  assert.equal(route.capability, 'text.generate');
  assert.equal(route.configRevision, null);
  assert.equal(route.readinessRevision, null);
  assert.equal(route.updatedByAppId, null);
  assert.equal(route.reasonCode, 'runtime-shared-ai-config-text-intent-configured');
  assert.equal(route.actionHint, 'submit_runtime_agent_turn_for_derived_admission');
  assert.equal(route.source, 'runtime');
  assert.equal(route.executionBinding, null);
  assert.deepEqual(route.capabilities, {});
});

test('Zhiyu keeps configured intent distinct from readiness and fails closed when text intent is absent', async () => {
  const module = await importAgentAIConfigModule();

  const notConfigured = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    sharedAIConfig: sharedAIConfigProjection({
      aiConfig: canonicalSharedAIConfig([]),
      capabilities: [],
      intents: [],
    }),
  }));
  assert.equal(notConfigured.ready, false);
  assert.equal(notConfigured.reasonCode, 'zhiyu-shared-ai-config-text-intent-not-configured');
  assert.equal(notConfigured.actionHint, 'configure_shared_local_agent_ai_config');
  assert.equal(notConfigured.executionBinding, null);

  const cloudConfigured = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    sharedAIConfig: sharedAIConfigProjection({
      aiConfig: canonicalSharedAIConfig([capabilityIntent('text.generate', 'cloud')]),
      capabilities: ['text.generate'],
      intents: [{ capability: 'text.generate', route: 'cloud', requiredFeatures: [] }],
    }),
  }));
  assert.equal(cloudConfigured.ready, false);
  assert.equal(cloudConfigured.reasonCode, 'runtime-shared-ai-config-text-intent-configured');
  assert.deepEqual(cloudConfigured.capabilities, {});
  assert.equal(cloudConfigured.executionBinding, null);
});

test('Zhiyu shared AIConfig evidence fails closed without a session and preserves Runtime failure text', async () => {
  const module = await importAgentAIConfigModule();

  const sessionUnavailable = module.projectZhiyuAgentAIConfigRouteEvidence(null);
  assert.equal(sessionUnavailable.ready, false);
  assert.equal(sessionUnavailable.reasonCode, 'zhiyu-shared-ai-config-session-unavailable');
  assert.equal(sessionUnavailable.actionHint, 'open_authorized_agent_center_session');

  const permissionRequired = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    sharedAIConfig: null,
    availability: {
      getSharedAIConfig: {
        state: 'unavailable',
        reason: 'needs-grant',
        nextStep: 'requestPermission',
      },
    },
  }));
  assert.equal(permissionRequired.reasonCode, 'zhiyu-shared-ai-config-permission-required');
  assert.equal(permissionRequired.actionHint, 'request_agents_configure_permission');

  const unavailable = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    phase: 'degraded',
    sharedAIConfig: null,
    error: 'Runtime shared AIConfig transport is offline.',
    availability: {
      getSharedAIConfig: {
        state: 'unavailable',
        reason: 'runtime-offline',
        nextStep: 'retry',
      },
    },
  }));
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.reasonCode, 'zhiyu-shared-ai-config-unavailable');
  assert.match(unavailable.message, /transport is offline/u);
  assert.equal(unavailable.executionBinding, null);

  const source = await readFile(path.join(root, 'src/shell/agent-chat/agent-ai-config.ts'), 'utf8');
  assert.doesNotMatch(
    source,
    /subjectUserId|accountId|ownerUserId|runtimeSourceRef|localAgentRef|requireZhiyuLocalAppCapability|@nimiplatform\/sdk\/runtime|state\.aiConfig|routeOptions/u,
  );
});

test('Zhiyu turn readiness gates on account permission, covered Agent handle, and conversation anchor', async () => {
  const module = await importTurnReadinessModule();

  const blockedByPermission = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    {
      ...inventoryReady(),
      ready: false,
      localAgents: [],
      reasonCode: 'zhiyu-agents-interact-permission-denied',
      actionHint: 'request_agents_interact_permission_again',
      message: 'Account permission was denied.',
    },
  );
  assert.equal(blockedByPermission.ready, false);
  assert.equal(blockedByPermission.reasonCode, 'zhiyu-agents-interact-permission-denied');

  const blockedByCoverage = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    {
      ...inventoryReady(),
      localAgents: [{
        agentHandle: 'lah_v1_other_agent',
        displayName: '其他伙伴',
        sourceReady: true,
      }],
    },
  );
  assert.equal(blockedByCoverage.ready, false);
  assert.equal(blockedByCoverage.reasonCode, 'zhiyu-agent-handle-not-covered');

  const blockedByConversation = module.probeZhiyuAgentTurnReadiness(
    conversationReady({ conversationAnchorId: null }),
    inventoryReady(),
  );
  assert.equal(blockedByConversation.ready, false);
  assert.equal(blockedByConversation.reasonCode, 'zhiyu-conversation-anchor-required');

  const ready = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    inventoryReady(),
  );
  assert.equal(ready.ready, true);
  assert.equal(ready.reasonCode, 'runtime-turn-ready');
});

function inventoryReady() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-local-agent-grant-projection-ready',
    actionHint: 'select_runtime_local_agent',
    source: 'runtime',
    message: 'Account permission projection is ready.',
    ownerUserId: null,
    count: 1,
    localAgents: [{
      agentHandle: 'lah_v1_agent_opaque',
      displayName: '伙伴',
      sourceReady: true,
    }],
  };
}

test('Zhiyu labels retire model-readiness copy and never append machine codes', async () => {
  const module = await importLabelsModule();
  assert.equal(module.agentAIConfigReadinessHint, undefined);
  assert.equal(module.chatModelPresentation, undefined);

  const labels = await readFile(
    path.join(root, 'src/shell/agent-chat/ZhiyuAgentChatLabels.ts'),
    'utf8',
  );
  assert.doesNotMatch(
    labels,
    /未绑定模型|模型通路|模型目标|配置需授权|withDevelopmentReasonCode|reasonCode:\s*\$\{/u,
  );
});

test('Zhiyu composer copy surfaces conversation anchor failures instead of indefinite opening copy', async () => {
  const module = await importLabelsModule();
  const hint = module.chatBlockedHint({
    localAgent: {
      ready: true,
    },
    conversation: {
      ready: false,
      reasonCode: 'zhiyu-conversation-anchor-unavailable',
      actionHint: 'check_runtime_agent_open_conversation',
      message: 'Runtime conversation anchor is unavailable.',
    },
    route: {
      ready: true,
    },
    chat: {
      state: 'idle',
    },
  });

  assert.notEqual(hint, '正在打开会话，请稍候。');
  assert.equal(hint, '会话没有打开成功，请重新选择伙伴或重启织羽后再试。');
});

test('Zhiyu composer copy distinguishes empty local partner inventory from unselected partners', async () => {
  const module = await importLabelsModule();
  const baseEvidence = {
    localAgent: {
      ready: false,
    },
    conversation: {
      ready: false,
      reasonCode: 'zhiyu-local-agent-required',
    },
    route: {
      ready: false,
    },
    chat: {
      state: 'idle',
    },
  };

  assert.equal(
    module.chatBlockedHint({
      ...baseEvidence,
      inventory: {
        localAgents: [],
      },
    }),
    '添加本地伙伴后开始聊天。',
  );
  assert.equal(
    module.chatBlockedHint({
      ...baseEvidence,
      inventory: {
        localAgents: [{
          localAgentRef: 'local-agent:ren',
        }],
      },
    }),
    '请先选择已存在的本地伙伴。',
  );
});

test('Zhiyu removes the retired model control instead of inventing shared-config UX', async () => {
  const surface = await readFile(
    path.join(root, 'src/shell/agent-chat/ZhiyuAgentChatSurface.tsx'),
    'utf8',
  );
  assert.doesNotMatch(
    surface,
    /ComposerModelRouteButton|chatModelPresentation|openModelConfig|data-zhiyu-labeled-chip="route"/u,
  );
  assert.doesNotMatch(surface, /source-not-ready-diagnostic/u);
});

async function importAgentAIConfigModule() {
  const outputPath = path.join(await buildModules(), 'agent-ai-config.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function importTurnReadinessModule() {
  const outputPath = path.join(await buildModules(), 'agent-turn-readiness.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function importLabelsModule() {
  const outputPath = path.join(await buildModules(), 'ZhiyuAgentChatLabels.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildModules() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-agent-ai-config-'));
  await build({
    entryPoints: [
      path.join(root, 'src/shell/agent-chat/agent-ai-config.ts'),
      path.join(root, 'src/shell/agent-chat/agent-turn-readiness.ts'),
      path.join(root, 'src/shell/agent-chat/ZhiyuAgentChatLabels.ts'),
    ],
    outdir: buildDir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    plugins: [workspaceStubPlugin()],
  }).catch(async (error) => {
    const text = await readFile(path.join(root, 'src/shell/agent-chat/agent-ai-config.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu AI Config modules: ${error.message}\nsource length=${text.length}`);
  });
  return buildDir;
}

function workspaceStubPlugin() {
  return {
    name: 'workspace-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /auth\/runtime-platform$/ }, () => ({
        path: 'zhiyu-runtime-platform-stub',
        namespace: 'zhiyu-runtime-platform-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'zhiyu-runtime-platform-stub' }, () => ({
        loader: 'js',
        contents: `
          export function requireZhiyuLocalAppCapability(capability) {
            throw Object.assign(new Error('Zhiyu local-app capability is not admitted.'), {
              reasonCode: \`zhiyu-\${capability}-capability-not-admitted\`,
              actionHint: \`admit_zhiyu_\${capability.replaceAll('-', '_')}_capability\`,
              source: 'sdk',
              retryable: false,
            });
          }
        `,
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/renderer\/bridge$/ }, () => ({
        path: 'workspace-kit-bridge-stub',
        namespace: 'workspace-kit-bridge-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-kit-bridge-stub' }, () => ({
        loader: 'js',
        contents: 'export function hasElectronRuntime() { return false; }',
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/runtime$/ }, () => ({
        path: 'workspace-sdk-runtime-stub',
        namespace: 'workspace-sdk-runtime-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-sdk-runtime-stub' }, () => ({
        loader: 'js',
        contents: `
          export class Runtime {
            constructor(options = {}) {
              this.options = options;
              this.auth = {};
              this.grants = {};
              this.agents = {};
              this.appMessages = {};
            }
          }
          export function createNimiRuntimeAgentClient() {
            throw Object.assign(new Error('SDK runtime agent client is not available in unit tests.'), {
              reasonCode: 'sdk-runtime-agent-client-test-stub',
              source: 'test',
            });
          }
          export function createNimiHostRuntimeAgentInspectSurface() {
            return {
              cancelHook: async () => ({}),
              disableAutonomy: async () => ({}),
              enableAutonomy: async () => ({}),
              getPublicInspect: async () => ({}),
              getPresentationProfile: async () => null,
              setAutonomyConfig: async () => ({}),
              subscribePublicEvents: async () => undefined,
              updateState: async () => ({}),
            };
          }
          export function createNimiHostRuntimeAgentPresentationProfileSurface() {
            return {
              patchPresentationProfile: async () => undefined,
              setPresentationProfile: async () => undefined,
            };
          }
        `,
      }));
    },
  };
}

function agentCenterSnapshot(overrides = {}) {
  const sharedAIConfig = Object.hasOwn(overrides, 'sharedAIConfig')
    ? overrides.sharedAIConfig
    : sharedAIConfigProjection();
  return {
    phase: overrides.phase ?? 'ready',
    state: {
      sharedAIConfig,
    },
    availability: overrides.availability ?? {
      getSharedAIConfig: {
        state: 'available',
        reason: null,
        nextStep: null,
      },
    },
    error: overrides.error ?? null,
  };
}

function sharedAIConfigProjection(overrides = {}) {
  const capabilities = [
    capabilityIntent('text.generate', 'local'),
    capabilityIntent('image.generate', 'cloud'),
  ];
  return {
    aiConfig: canonicalSharedAIConfig(capabilities),
    capabilities: capabilities.map((intent) => intent.capabilityContract),
    intents: capabilities.map((intent) => ({
      capability: intent.capabilityContract,
      route: intent.route.oneofKind,
      requiredFeatures: [...intent.requiredFeatures],
    })),
    ...overrides,
  };
}

function canonicalSharedAIConfig(capabilities) {
  return {
    owner: {
      owner: { oneofKind: 'runtimeLocalAgentSubsystem', runtimeLocalAgentSubsystem: {} },
    },
    capabilities,
  };
}

function capabilityIntent(capabilityContract, route) {
  return {
    capabilityContract,
    requiredFeatures: [],
    route: route === 'local'
      ? { oneofKind: 'local', local: {} }
      : {
        oneofKind: 'cloud',
        cloud: {
          implementation: {
            implementationId: 'runtime-owned',
            driverId: 'runtime-owned',
            driverDialect: 'runtime-owned',
          },
          connectorGrantId: '',
        },
      },
  };
}

function conversationReady(overrides = {}) {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'conversation-anchor-open',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'Runtime-owned conversation anchor is open.',
    agentHandle: 'lah_v1_agent_opaque',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    threadId: 'runtime-thread:opaque',
    ...overrides,
  };
}
