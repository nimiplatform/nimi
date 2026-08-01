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

test('Zhiyu AI Config route evidence projects the permissioned Agent Center snapshot', async () => {
  const module = await importAgentAIConfigModule();
  const route = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot());

  assert.equal(route.ready, true);
  assert.equal(route.capability, 'text.generate');
  assert.equal(route.configRevision, '7');
  assert.equal(route.readinessRevision, '7');
  assert.equal(route.updatedByAppId, null);
  assert.equal(route.reasonCode, 'runtime-agent-ai-config-ready');
  assert.equal(route.actionHint, 'send_runtime_agent_turn');
  assert.equal(route.source, 'runtime');
  assert.deepEqual(route.executionBinding, textBinding());
  assert.equal(route.capabilities['text.generate'].state, 'ready');
  assert.deepEqual(route.capabilities['text.generate'].binding, textBinding());
  assert.equal(route.capabilities['image.generate'].state, 'unavailable');
  assert.equal(route.capabilities['image.generate'].reasonCode, 'route_unhealthy');
  assert.deepEqual(route.capabilities['image.generate'].binding, imageBinding());
  assert.equal('connectorId' in route.capabilities['image.generate'].binding, false);
});

test('Zhiyu AI Config route evidence derives send-readiness from text.generate readiness only', async () => {
  const module = await importAgentAIConfigModule();

  const notConfigured = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    aiConfig: aiConfigProjection({
      routeIntents: [],
      readiness: [{
        capability: 'text.generate',
        state: 'blocked',
        reason: 'not_configured',
        observedAt: null,
      }],
    }),
  }));
  assert.equal(notConfigured.ready, false);
  assert.equal(notConfigured.reasonCode, 'zhiyu-agent-ai-config-not-configured');
  assert.equal(notConfigured.actionHint, 'configure_runtime_agent_ai_config');
  assert.equal(notConfigured.executionBinding, null);

  const blockedWithBinding = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    aiConfig: aiConfigProjection({
      readiness: [
        capabilityReadiness('text.generate', 'blocked', 'not_configured'),
      ],
    }),
  }));
  assert.equal(blockedWithBinding.reasonCode, 'zhiyu-agent-ai-config-not-configured');
  assert.equal(blockedWithBinding.capabilities['text.generate'].state, 'not_configured');
  assert.deepEqual(blockedWithBinding.executionBinding, textBinding());

  const unavailable = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    aiConfig: aiConfigProjection({
      readiness: [
        capabilityReadiness('text.generate', 'unavailable', 'route_unhealthy'),
        capabilityReadiness('image.generate', 'ready', ''),
      ],
    }),
  }));
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.reasonCode, 'zhiyu-agent-ai-config-readiness-unavailable');
  assert.match(unavailable.message, /route_unhealthy/);
});

