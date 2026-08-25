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
  assert.deepEqual(captured[0].request, {
    agentHandle: 'lah_v1_agent_opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    threadId: 'runtime-thread:opaque',
    requestId: 'zhiyu-turn-test-1',
    text: 'hello from Zhiyu chat',
  });
  assert.doesNotMatch(
    JSON.stringify(captured[0].request),
    /ownerUserId|runtimeSourceRef|localAgentRef|modelId|binding|accessToken|authorization/u,
  );
  if (!result.ready) assert.fail(JSON.stringify(result));
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

test('Zhiyu Runtime Agent chat consumes the admitted direct local-app conversation surface', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];
  const previousWindow = globalThis.window;
  globalThis.window = {};
  globalThis.__nimiZhiyuHasElectronRuntime = true;

  try {
    const result = await module.runZhiyuAgentChatTurn({
      conversation: conversationReady(),
      text: 'hello through local app',
      requestId: 'zhiyu-turn-test-local-app',
      conversationClient: localAppConversationClient(captured),
    });

    assert.equal(result.ready, true);
    assert.equal(result.messages.at(-1).id, 'runtime-message-local-app');
    assert.deepEqual(captured, [
      {
        method: 'subscribe',
        input: {
          agentHandle: 'lah_v1_agent_opaque',
          conversationAnchorId: 'conversation-anchor:opaque',
        },
      },
      {
        method: 'send',
        input: {
          agentHandle: 'lah_v1_agent_opaque',
          conversationAnchorId: 'conversation-anchor:opaque',
          requestId: 'zhiyu-turn-test-local-app',
          parts: [{ kind: 'text', text: 'hello through local app' }],
        },
      },
      { method: 'cancel' },
    ]);
    assert.doesNotMatch(
      JSON.stringify(captured),
      /bindingHandle|bindingId|accessToken|sessionToken|authorization|ownerUserId|localAgentRef/u,
    );
  } finally {
    delete globalThis.__nimiZhiyuHasElectronRuntime;
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('Zhiyu stop routes through the exact local App interrupt operation', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];
  const controller = new AbortController();
  const previousWindow = globalThis.window;
  globalThis.window = {};
  globalThis.__nimiZhiyuHasElectronRuntime = true;
  try {
    const result = await module.runZhiyuAgentChatTurn({
      conversation: conversationReady(),
      text: 'stop this turn',
      requestId: 'zhiyu-turn-test-interrupt',
      signal: controller.signal,
      conversationClient: {
        async subscribe(scope) {
          captured.push({ method: 'subscribe', input: scope });
          return {
            async cancel() { captured.push({ method: 'cancel' }); },
            [Symbol.asyncIterator]() {
              return { next: () => new Promise(() => undefined) };
            },
          };
        },
        async send(input) {
          captured.push({ method: 'send', input });
          queueMicrotask(() => controller.abort());
          return { turnId: 'runtime-turn-interrupted' };
        },
        async interruptTurn(input) {
          captured.push({ method: 'interrupt', input });
          return { turnId: 'runtime-turn-interrupted' };
        },
        async snapshot() { return { voices: [] }; },
      },
    });

    assert.equal(result.state, 'canceled');
    assert.deepEqual(captured.map(({ method }) => method), ['subscribe', 'send', 'interrupt', 'cancel']);
    assert.deepEqual(captured[2].input, {
      agentHandle: 'lah_v1_agent_opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
    });
  } finally {
    delete globalThis.__nimiZhiyuHasElectronRuntime;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('Zhiyu Runtime Agent chat fails closed without an opaque account-scope Agent handle', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady({ agentHandle: null }),
    text: 'must not stream without an Agent handle',
    requestId: 'zhiyu-turn-test-agent-handle-missing',
    streamTurn: async () => {
      called = true;
      throw new Error('streamTurn must not be called');
    },
  });

  assert.equal(called, false);
  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'zhiyu-conversation-anchor-required');
  assert.equal(result.actionHint, 'open_runtime_conversation_anchor');
});

