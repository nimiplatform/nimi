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

test('Zhiyu Runtime Agent chat delegates streaming turns through Desktop-parity Kit/SDK projection', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'hello from Zhiyu chat',
    requestId: 'zhiyu-turn-test-1',
    streamTurn: async (request, options) => {
      captured.push({ request, options });
      return {
        stream: parts([
          { type: 'reasoning-delta', textDelta: 'checking runtime' },
          { type: 'text-delta', textDelta: 'Hello ' },
          { type: 'text-delta', textDelta: 'Zhiyu' },
          {
            type: 'message-sealed',
            envelope: {
              message: {
                messageId: 'runtime-message-1',
                text: 'Hello Zhiyu',
              },
            },
            diagnostics: {
              transport: 'runtime.agent.turns',
              runtimeTurnId: 'runtime-turn-1',
            },
          },
          { type: 'turn-completed', outputText: 'Hello Zhiyu', finishReason: 'stop' },
        ]),
      };
    },
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].request.ownerUserId, 'user-1');
  assert.equal(captured[0].request.runtimeSourceRef, 'runtime-source:opaque');
  assert.equal(captured[0].request.localAgentRef, 'runtime-local-agent:opaque');
  assert.equal(captured[0].request.conversationAnchorId, 'conversation-anchor:opaque');
  assert.equal(captured[0].request.threadId, 'runtime-thread:opaque');
  assert.equal(captured[0].request.requestId, 'zhiyu-turn-test-1');
  assert.deepEqual(captured[0].request.scopedBinding, {
    bindingId: 'binding-turn-ready',
    bindingHandle: 'runtime.binding/binding-turn-ready',
    runtimeAppId: 'runtime.agent',
    appInstanceId: 'nimi.zhiyu.local',
    windowId: 'window-turn-ready',
    avatarInstanceId: '',
    agentId: 'runtime-local-agent:opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    worldId: 'world-turn-ready',
    scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
  });
  // Atomic hard cut: turn requests never carry model bindings; the runtime
  // resolves execution from its committed Runtime Agent AI Config.
  assert.equal('executionBindings' in captured[0].request, false);
  assert.deepEqual(captured[0].request.reasoning, {
    mode: 'on',
    traceMode: 'separate',
  });
  assert.deepEqual(captured[0].request.messages, [
    { role: 'user', content: 'hello from Zhiyu chat' },
  ]);
  assert.equal(result.ready, true);
  assert.equal(result.state, 'completed');
  assert.equal(result.reasonCode, 'runtime-agent-turn-completed');
  assert.equal(
    result.messages.some((message) =>
      message.role === 'user'
      && message.text === 'hello from Zhiyu chat'
      && message.metadata?.turnId === 'zhiyu-turn-test-1',
    ),
    true,
  );
  assert.deepEqual(result.events.map((event) => event.type), [
    'turn-started',
    'reasoning-delta',
    'text-delta',
    'text-delta',
    'message-sealed',
    'turn-completed',
  ]);
  assert.equal(result.messages.at(-1).id, 'runtime-message-1');
  assert.equal(result.messages.at(-1).text, 'Hello Zhiyu');
  assert.equal(result.messages.at(-1).status, 'complete');
  assert.equal(result.messages.at(-1).metadata.reasoningText, 'checking runtime');
});

