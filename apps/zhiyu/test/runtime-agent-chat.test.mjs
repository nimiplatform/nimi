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

test('Zhiyu Runtime Agent chat delegates streaming turns through shared Kit projection', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];

  const result = await module.runZhiyuRuntimeAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
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
  const result = await module.runZhiyuRuntimeAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
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

test('Zhiyu Runtime Agent chat fails closed for attachments and conversation anchor mismatch', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;
  const streamTurn = async () => {
    called = true;
    throw new Error('streamTurn must not be called');
  };

  const attachmentResult = await module.runZhiyuRuntimeAgentChatTurn({
    conversation: conversationReady(),
    route: routeReady(),
    text: 'with attachment',
    attachments: [{ kind: 'image', url: 'blob:local' }],
    streamTurn,
  });
  assert.equal(attachmentResult.ready, false);
  assert.equal(attachmentResult.reasonCode, 'zhiyu-runtime-agent-chat-attachments-not-admitted');
  assert.equal(called, false);

  const anchorMismatch = await module.runZhiyuRuntimeAgentChatTurn({
    conversation: conversationReady({ conversationAnchorId: 'conversation-anchor:old' }),
    route: routeReady(),
    text: 'anchor mismatch',
    expectedConversationAnchorId: 'conversation-anchor:current',
    streamTurn,
  });
  assert.equal(anchorMismatch.ready, false);
  assert.equal(anchorMismatch.reasonCode, 'zhiyu-conversation-anchor-mismatch');
  assert.equal(called, false);
});

test('Zhiyu Runtime Agent chat source uses shared Kit/SDK surfaces only', async () => {
  const source = await readFile(path.join(root, 'src/shell/agent/runtime-agent-chat.ts'), 'utf8');
  assert.match(source, /@nimiplatform\/kit\/features\/chat\/headless/);
  assert.match(source, /streamRuntimeAgentTurnRunnerPartsAsConversationEvents/);
  assert.match(source, /reduceRuntimeAgentConversationProjectionEvent/);
  assert.match(source, /createNimiRuntimeAgentClient/);
  assert.match(source, /\.streamTurn\(/);
  assert.doesNotMatch(source, /apps\/desktop|apps\/tester|runtime\/internal/);
  assert.doesNotMatch(source, /\bsendTurn\(|fetch\(|apiKey|providerId|modelId:\s*['"]/);
});

async function importRuntimeAgentChat() {
  const outputPath = path.join(await buildRuntimeAgentChat(), 'runtime-agent-chat.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildRuntimeAgentChat() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-runtime-agent-chat-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent/runtime-agent-chat.ts')],
    outfile: path.join(buildDir, 'runtime-agent-chat.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    plugins: [workspaceKitSourceAliasPlugin()],
  }).catch(async (error) => {
    const source = await readFile(path.join(root, 'src/shell/agent/runtime-agent-chat.ts'), 'utf8').catch(() => '');
    throw new Error(`failed to build Zhiyu Runtime Agent chat wrapper: ${error.message}\nsource length=${source.length}`);
  });
  return buildDir;
}

function workspaceKitSourceAliasPlugin() {
  return {
    name: 'workspace-kit-source-alias',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/kit\/features\/chat\/headless$/ }, () => ({
        path: path.join(root, '..', '..', 'kit/features/chat/src/headless.ts'),
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

function routeReady() {
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
    executionBinding: {
      route: 'local',
      modelId: 'runtime-model:opaque',
      targetRef: {
        kind: 'local-runtime',
        version: 'v2',
        profileBindingId: 'local-runtime:runtime-model-opaque',
      },
    },
  };
}
