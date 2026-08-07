import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;
let buildPromise = null;

test.after(async () => {
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
});

test('production conversation hydration maps the bounded text-only local App snapshot', async () => {
  const { hydrateZhiyuProductionConversation } = await importHydrationModule();
  const calls = [];
  const currentSource = blockedSource();
  const hydrated = await hydrateZhiyuProductionConversation({
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:shared',
    currentChat: idleChat(),
    currentSource,
  }, {
    async snapshot(input) {
      calls.push(input);
      return {
        conversationAnchorId: 'conversation-anchor:shared',
        activeTurnId: null,
        messages: [
          { turnId: 'agent-turn-1', role: 'user', text: 'Shared question' },
          { turnId: 'agent-turn-1', role: 'assistant', text: 'Shared answer from Desktop' },
        ],
        truncatedBefore: false,
      };
    },
  });

  assert.deepEqual(calls, [{
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:shared',
  }]);
  assert.equal(hydrated.source, currentSource);
  assert.equal(hydrated.chat.reasonCode, 'runtime-agent-conversation-snapshot-hydrated');
  assert.equal(hydrated.chat.messageCount, 2);
  assert.deepEqual(hydrated.chat.messages.map(({ role, text, targetId, kind }) => ({ role, text, targetId, kind })), [
    { role: 'user', text: 'Shared question', targetId: 'opaque-agent-handle', kind: 'text' },
    { role: 'agent', text: 'Shared answer from Desktop', targetId: 'opaque-agent-handle', kind: 'text' },
  ]);
  assert.equal(hydrated.chat.ownerUserId, null);
  assert.equal(hydrated.chat.runtimeSourceRef, null);
  assert.equal(hydrated.chat.localAgentRef, null);
});

test('production conversation hydration returns typed failure without fabricated messages', async () => {
  const { hydrateZhiyuProductionConversation } = await importHydrationModule();
  const currentChat = idleChat();
  const hydrated = await hydrateZhiyuProductionConversation({
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:shared',
    currentChat,
    currentSource: blockedSource(),
  }, {
    async snapshot() {
      throw Object.assign(new Error('snapshot denied'), {
        reasonCode: 'runtime-permission-denied',
        actionHint: 'request_agents_interact_permission',
        source: 'runtime',
      });
    },
  });

  assert.equal(hydrated.chat.ready, false);
  assert.equal(hydrated.chat.state, 'failed');
  assert.equal(hydrated.chat.reasonCode, 'runtime-permission-denied');
  assert.equal(hydrated.chat.actionHint, 'request_agents_interact_permission');
  assert.equal(hydrated.chat.conversationAnchorId, 'conversation-anchor:shared');
  assert.deepEqual(hydrated.chat.messages, currentChat.messages);
});

test('production conversation hydration accepts an empty bounded snapshot without inventing messages', async () => {
  const { hydrateZhiyuProductionConversation } = await importHydrationModule();
  const hydrated = await hydrateZhiyuProductionConversation({
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:shared',
    currentChat: idleChat(),
    currentSource: blockedSource(),
  }, {
    async snapshot() {
      return {
        conversationAnchorId: 'conversation-anchor:shared',
        activeTurnId: null,
        messages: [],
        truncatedBefore: false,
      };
    },
  });

  assert.equal(hydrated.chat.ready, true);
  assert.equal(hydrated.chat.messageCount, 0);
  assert.deepEqual(hydrated.chat.messages, []);
});

async function importHydrationModule() {
  const outputPath = path.join(await buildHydrationModule(), 'conversation-hydration.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildHydrationModule() {
  buildPromise ??= (async () => {
    buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-production-hydration-'));
    await build({
      entryPoints: [path.join(root, 'src/production/conversation-hydration.ts')],
      outfile: path.join(buildDir, 'conversation-hydration.mjs'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'es2022',
      sourcemap: false,
      logLevel: 'silent',
    });
    return buildDir;
  })();
  return buildPromise;
}

function idleChat() {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'idle',
    reasonCode: 'runtime-agent-chat-idle',
    actionHint: 'send_runtime_agent_turn',
    source: 'renderer',
    message: 'Runtime Agent chat has not started.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: null,
    requestId: null,
    runtimeTurnId: null,
    runtimeStreamId: null,
    eventTypes: [],
    messageCount: 0,
    messages: [],
    latestAssistantText: null,
    reasoningText: null,
    outputText: null,
    diagnostics: null,
  };
}

function blockedSource() {
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: 'not-probed',
    actionHint: 'await_admitted_runtime_source_projection',
    source: 'renderer',
    message: 'Runtime source projection has not been probed.',
    ownerUserId: null,
    runtimeSourceRef: null,
    sourceRef: null,
    projectionState: 'unknown',
    sourceContextStatus: null,
    turnContextSummary: null,
  };
}