test('Zhiyu Runtime Agent chat does not attach delegation-only scoped binding to turn requests', async () => {
  const module = await importRuntimeAgentChat();
  const previousBinding = globalThis.__nimiZhiyuRuntimeAgentBinding;
  const captured = [];
  globalThis.__nimiZhiyuRuntimeAgentBinding = {
    scopedBinding: {
      bindingId: 'binding-delegation-only',
      bindingHandle: 'runtime.binding/binding-delegation-only',
      runtimeAppId: 'nimi.zhiyu',
      appInstanceId: 'nimi.zhiyu.local-first-party',
      agentId: 'runtime-local-agent:opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      bindingSource: 'runtime-account-service',
      scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
    },
    hostEquivalence: {
      evidenceRef: 'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
      authority: 'runtime-sdk',
      failureSemantics: 'fail-closed',
    },
  };

  try {
    const result = await module.runZhiyuAgentChatTurn({
      conversation: conversationReady(),
      route: routeReady(),
      text: 'hello with delegation-only binding present',
      requestId: 'zhiyu-turn-test-delegation-binding-not-reused',
      streamTurn: async (request) => {
        captured.push(request);
        return {
          stream: parts([
            { type: 'text-delta', textDelta: 'Hello' },
            {
              type: 'message-sealed',
              envelope: {
                message: {
                  messageId: 'runtime-message-delegation-binding-not-reused',
                  text: 'Hello',
                },
              },
            },
            { type: 'turn-completed', outputText: 'Hello', finishReason: 'stop' },
          ]),
        };
      },
    });

    assert.equal(result.ready, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].scopedBinding, undefined);
  } finally {
    if (previousBinding === undefined) {
      delete globalThis.__nimiZhiyuRuntimeAgentBinding;
    } else {
      globalThis.__nimiZhiyuRuntimeAgentBinding = previousBinding;
    }
  }
});

test('Zhiyu Runtime Agent chat rejects injected scoped binding without turn scopes before streaming', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: module.resolveZhiyuRuntimeAgentBindingDecision({
      scopedBinding: {
        bindingId: 'binding-without-turn-scopes',
        bindingHandle: 'runtime.binding/binding-without-turn-scopes',
        runtimeAppId: 'runtime.agent',
        appInstanceId: 'nimi.zhiyu.local',
        agentId: 'runtime-local-agent:opaque',
        conversationAnchorId: 'conversation-anchor:opaque',
        scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
      },
    }),
    text: 'must not stream with delegation-only injected binding',
    requestId: 'zhiyu-turn-test-injected-binding-scope-missing',
    streamTurn: async () => {
      called = true;
      throw new Error('streamTurn must not be called');
    },
  });

  assert.equal(called, false);
  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'zhiyu-runtime-agent-scoped-binding-scope-missing');
  assert.equal(result.actionHint, 'issue_runtime_scoped_binding_for_required_scopes');
});

test('Zhiyu Runtime Agent chat exposes mid-stream failure as failed, not accepted success', async () => {
  const module = await importRuntimeAgentChat();
  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'fail visibly',
    requestId: 'zhiyu-turn-test-fail',
    streamTurn: async () => ({
      stream: parts([
        { type: 'text-delta', textDelta: 'partial text' },
        {
          type: 'turn-failed',
          error: {
            code: 'RUNTIME_AGENT_TURN_FAILED',
            message: 'fixture failure',
          },
          outputText: 'partial text',
        },
      ]),
    }),
  });

  assert.equal(result.ready, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.reasonCode, 'RUNTIME_AGENT_TURN_FAILED');
  assert.notEqual(result.reasonCode, 'runtime-turn-request-accepted');
  assert.equal(result.messages.at(-1).status, 'error');
  assert.equal(result.messages.at(-1).error, 'fixture failure');
  assert.deepEqual(result.events.map((event) => event.type), [
    'turn-started',
    'text-delta',
    'turn-failed',
  ]);
});

test('Zhiyu Runtime Agent chat preserves Runtime action and artifact projection metadata', async () => {
  const module = await importRuntimeAgentChat();

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'make a visual artifact',
    requestId: 'zhiyu-turn-test-artifact',
    streamTurn: async () => ({
      stream: parts([
        {
          type: 'message-sealed',
          envelope: {
            message: {
              messageId: 'runtime-message-artifact',
              text: 'I prepared an artifact.',
            },
          },
        },
        {
          type: 'beat-planned',
          beatId: 'runtime-action-image-1',
          projectionMessageId: 'runtime-message-artifact',
        },
        {
          type: 'beat-delivery-started',
          beatId: 'runtime-action-image-1',
          projectionMessageId: 'runtime-message-artifact',
        },
        {
          type: 'artifact-ready',
          beatId: 'runtime-action-image-1',
          artifactId: 'artifact-image-1',
          mimeType: 'image/png',
          projectionMessageId: 'runtime-message-artifact',
        },
        {
          type: 'beat-delivered',
          beatId: 'runtime-action-image-1',
          artifactId: 'artifact-image-1',
          mimeType: 'image/png',
          projectionMessageId: 'runtime-message-artifact',
        },
        { type: 'turn-completed', outputText: 'I prepared an artifact.', finishReason: 'stop' },
      ]),
    }),
  });

  assert.deepEqual(result.events.map((event) => event.type), [
    'turn-started',
    'message-sealed',
    'beat-planned',
    'beat-delivery-started',
    'artifact-ready',
    'beat-delivered',
    'turn-completed',
  ]);
  const artifacts = result.messages.at(-1)?.metadata?.artifacts;
  assert.equal(Array.isArray(artifacts), true);
  assert.equal(artifacts?.[0]?.artifactId, 'artifact-image-1');
  assert.equal(artifacts?.[0]?.mimeType, 'image/png');
  assert.equal(artifacts?.[0]?.uri ?? null, null);
});

