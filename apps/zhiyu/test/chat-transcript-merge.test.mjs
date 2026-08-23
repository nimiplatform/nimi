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

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('appends the submitted user message from the protected local-app Agent handle', async () => {
  const { appendSubmittedUserMessage } = await importTransitionsModule();
  const current = chatStatus({
    requestId: null,
    ready: true,
    state: 'completed',
    messages: [],
  });
  const appended = appendSubmittedUserMessage(current, {
    ready: true,
    agentHandle: 'opaque-owner-agent-handle',
    conversationAnchorId: 'agent-anchor-1',
    threadId: 'runtime-thread-1',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
  }, 'zhiyu-turn-local-app-1', 'new local-app question', '2026-07-31T04:40:33.000Z');

  assert.equal(appended.messageCount, 1);
  assert.deepEqual(
    appended.messages.map(({ role, text, targetId }) => ({ role, text, targetId })),
    [{
      role: 'user',
      text: 'new local-app question',
      targetId: 'opaque-owner-agent-handle',
    }],
  );
  assert.equal(appended.messages[0]?.metadata?.localAgentRef, undefined);
});

test('merges the streamed and committed primary assistant for one Runtime turn', async () => {
  const { mergeChatTranscript, turnStatusFromChat } = await importTransitionsModule();
  const turnId = 'zhiyu-turn-1';
  const current = chatStatus({
    requestId: turnId,
    messages: [
      message({ id: `${turnId}:user`, role: 'user', text: 'question', turnId }),
      message({
        id: `${turnId}:assistant`,
        role: 'agent',
        text: 'partial',
        turnId,
        status: 'streaming',
        kind: 'streaming',
      }),
    ],
  });
  const incoming = chatStatus({
    requestId: turnId,
    ready: true,
    state: 'completed',
    messages: [
      message({ id: `${turnId}:user`, role: 'user', text: 'question', turnId }),
      message({ id: 'runtime-message-1', role: 'agent', text: 'final answer', turnId }),
    ],
  });

  const merged = mergeChatTranscript(current, incoming);

  assert.equal(merged.messageCount, 2);
  assert.deepEqual(merged.messages.map(({ role, text }) => [role, text]), [
    ['user', 'question'],
    ['agent', 'final answer'],
  ]);
  assert.equal(merged.messages[1]?.id, `${turnId}:assistant`);
  assert.equal(merged.messages[1]?.metadata?.zhiyuOriginalMessageId, 'runtime-message-1');
  assert.equal(merged.messages[1]?.status, 'complete');
  assert.equal(turnStatusFromChat(merged).messageId, 'runtime-message-1');
});

test('does not merge equal assistant text from different Runtime turns', async () => {
  const { mergeChatTranscript } = await importTransitionsModule();
  const current = chatStatus({
    requestId: 'zhiyu-turn-1',
    messages: [
      message({ id: 'turn-1:user', role: 'user', text: 'first', turnId: 'zhiyu-turn-1' }),
      message({ id: 'runtime-message-1', role: 'agent', text: 'same answer', turnId: 'zhiyu-turn-1' }),
    ],
  });
  const incoming = chatStatus({
    requestId: 'zhiyu-turn-2',
    messages: [
      message({ id: 'turn-2:user', role: 'user', text: 'second', turnId: 'zhiyu-turn-2' }),
      message({ id: 'runtime-message-2', role: 'agent', text: 'same answer', turnId: 'zhiyu-turn-2' }),
    ],
  });

  const merged = mergeChatTranscript(current, incoming);

  assert.equal(merged.messageCount, 4);
  assert.deepEqual(merged.messages.filter(({ role }) => role === 'agent').map(({ id }) => id), [
    'runtime-message-1',
    'runtime-message-2',
  ]);
});

async function importTransitionsModule() {
  const outputPath = path.join(await buildTransitionsModule(), 'app-evidence-transitions.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildTransitionsModule() {
  if (buildDir) return buildDir;
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-chat-transcript-merge-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/app/app-evidence-transitions.ts')],
    outfile: path.join(buildDir, 'app-evidence-transitions.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  });
  return buildDir;
}

function chatStatus({ requestId, messages, ready = false, state = 'streaming' }) {
  return {
    transport: 'electron-ipc',
    ready,
    state,
    reasonCode: ready ? 'runtime-agent-turn-completed' : 'runtime-agent-turn-streaming',
    actionHint: ready ? 'review_runtime_agent_chat_message' : 'inspect_runtime_agent_chat_stream',
    source: 'runtime',
    message: ready ? 'Runtime Agent turn completed.' : 'Runtime Agent turn is streaming.',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:1',
    localAgentRef: 'local-agent:1',
    conversationAnchorId: 'agent-anchor-1',
    requestId,
    runtimeTurnId: 'runtime-turn-1',
    runtimeStreamId: 'runtime-stream-1',
    eventTypes: [],
    messageCount: messages.length,
    messages,
		actions: [],
    latestAssistantText: messages.findLast(({ role }) => role === 'agent')?.text ?? null,
    reasoningText: null,
    outputText: null,
    diagnostics: null,
  };
}

function message({ id, role, text, turnId, status = 'complete', kind = 'text' }) {
  return {
    id,
    sessionId: 'agent-anchor-1',
    targetId: 'local-agent:1',
    source: 'agent',
    role,
    text,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:01.000Z',
    status,
    kind,
    senderName: role === 'user' ? 'You' : 'Zhiyu Agent',
    senderKind: role === 'user' ? 'human' : 'agent',
    metadata: {
      transport: 'runtime.agent.turns',
      turnId,
      conversationAnchorId: 'agent-anchor-1',
      localAgentRef: 'local-agent:1',
    },
  };
}