test('Zhiyu Runtime Agent chat exposes mid-stream failure as failed, not accepted success', async () => {
  const module = await importRuntimeAgentChat();
  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
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

test('pre-admission session closure requests reselection without claiming Runtime continued', async () => {
  const module = await importRuntimeAgentChat();
  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    text: 'continue in Runtime',
    requestId: 'zhiyu-turn-session-refresh',
    streamTurn: async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          throw Object.assign(new Error('session rotated'), {
            reasonCode: 'local-app-access-denied',
            actionHint: 'refresh_local_app_session',
            source: 'runtime',
          });
        },
      },
    }),
  });

  assert.equal(result.ready, false);
  assert.equal(result.state, 'idle');
  assert.equal(result.reasonCode, 'local-app-access-denied');
  assert.equal(result.actionHint, 'reselect_local_partner');
  assert.equal(result.diagnostics?.turnAdmission, 'not_observed');
  assert.doesNotMatch(result.message, /continued the turn/u);
  assert.deepEqual(result.events, []);
});

test('streamTurn rejection before admission preserves the draft contract', async () => {
  const module = await importRuntimeAgentChat();
  const observedEvents = [];
  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    text: 'keep this draft',
    requestId: 'zhiyu-turn-pre-admission-rejection',
    onEvent: (event) => observedEvents.push(event),
    streamTurn: async () => {
      throw Object.assign(new Error('session rotated before send'), {
        reasonCode: 'local-app-access-denied',
        actionHint: 'refresh_local_app_session',
        source: 'runtime',
      });
    },
  });

  assert.equal(result.actionHint, 'reselect_local_partner');
  assert.equal(result.diagnostics?.turnAdmission, 'not_observed');
  assert.match(result.message, /before Runtime turn admission was observed/u);
  assert.deepEqual(observedEvents, []);
});

test('session closure after a Runtime part records observed admission without claiming continuation', async () => {
  const module = await importRuntimeAgentChat();
  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    text: 'accepted before rotation',
    requestId: 'zhiyu-turn-post-admission-rejection',
    streamTurn: async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', textDelta: 'accepted' };
          throw Object.assign(new Error('session rotated after admission'), {
            reasonCode: 'local-app-access-denied',
            actionHint: 'refresh_local_app_session',
            source: 'runtime',
          });
        },
      },
    }),
  });

  assert.equal(result.actionHint, 'reselect_local_partner');
  assert.equal(result.diagnostics?.turnAdmission, 'observed');
  assert.match(result.message, /Runtime accepted the turn/u);
  assert.doesNotMatch(result.message, /continued the turn/u);
});

test('Zhiyu Runtime Agent chat turn requests carry canonical conversation identity and content', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];

  await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    text: 'make an image',
    requestId: 'zhiyu-turn-test-canonical-request',
    streamTurn: async (request) => {
      captured.push(request);
      return {
        stream: parts([
          {
            type: 'message-sealed',
            envelope: {
              message: {
                messageId: 'runtime-message-canonical-request',
                text: 'image action available',
              },
            },
          },
          { type: 'turn-completed', outputText: 'image action available', finishReason: 'stop' },
        ]),
      };
    },
  });

  assert.deepEqual(captured[0], {
    agentHandle: 'lah_v1_agent_opaque',
    conversationAnchorId: 'conversation-anchor:opaque',
    requestId: 'zhiyu-turn-test-canonical-request',
    threadId: 'runtime-thread:opaque',
    text: 'make an image',
  });
});

test('Zhiyu admitted conversation is the turn authorization gate', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    text: 'send through the admitted conversation surface',
    streamTurn: async () => {
      called = true;
      return {
        stream: parts([
          {
            type: 'message-sealed',
            envelope: {
              message: {
                messageId: 'runtime-message-admitted-conversation',
                text: 'Conversation accepted.',
              },
            },
          },
          { type: 'turn-completed', outputText: 'Conversation accepted.', finishReason: 'stop' },
        ]),
      };
    },
  });

  assert.equal(called, true);
  assert.equal(result.ready, true);
  assert.equal(result.reasonCode, 'runtime-agent-turn-completed');
});

test('Zhiyu Runtime Agent chat fails closed when the direct local-app shell bridge is unavailable', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;

  const result = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady(),
    text: 'must not send without the standard shell bridge',
    conversationClient: {
      async subscribe() {
        called = true;
        throw new Error('conversation client must not be called');
      },
      async send() {
        called = true;
        throw new Error('conversation client must not be called');
      },
    },
  });

  assert.equal(called, false);
  assert.equal(result.ready, false);
  assert.equal(result.reasonCode, 'electron-runtime-bridge-unavailable');
  assert.equal(result.actionHint, 'inspect_runtime_agent_chat_stream');
});