test('Zhiyu Runtime Agent chat renders resolved Runtime image artifacts as chat image messages', async () => {
  const module = await importRuntimeAgentChat();

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'make a visual artifact',
    requestId: 'zhiyu-turn-test-artifact-image',
    resolveArtifactPreviewUri: async (artifact) => `runtime-preview://${artifact.artifactId}`,
    streamTurn: async () => ({
      stream: parts([
        {
          type: 'message-sealed',
          envelope: {
            message: {
              messageId: 'runtime-message-artifact-image',
              text: 'I prepared an image.',
            },
          },
        },
        {
          type: 'artifact-ready',
          beatId: 'runtime-action-image-1',
          artifactId: 'artifact-image-1',
          mimeType: 'image/png',
          projectionMessageId: 'runtime-message-image-1',
        },
        { type: 'turn-completed', outputText: 'I prepared an image.', finishReason: 'stop' },
      ]),
    }),
  });

  assert.equal(result.ready, true);
  const imageMessage = result.messages.find((message) => message.kind === 'image');
  assert.equal(imageMessage?.id, 'runtime-message-image-1');
  assert.equal(imageMessage?.text, 'I prepared an image.');
  assert.equal(imageMessage?.metadata?.mediaUrl, 'runtime-preview://artifact-image-1');
  assert.equal(imageMessage?.metadata?.artifactProjection, 'runtime.agent.turn.artifact_ready');
});

test('Zhiyu Runtime Agent chat turn requests never carry model bindings', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];

  await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'make an image',
    requestId: 'zhiyu-turn-test-image-binding',
    streamTurn: async (request) => {
      captured.push(request);
      return {
        stream: parts([
          {
            type: 'message-sealed',
            envelope: {
              message: {
                messageId: 'runtime-message-image-binding',
                text: 'image action available',
              },
            },
          },
          { type: 'turn-completed', outputText: 'image action available', finishReason: 'stop' },
        ]),
      };
    },
  });

  // Atomic hard cut: even with local route evidence for text+image, the turn
  // request never carries model bindings (K-AGCORE-147).
  assert.equal('executionBindings' in captured[0], false);
});

test('Zhiyu Runtime Agent chat fails closed before streaming when Agent AI Config readiness is not ready', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeNotReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'must not stream while text.generate is not configured',
    streamTurn: async () => {
      called = true;
      throw new Error('streamTurn must not be called');
    },
  });

  assert.equal(called, false);
  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'zhiyu-agent-ai-config-not-configured');
  assert.equal(result.actionHint, 'configure_runtime_agent_ai_config');
});

test('Zhiyu Runtime Agent chat fails closed before streaming without Runtime binding evidence', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: module.resolveZhiyuRuntimeAgentBindingDecision(),
    text: 'must not stream',
    streamTurn: async () => {
      called = true;
      throw new Error('streamTurn must not be called');
    },
  });

  assert.equal(called, false);
  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'ZHIYU_RUNTIME_AGENT_BINDING_REQUIRED');
  assert.equal(result.actionHint, 'attach_runtime_scoped_binding_or_admitted_host_equivalence');
});

