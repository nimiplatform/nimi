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

test('Zhiyu AI Config route evidence projects committed config + readiness tri-state', async () => {
  const module = await importAgentAIConfigModule();
  const route = module.projectZhiyuAgentAIConfigRouteEvidence({
    config: configSnapshot(),
    readiness: readinessSnapshot([
      capabilityReadiness('text.generate', 'ready', ''),
      capabilityReadiness('image.generate', 'unavailable', 'route_unhealthy'),
    ]),
  });

  assert.equal(route.ready, true);
  assert.equal(route.capability, 'text.generate');
  assert.equal(route.configRevision, 7);
  assert.equal(route.readinessRevision, 7);
  assert.equal(route.updatedByAppId, 'nimi.zhiyu');
  assert.equal(route.reasonCode, 'runtime-agent-ai-config-ready');
  assert.equal(route.actionHint, 'send_runtime_agent_turn');
  assert.equal(route.source, 'runtime');
  assert.deepEqual(route.executionBinding, textBinding());
  assert.equal(route.capabilities['text.generate'].state, 'ready');
  assert.deepEqual(route.capabilities['text.generate'].binding, textBinding());
  assert.equal(route.capabilities['image.generate'].state, 'unavailable');
  assert.equal(route.capabilities['image.generate'].reasonCode, 'route_unhealthy');
  assert.deepEqual(route.capabilities['image.generate'].binding, imageBinding());
});

test('Zhiyu AI Config route evidence derives send-readiness from text.generate readiness only', async () => {
  const module = await importAgentAIConfigModule();

  const notConfigured = module.projectZhiyuAgentAIConfigRouteEvidence({
    config: configSnapshot({ intents: {} }),
    readiness: readinessSnapshot([
      capabilityReadiness('text.generate', 'not_configured', ''),
    ]),
  });
  assert.equal(notConfigured.ready, false);
  assert.equal(notConfigured.reasonCode, 'zhiyu-agent-ai-config-not-configured');
  assert.equal(notConfigured.actionHint, 'configure_runtime_agent_ai_config');
  assert.equal(notConfigured.executionBinding, null);

  const unavailable = module.projectZhiyuAgentAIConfigRouteEvidence({
    config: configSnapshot(),
    readiness: readinessSnapshot([
      capabilityReadiness('text.generate', 'unavailable', 'route_unhealthy'),
      capabilityReadiness('image.generate', 'ready', ''),
    ]),
  });
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.reasonCode, 'zhiyu-agent-ai-config-readiness-unavailable');
  assert.match(unavailable.message, /route_unhealthy/);
});

test('Zhiyu AI Config route evidence fails closed with typed zhiyu reason codes', async () => {
  const module = await importAgentAIConfigModule();

  const authRequired = module.zhiyuAgentAIConfigRouteAuthRequired();
  assert.equal(authRequired.ready, false);
  assert.equal(authRequired.reasonCode, 'zhiyu-agent-ai-config-auth-required');
  assert.equal(authRequired.actionHint, 'sign_in_runtime_account');
  assert.equal(authRequired.configRevision, null);

  const unavailable = module.zhiyuAgentAIConfigRouteUnavailable(Object.assign(
    new Error('grpc unavailable'),
    { reasonCode: 'RUNTIME_GRPC_UNAVAILABLE', source: 'runtime' },
  ));
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.reasonCode, 'zhiyu-agent-ai-config-unavailable');
  assert.match(unavailable.message, /RUNTIME_GRPC_UNAVAILABLE/);
  assert.match(unavailable.message, /grpc unavailable/);
  assert.equal(unavailable.executionBinding, null);

  const fetched = await module.fetchZhiyuAgentAIConfigRouteEvidence({ subjectUserId: '' });
  assert.equal(fetched.reasonCode, 'zhiyu-agent-ai-config-auth-required');

  const identityMissing = await module.fetchZhiyuAgentAIConfigRouteEvidence({ subjectUserId: 'user-1' });
  assert.equal(identityMissing.reasonCode, 'zhiyu-agent-ai-config-identity-required');
});

test('Zhiyu turn readiness gates on conversation anchor, Agent AI Config readiness, and Runtime binding', async () => {
  const module = await importTurnReadinessModule();
  const routeReady = {
    ready: true,
    reasonCode: 'runtime-agent-ai-config-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'ready',
  };
  const routeNotConfigured = {
    ready: false,
    reasonCode: 'zhiyu-agent-ai-config-not-configured',
    actionHint: 'configure_runtime_agent_ai_config',
    source: 'runtime',
    message: 'Runtime agent AI Config has no ready text.generate binding yet.',
  };

  const blockedByRoute = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    routeNotConfigured,
    scopedBindingDecision(module),
  );
  assert.equal(blockedByRoute.ready, false);
  assert.equal(blockedByRoute.reasonCode, 'zhiyu-agent-ai-config-not-configured');

  const blockedByBinding = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    routeReady,
    module.resolveZhiyuRuntimeAgentBindingDecision(),
  );
  assert.equal(blockedByBinding.ready, false);
  assert.equal(blockedByBinding.reasonCode, 'ZHIYU_RUNTIME_AGENT_BINDING_REQUIRED');

  const ready = module.probeZhiyuAgentTurnReadiness(
    conversationReady(),
    routeReady,
    scopedBindingDecision(module),
  );
  assert.equal(ready.ready, true);
  assert.equal(ready.reasonCode, 'runtime-turn-ready');
});

test('Zhiyu composer copy maps Agent AI Config readiness tri-state to Chinese product copy', async () => {
  const module = await importLabelsModule();
  const routeBase = {
    transport: 'electron-ipc',
    ready: false,
    capability: 'text.generate',
    configRevision: 7,
    readinessRevision: 7,
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
      reasonCode: 'zhiyu-agent-ai-config-auth-required',
    }),
    '请先登录本地运行服务账户。',
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

function configSnapshot(overrides = {}) {
  return {
    revision: 7,
    intents: {
      'text.generate': textBinding(),
      'image.generate': imageBinding(),
    },
    updatedAt: '2026-07-06T00:00:00.000Z',
    updatedByAppId: 'nimi.zhiyu',
    ...overrides,
  };
}

function readinessSnapshot(capabilities) {
  return {
    configRevision: 7,
    capabilities,
  };
}

function capabilityReadiness(capability, state, reasonCode) {
  return {
    capability,
    state,
    reasonCode,
    probedAt: '2026-07-06T00:00:01.000Z',
  };
}

function textBinding() {
  return {
    route: 'local',
    modelId: 'runtime-model:opaque',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:runtime-model-opaque',
    },
  };
}

function imageBinding() {
  return {
    route: 'cloud',
    modelId: 'runtime-image-model:opaque',
    connectorId: 'connector-runtime-image',
    targetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: 'connector-runtime-image',
      remoteModelCatalogId: 'catalog-runtime-image',
      providerModelId: 'runtime-image-model:opaque',
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
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    localAgentRef: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    ...overrides,
  };
}

function scopedBindingDecision(module) {
  return module.resolveZhiyuRuntimeAgentBindingDecision({
    scopedBinding: {
      bindingId: 'binding-ready',
      bindingHandle: 'runtime.binding/binding-ready',
      runtimeAppId: 'runtime.agent',
      appInstanceId: 'nimi.zhiyu.local',
      windowId: 'window-ready',
      agentId: 'runtime-local-agent:opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      worldId: 'world-ready',
    },
  });
}
