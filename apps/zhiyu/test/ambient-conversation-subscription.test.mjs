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

test('ambient committed and terminal events merge once with the per-send transcript', async () => {
  const [{ createZhiyuAmbientConversationEventReducer }, { mergeChatTranscript }] = await Promise.all([
    importAmbientModule(),
    importTransitionsModule(),
  ]);
  const reducer = createZhiyuAmbientConversationEventReducer({
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:shared',
  }, () => Date.parse('2026-07-14T01:00:00.000Z'));
  const runtimeTurnId = 'agent_turn_shared_1';
  const runtimeMessageId = 'runtime-message-shared-1';
  const requestId = 'zhiyu-turn-request-1';

  assert.equal(reducer.reduce(event('runtime.agent.turn.accepted', {
    conversation_anchor_id: 'conversation-anchor:shared',
    turn_id: runtimeTurnId,
    stream_id: 'agent_stream_shared_1',
    detail: {},
  })), null);

  const committedEvent = event('runtime.agent.turn.message_committed', {
    conversation_anchor_id: 'conversation-anchor:shared',
    turn_id: runtimeTurnId,
    stream_id: 'agent_stream_shared_1',
    message_id: runtimeMessageId,
    detail: { message_id: runtimeMessageId, text: 'Shared committed answer' },
  });
  const committed = reducer.reduce(committedEvent);
  assert.ok(committed);
  assert.equal(reducer.reduce(committedEvent), null, 'turn_id/message_id duplicate must be ignored');

  let chat = mergeChatTranscript(perSendChat({ requestId, runtimeTurnId, runtimeMessageId }), committed.chat);
  assert.equal(chat.messageCount, 2);
  assert.deepEqual(chat.messages.map(({ role, text }) => [role, text]), [
    ['user', 'Shared question'],
    ['agent', 'Shared committed answer'],
  ]);

  const completed = reducer.reduce(event('runtime.agent.turn.completed', {
    conversation_anchor_id: 'conversation-anchor:shared',
    turn_id: runtimeTurnId,
    stream_id: 'agent_stream_shared_1',
    detail: { terminal_reason: 'stop' },
  }));
  assert.ok(completed);
  chat = mergeChatTranscript(chat, completed.chat);
  assert.equal(chat.state, 'completed');
  assert.equal(chat.messageCount, 2);
  assert.equal(chat.runtimeTurnId, runtimeTurnId);
  assert.equal(chat.runtimeStreamId, 'agent_stream_shared_1');
});

test('ambient conversation reducer fails closed on an anchor mismatch', async () => {
  const { createZhiyuAmbientConversationEventReducer } = await importAmbientModule();
  const reducer = createZhiyuAmbientConversationEventReducer({
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:expected',
  });
  const reduction = reducer.reduce(event('runtime.agent.turn.message_committed', {
    conversation_anchor_id: 'conversation-anchor:other',
    turn_id: 'agent_turn_other',
    stream_id: 'agent_stream_other',
    message_id: 'message-other',
    detail: { message_id: 'message-other', text: 'must not apply' },
  }));

  assert.ok(reduction);
  assert.equal(reduction.close, true);
  assert.equal(reduction.chat.ready, false);
  assert.equal(reduction.chat.state, 'failed');
  assert.equal(reduction.chat.reasonCode, 'zhiyu-conversation-anchor-mismatch');
  assert.deepEqual(reduction.chat.messages, []);
});

async function importAmbientModule() {
  const outputPath = path.join(await buildModules(), 'ambient-conversation-subscription.js');
  return import(pathToFileURL(outputPath).href);
}

async function importTransitionsModule() {
  const outputPath = path.join(await buildModules(), 'app-evidence-transitions.js');
  return import(pathToFileURL(outputPath).href);
}

async function buildModules() {
  buildPromise ??= (async () => {
    buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-ambient-conversation-'));
    await build({
      entryPoints: {
        'ambient-conversation-subscription': path.join(root, 'src/shell/agent-chat/ambient-conversation-subscription.ts'),
        'app-evidence-transitions': path.join(root, 'src/shell/app/app-evidence-transitions.ts'),
      },
      outdir: buildDir,
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

function event(messageType, payload) {
  const base = {
    conversationAnchorId: payload.conversation_anchor_id,
    sequence: '1',
    turnId: payload.turn_id,
  };
  switch (messageType) {
    case 'runtime.agent.turn.accepted':
      return { ...base, type: 'turn-accepted' };
    case 'runtime.agent.turn.message_committed':
      return {
        ...base,
        type: 'message-committed',
        message: {
          messageId: payload.detail.message_id,
          turnId: payload.turn_id,
          role: 'assistant',
          parts: [{ kind: 'text', text: payload.detail.text }],
        },
      };
    case 'runtime.agent.turn.completed':
      return { ...base, type: 'turn-completed', terminalReason: payload.detail.terminal_reason };
    default:
      throw new Error(`unsupported fixture event ${messageType}`);
  }
}

function perSendChat({ requestId, runtimeTurnId, runtimeMessageId }) {
  const message = (overrides) => ({
    id: 'message-id',
    sessionId: 'conversation-anchor:shared',
    targetId: 'opaque-agent-handle',
    source: 'agent',
    role: 'agent',
    text: 'message text',
    createdAt: '2026-07-14T01:00:00.000Z',
    updatedAt: '2026-07-14T01:00:00.000Z',
    status: 'complete',
    kind: 'text',
    senderName: 'Zhiyu Agent',
    senderKind: 'agent',
    metadata: {
      turnId: requestId,
      runtimeTurnId,
      conversationAnchorId: 'conversation-anchor:shared',
    },
    ...overrides,
  });
  const messages = [
    message({ id: `${requestId}:user`, role: 'user', text: 'Shared question', senderName: 'You', senderKind: 'human' }),
    message({ id: runtimeMessageId, text: 'Shared committed answer' }),
  ];
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'streaming',
    reasonCode: 'runtime-agent-turn-streaming',
    actionHint: 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: 'Runtime Agent turn is streaming.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: 'conversation-anchor:shared',
    requestId,
    runtimeTurnId,
    runtimeStreamId: 'agent_stream_shared_1',
    eventTypes: [],
    messageCount: messages.length,
    messages,
    latestAssistantText: 'Shared committed answer',
    reasoningText: null,
    outputText: 'Shared committed answer',
    diagnostics: null,
  };
}