test('Zhiyu Runtime Agent chat fails closed for attachments and conversation anchor mismatch', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;
  const streamTurn = async () => {
    called = true;
    throw new Error('streamTurn must not be called');
  };

  const attachmentResult = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'with attachment',
    attachments: [{ kind: 'image', url: 'blob:local' }],
    streamTurn,
  });
  assert.equal(attachmentResult.ready, false);
  assert.equal(attachmentResult.reasonCode, 'zhiyu-runtime-agent-chat-attachments-not-admitted');
  assert.equal(called, false);

  const anchorMismatch = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady({ conversationAnchorId: 'conversation-anchor:old' }),
    route: routeReady(),
    runtimeBinding: runtimeScopedBinding(module),
    text: 'anchor mismatch',
    expectedConversationAnchorId: 'conversation-anchor:current',
    streamTurn,
  });
  assert.equal(anchorMismatch.ready, false);
  assert.equal(anchorMismatch.reasonCode, 'zhiyu-conversation-anchor-mismatch');
  assert.equal(called, false);
});

test('Zhiyu Runtime Agent chat source uses Desktop-parity shared Kit/SDK surfaces only', async () => {
  const source = await readFile(path.join(root, 'src/shell/agent-chat/runtime-agent-turn-adapter.ts'), 'utf8');
  assert.match(source, /@nimiplatform\/kit\/features\/chat\/headless/);
  assert.match(source, /streamRuntimeAgentTurnRunnerPartsAsConversationEvents/);
  assert.match(source, /reduceRuntimeAgentConversationProjectionEvent/);
  assert.match(source, /createNimiRuntimeAgentTurnsModule/);
  assert.match(source, /runNimiRuntimeAgentTurn/);
  assert.match(source, /scopedBindingForRuntimeAgentRequest/);
  assert.match(source, /agents-interact-not-admitted/);
  assert.match(source, /wait_for_agents_interact_admission/);
  assert.doesNotMatch(source, /createNimiAppRuntimePlatformClient/);
  assert.doesNotMatch(source, /createNimiLocalAppStandardShellSurface/);
  assert.doesNotMatch(source, /platform\.agent\.|platform\.artifacts\./);
  assert.doesNotMatch(source, /apps\/desktop|apps\/tester|runtime\/internal/);
  assert.doesNotMatch(source, /withZhiyuElectronRuntimeProtectedScopes|operation\s*\(\s*\{\s*\}\s*\)/);
  assert.doesNotMatch(source, /fetch\(|apiKey|providerId|modelId:\s*['"]/);
});

async function importRuntimeAgentChat() {
  const outputPath = path.join(await buildRuntimeAgentChat(), 'runtime-agent-turn-adapter.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildRuntimeAgentChat() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-runtime-agent-chat-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/runtime-agent-turn-adapter.ts')],
    outfile: path.join(buildDir, 'runtime-agent-turn-adapter.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    plugins: [
      workspaceKitSourceAliasPlugin(),
      workspaceSdkSourceAliasPlugin(),
      zhiyuRuntimePlatformStubPlugin(),
    ],
  }).catch(async (error) => {
    const source = await readFile(path.join(root, 'src/shell/agent-chat/runtime-agent-turn-adapter.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu Runtime Agent chat adapter: ${error.message}\nsource length=${source.length}`);
  });
  return buildDir;
}

function zhiyuRuntimePlatformStubPlugin() {
  return {
    name: 'zhiyu-runtime-platform-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /auth\/runtime-platform$/ }, () => ({
        path: 'zhiyu-runtime-platform-stub',
        namespace: 'zhiyu-runtime-platform-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'zhiyu-runtime-platform-stub' }, () => ({
        loader: 'js',
        contents: `
          import { Runtime } from '@nimiplatform/sdk/runtime';
          let runtime;
          export function getZhiyuRuntime() {
            runtime ??= new Runtime({ appId: 'nimi.zhiyu', transport: { type: 'test' } });
            return runtime;
          }
        `,
      }));
    },
  };
}