test('Zhiyu uploads one image candidate and sends its artifact ref through the protected conversation', async () => {
  const module = await importRuntimeAgentChat();
  const captured = [];
  const previousWindow = globalThis.window;
  globalThis.window = {};
  globalThis.__nimiZhiyuHasElectronRuntime = true;
  try {
    const result = await module.runZhiyuAgentChatTurn({
      conversation: conversationReady(),
      text: 'with attachment',
      attachment: {
        bytes: Uint8Array.from([1, 2, 3]),
        mimeType: 'image/png',
        displayName: 'photo.png',
      },
      requestId: 'zhiyu-turn-test-attachment',
      conversationClient: localAppConversationClient(captured),
    });
    if (!result.ready) assert.fail(JSON.stringify(result));
    assert.deepEqual(captured.find((entry) => entry.method === 'uploadAttachment')?.input, {
      agentHandle: 'lah_v1_agent_opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      bytes: Uint8Array.from([1, 2, 3]),
      mimeType: 'image/png',
      displayName: 'photo.png',
    });
    assert.deepEqual(captured.find((entry) => entry.method === 'send')?.input.parts, [
      { kind: 'text', text: 'with attachment' },
      { kind: 'artifact-ref', artifactId: 'artifact-uploaded-local-app' },
    ]);
  } finally {
    delete globalThis.__nimiZhiyuHasElectronRuntime;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('Zhiyu Runtime Agent chat fails closed for conversation anchor mismatch', async () => {
  const module = await importRuntimeAgentChat();
  let called = false;
  const streamTurn = async () => {
    called = true;
    throw new Error('streamTurn must not be called');
  };

  const anchorMismatch = await module.runZhiyuAgentChatTurn({
    conversation: conversationReady({ conversationAnchorId: 'conversation-anchor:old' }),
    text: 'anchor mismatch',
    expectedConversationAnchorId: 'conversation-anchor:current',
    streamTurn,
  });
  assert.equal(anchorMismatch.ready, false);
  assert.equal(anchorMismatch.reasonCode, 'zhiyu-conversation-anchor-mismatch');
  assert.equal(called, false);
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
          export function getZhiyuLocalAppClient() {
            if (!globalThis.__nimiZhiyuLocalAppClient) {
              throw new Error('Test must inject the direct local-app client.');
            }
            return globalThis.__nimiZhiyuLocalAppClient;
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
          export function hasElectronRuntime() {
            return globalThis.__nimiZhiyuHasElectronRuntime === true;
          }
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

function localAppConversationClient(captured) {
  return {
    async snapshot() { return { voices: [] }; },
    async uploadAttachment(input) {
      captured.push({ method: 'uploadAttachment', input });
      return { artifactId: 'artifact-uploaded-local-app', expiresAt: '2026-08-23T09:00:00Z' };
    },
    async readArtifact(input) {
      captured.push({ method: 'readArtifact', input });
      return { artifactId: input.artifactId, bytes: Uint8Array.from([1]), mimeType: 'image/png', byteLength: 1 };
    },
    async subscribe(scope) {
      captured.push({ method: 'subscribe', input: scope });
      return {
        async cancel() {
          captured.push({ method: 'cancel' });
        },
        async *[Symbol.asyncIterator]() {
          const base = {
            conversationAnchorId: 'conversation-anchor:opaque',
            turnId: 'runtime-turn-local-app',
          };
          yield { ...base, type: 'turn-accepted', sequence: '1' };
          yield {
            ...base,
            type: 'message-committed',
            sequence: '3',
            message: {
              messageId: 'runtime-message-local-app-user',
              turnId: 'runtime-turn-local-app',
              role: 'user',
              parts: [{ kind: 'text', text: 'Hello' }],
            },
          };
          yield {
            ...base,
            type: 'message-committed',
            sequence: '4',
            message: {
              messageId: 'runtime-message-local-app',
              turnId: 'runtime-turn-local-app',
              role: 'assistant',
              parts: [{ kind: 'text', text: 'Hello' }],
            },
          };
          yield { ...base, type: 'turn-completed', sequence: '6', terminalReason: 'stop' };
        },
      };
    },
    async send(request) {
      captured.push({ method: 'send', input: request });
      return { turnId: 'runtime-turn-local-app' };
    },
    async interruptTurn(request) {
      captured.push({ method: 'interrupt', input: request });
      return { turnId: 'runtime-turn-local-app' };
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
    conversationAnchorId: 'conversation-anchor:opaque',
    threadId: 'runtime-thread:opaque',
    ...overrides,
  };
}
