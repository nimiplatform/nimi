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
  });
  assert.deepEqual(captured[0].request.executionBindings, {
    'text.generate': {
      route: 'local',
      modelId: 'runtime-model:opaque',
      targetRef: {
        kind: 'local-runtime',
        version: 'v2',
        profileBindingId: 'local-runtime:runtime-model-opaque',
      },
    },
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

test('Zhiyu Runtime Agent chat forwards image execution binding for Runtime action artifacts', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];

  await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady({
      executionBindings: {
        'text.generate': textExecutionBinding(),
        'image.generate': imageExecutionBinding(),
      },
    }),
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

  assert.deepEqual(captured[0].executionBindings, {
    'text.generate': textExecutionBinding(),
    'image.generate': imageExecutionBinding(),
  });
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
  assert.doesNotMatch(source, /apps\/desktop|apps\/tester|runtime\/internal/);
  assert.doesNotMatch(source, /withZhiyuElectronRuntimeProtectedScopes|operation\s*\(\s*\{\s*\}\s*\)/);
  assert.doesNotMatch(source, /\bsendTurn\(|fetch\(|apiKey|providerId|modelId:\s*['"]/);
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
    plugins: [workspaceKitSourceAliasPlugin(), workspaceSdkSourceAliasPlugin()],
  }).catch(async (error) => {
    const source = await readFile(path.join(root, 'src/shell/agent-chat/runtime-agent-turn-adapter.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu Runtime Agent chat adapter: ${error.message}\nsource length=${source.length}`);
  });
  return buildDir;
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
        contents: 'export function hasElectronRuntime() { return false; }',
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
    ...overrides,
  };
}

function routeReady(overrides = {}) {
  return {
    transport: 'electron-ipc',
    ready: true,
    capability: 'text.generate',
    aiConfigScopeOwnerId: 'nimi.zhiyu',
    aiConfigScopeSurfaceId: 'zhiyu-agent-home',
    enabledCapabilities: ['text.generate', 'chat.stream', 'text.embed', 'image.generate'],
    bindingCapabilities: {
      'text.generate': 'text.generate',
      'chat.stream': 'text.generate',
      'text.embed': 'text.embed',
      'image.generate': 'image.generate',
    },
    targetRefKinds: {
      'text.generate': 'local-runtime',
      'chat.stream': 'local-runtime',
      'text.embed': 'local-runtime',
      'image.generate': 'cloud-connector',
    },
    reasonCode: 'runtime-route-ready',
    actionHint: 'send_runtime_agent_turn',
    source: 'sdk',
    message: 'Runtime route projection resolved a text.generate execution binding.',
    selectedTargetRefKind: 'runtime-target',
    resolvedBindingRef: 'runtime-binding:opaque',
    executionBinding: textExecutionBinding(),
    ...overrides,
  };
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
    },
  });
}