function workspaceKitSourceAliasPlugin() {
  return {
    name: 'workspace-kit-source-alias',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/features\/chat\/headless$/ }, () => ({
        path: path.join(root, '..', '..', 'kit/features/chat/src/headless/runtime-agent-turn-projection.ts'),
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/shell\/renderer\/bridge$/ }, () => ({
        path: 'workspace-kit-bridge-stub',
        namespace: 'workspace-kit-bridge-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-kit-bridge-stub' }, () => ({
        loader: 'js',
        contents: `
          export function hasElectronRuntime() { return false; }
          export function createNimiLocalAppStandardShellSurface() {
            throw new Error('Local-app carrier must be injected only by carrier-specific tests.');
          }
        `,
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/core\/sdk-contract$/ }, () => ({
        path: 'workspace-kit-sdk-contract-stub',
        namespace: 'workspace-kit-sdk-contract-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'workspace-kit-sdk-contract-stub' }, () => ({
        loader: 'js',
        contents: `
          export function createNimiClient() {
            throw new Error('Local-app platform client must be injected only by carrier-specific tests.');
          }
        `,
      }));
    },
  };
}

function workspaceSdkSourceAliasPlugin() {
  return {
    name: 'workspace-sdk-runtime-stub',
    setup(buildApi) {
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
          export function createNimiRuntimeAgentTurnsModule() {
            return {};
          }
          export async function runNimiRuntimeAgentTurn() {
            throw Object.assign(new Error('SDK turn runner is not available in injected-stream unit tests.'), {
              reasonCode: 'sdk-runtime-agent-turn-runner-test-stub',
              actionHint: 'inject_stream_turn',
              source: 'test',
            });
          }
        `,
      }));
    },
  };
}

async function* parts(items) {
  for (const item of items) {
    yield item;
  }
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
    threadId: 'runtime-thread:opaque',
    ...overrides,
  };
}

// evidence.route projects the runtime-owned AI Config + readiness
// (K-AGCORE-144~150): committed revision, per-capability binding summary,
// readiness tri-state, and send-readiness from text.generate === 'ready'.
function routeReady(overrides = {}) {
  return {
    transport: 'electron-ipc',
    ready: true,
    capability: 'text.generate',
    configRevision: 3,
    readinessRevision: 3,
    updatedAt: '2026-07-06T00:00:00.000Z',
    updatedByAppId: 'nimi.zhiyu',
    capabilities: {
      'text.generate': {
        state: 'ready',
        reasonCode: '',
        probedAt: '2026-07-06T00:00:01.000Z',
        binding: textExecutionBinding(),
      },
      'image.generate': {
        state: 'ready',
        reasonCode: '',
        probedAt: '2026-07-06T00:00:01.000Z',
        binding: imageExecutionBinding(),
      },
    },
    executionBinding: textExecutionBinding(),
    reasonCode: 'runtime-agent-ai-config-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'runtime',
    message: 'Runtime agent AI Config projects text.generate as ready.',
    ...overrides,
  };
}

function routeNotReady() {
  return routeReady({
    ready: false,
    capabilities: {
      'text.generate': {
        state: 'not_configured',
        reasonCode: '',
        probedAt: null,
        binding: null,
      },
    },
    executionBinding: null,
    reasonCode: 'zhiyu-agent-ai-config-not-configured',
    actionHint: 'configure_runtime_agent_ai_config',
    message: 'Runtime Agent AI Config has no ready text.generate intent yet.',
  });
}

function textExecutionBinding() {
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

function imageExecutionBinding() {
  return {
    route: 'cloud',
    modelId: 'runtime-image-model:opaque',
    targetRef: {
      kind: 'cloud-connector',
      connectorId: 'connector-runtime-image',
      modelId: 'runtime-image-model:opaque',
    },
    connectorId: 'connector-runtime-image',
  };
}

function runtimeScopedBinding(module) {
  return module.resolveZhiyuRuntimeAgentBindingDecision({
    scopedBinding: {
      bindingId: 'binding-turn-ready',
      bindingHandle: 'runtime.binding/binding-turn-ready',
      runtimeAppId: 'runtime.agent',
      appInstanceId: 'nimi.zhiyu.local',
      windowId: 'window-turn-ready',
      agentId: 'runtime-local-agent:opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      worldId: 'world-turn-ready',
      scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
    },
  });
}