test('Zhiyu AI Config route evidence fails closed without account or raw Agent identity', async () => {
  const module = await importAgentAIConfigModule();

  const identityRequired = module.projectZhiyuAgentAIConfigRouteEvidence(null);
  assert.equal(identityRequired.ready, false);
  assert.equal(identityRequired.reasonCode, 'zhiyu-agent-ai-config-identity-required');
  assert.equal(identityRequired.actionHint, 'select_runtime_local_agent');

  const permissionRequired = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    aiConfig: null,
    availability: {
      readAIConfig: {
        state: 'unavailable',
        reason: 'needs-grant',
        nextStep: 'requestPermission',
      },
    },
  }));
  assert.equal(permissionRequired.reasonCode, 'zhiyu-agent-ai-config-permission-required');
  assert.equal(permissionRequired.actionHint, 'request_agents_configure_permission');

  const unavailable = module.projectZhiyuAgentAIConfigRouteEvidence(agentCenterSnapshot({
    phase: 'degraded',
    aiConfig: null,
    error: 'Runtime is offline.',
    availability: {
      readAIConfig: {
        state: 'unavailable',
        reason: 'runtime-offline',
        nextStep: 'retry',
      },
    },
  }));
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.reasonCode, 'zhiyu-agent-ai-config-unavailable');
  assert.match(unavailable.message, /offline/);
  assert.equal(unavailable.executionBinding, null);

  const source = await readFile(path.join(root, 'src/shell/agent-chat/agent-ai-config.ts'), 'utf8');
  assert.doesNotMatch(
    source,
    /subjectUserId|accountId|ownerUserId|runtimeSourceRef|localAgentRef|requireZhiyuLocalAppCapability|@nimiplatform\/sdk\/runtime/u,
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

test('Zhiyu composer copy maps Agent AI Config readiness tri-state to Chinese product copy', async () => {
  const module = await importLabelsModule();
  const routeBase = {
    transport: 'electron-ipc',
    ready: false,
    capability: 'text.generate',
    configRevision: '7',
    readinessRevision: '7',
    updatedAt: null,
    updatedByAppId: 'nimi.zhiyu',
    capabilities: {},
    executionBinding: null,
    reasonCode: 'zhiyu-agent-ai-config-not-configured',
    actionHint: 'configure_runtime_agent_ai_config',
    source: 'runtime',
    message: 'not configured',
  };

  assert.equal(
    module.agentAIConfigReadinessHint(routeBase),
    '请先在伙伴中心完成模型配置。',
  );
  assert.equal(
    module.agentAIConfigReadinessHint({
      ...routeBase,
      reasonCode: 'zhiyu-agent-ai-config-readiness-unavailable',
      capabilities: {
        'text.generate': {
          state: 'unavailable',
          reasonCode: 'route_unhealthy',
          probedAt: null,
          binding: textBinding(),
        },
      },
    }),
    '模型通路暂不可用，请检查本地模型服务或云端连接。',
  );
  assert.equal(
    module.agentAIConfigReadinessHint({
      ...routeBase,
      capabilities: {
        'text.generate': {
          state: 'unavailable',
          reasonCode: 'connector_missing',
          probedAt: null,
          binding: null,
        },
      },
      reasonCode: 'zhiyu-agent-ai-config-readiness-unavailable',
    }),
    '云端连接器缺失，请重新完成模型配置。',
  );
  assert.equal(
    module.agentAIConfigReadinessHint({
      ...routeBase,
      reasonCode: 'zhiyu-agent-ai-config-permission-required',
    }),
    '请先授权织羽读取伙伴模型配置。',
  );
  assert.equal(
    module.agentAIConfigReadinessHint({
      ...routeBase,
      reasonCode: 'zhiyu-agent-ai-config-unavailable',
    }),
    '本地运行服务暂时不可用，请稍后重试。',
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

test('Zhiyu composer projects the configured model from the permissioned Agent Center snapshot', async () => {
  const module = await importLabelsModule();
  const evidence = {
    route: {
      ready: false,
      executionBinding: null,
      reasonCode: 'zhiyu-agent-ai-config-permission-required',
    },
  };
  assert.deepEqual(module.chatModelPresentation(evidence), {
    label: '模型配置需授权',
    ready: false,
    reasonCode: 'zhiyu-agent-ai-config-permission-required',
  });
  const presentation = module.chatModelPresentation(evidence, {
    routeIntents: [{
      capability: 'text.generate',
      provider: '',
      model: 'gemma-4-e2b-it-local',
      routePolicy: 'local',
    }],
    routeOptions: [{
      capability: 'text.generate',
      provider: '',
      model: 'gemma-4-e2b-it-local',
      routePolicy: 'local',
      label: 'Gemma Local',
      availability: 'ready',
    }],
    readiness: [{
      capability: 'text.generate',
      state: 'ready',
      reason: '',
      observedAt: null,
    }],
  });

  assert.deepEqual(presentation, {
    label: 'Gemma Local',
    ready: true,
    reasonCode: 'runtime-agent-ai-config-ready',
  });
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
  const aiConfig = Object.hasOwn(overrides, 'aiConfig')
    ? overrides.aiConfig
    : aiConfigProjection();
  return {
    phase: overrides.phase ?? 'ready',
    state: {
      aiConfig,
    },
    availability: overrides.availability ?? {
      readAIConfig: {
        state: 'available',
        reason: null,
        nextStep: null,
      },
    },
    error: overrides.error ?? null,
  };
}

function aiConfigProjection(overrides = {}) {
  const scopeRef = {
    kind: 'local-agent',
    ownerId: 'lah_v1_agent_opaque',
  };
  return {
    aiConfig: {
      scopeRef,
      profileOrigin: null,
      capabilities: {
        logicalModelIds: {
          'text.generate': 'runtime-model:opaque',
          'image.generate': 'runtime-image-model:opaque',
        },
        targetRefs: {},
        selectedComponents: {},
        selectedParams: {},
      },
    },
    scopeRef,
    capabilities: ['text.generate', 'image.generate'],
    routeIntents: [
      {
        capability: 'text.generate',
        routePolicy: 'local',
        provider: '',
        model: 'runtime-model:opaque',
      },
      {
        capability: 'image.generate',
        routePolicy: 'cloud',
        provider: 'connector-runtime-image',
        model: 'runtime-image-model:opaque',
      },
    ],
    routeOptions: [],
    readiness: [
      capabilityReadiness('text.generate', 'ready', ''),
      capabilityReadiness('image.generate', 'unavailable', 'route_unhealthy'),
    ],
    configurationRevision: '7',
    ...overrides,
  };
}

function capabilityReadiness(capability, state, reasonCode) {
  return {
    capability,
    state,
    reason: reasonCode,
    observedAt: '2026-07-06T00:00:01.000Z',
  };
}

function textBinding() {
  return {
    route: 'local',
    modelId: 'runtime-model:opaque',
  };
}

function imageBinding() {
  return {
    route: 'cloud',
    modelId: 'runtime-image-model:opaque',
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
