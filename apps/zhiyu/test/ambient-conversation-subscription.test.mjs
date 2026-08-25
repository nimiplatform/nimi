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

	assert.equal(await reducer.reduce(event('runtime.agent.turn.accepted', {
    conversation_anchor_id: 'conversation-anchor:shared',
    turn_id: runtimeTurnId,
		sequence: '1',
    stream_id: 'agent_stream_shared_1',
    detail: {},
	})), null);

  const committedEvent = event('runtime.agent.turn.message_committed', {
    conversation_anchor_id: 'conversation-anchor:shared',
    turn_id: runtimeTurnId,
		sequence: '2',
    stream_id: 'agent_stream_shared_1',
    message_id: runtimeMessageId,
    detail: { message_id: runtimeMessageId, text: 'Shared committed answer' },
  });
	const committed = await reducer.reduce(committedEvent);
  assert.ok(committed);
	assert.equal(await reducer.reduce(committedEvent), null, 'turn_id/message_id duplicate must be ignored');

  let chat = mergeChatTranscript(perSendChat({ requestId, runtimeTurnId, runtimeMessageId }), committed.chat);
  assert.equal(chat.messageCount, 2);
  assert.deepEqual(chat.messages.map(({ role, text }) => [role, text]), [
    ['user', 'Shared question'],
    ['agent', 'Shared committed answer'],
  ]);

	const completed = await reducer.reduce(event('runtime.agent.turn.completed', {
    conversation_anchor_id: 'conversation-anchor:shared',
    turn_id: runtimeTurnId,
		sequence: '3',
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
	const reduction = await reducer.reduce(event('runtime.agent.turn.message_committed', {
    conversation_anchor_id: 'conversation-anchor:other',
    turn_id: 'agent_turn_other',
		sequence: '1',
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

test('ambient session closure requests fresh hydration without declaring the Runtime turn failed', async () => {
  const { createZhiyuAmbientConversationEventReducer } = await importAmbientModule();
  const reducer = createZhiyuAmbientConversationEventReducer({
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:expected',
  });

  const reduction = reducer.failure(Object.assign(new Error('session rotated'), {
    reasonCode: 'local-app-access-denied',
    actionHint: 'refresh_local_app_session',
    source: 'runtime',
  }));

  assert.equal(reduction.close, true);
  assert.equal(reduction.chat.ready, false);
  assert.equal(reduction.chat.state, 'idle');
  assert.equal(reduction.chat.reasonCode, 'local-app-access-denied');
  assert.equal(reduction.chat.actionHint, 'reselect_local_partner');
});

test('ambient reducer applies only post-snapshot sequence and keeps multimodal events', async () => {
	const { createZhiyuAmbientConversationEventReducer } = await importAmbientModule();
	const initial = perSendChat({ requestId: 'request-1', runtimeTurnId: 'turn-1', runtimeMessageId: 'message-1' });
	const reducer = createZhiyuAmbientConversationEventReducer({
		agentHandle: 'opaque-agent-handle',
		conversationAnchorId: 'conversation-anchor:shared',
	}, () => Date.parse('2026-07-14T01:00:00.000Z'), {
		throughSequence: '5',
		initialChat: initial,
		resolveArtifactUrl: async (artifactId) => `data:application/octet-stream;base64,${artifactId}`,
	});
	assert.equal(await reducer.reduce({
		type: 'turn-completed', conversationAnchorId: 'conversation-anchor:shared', sequence: '5',
		turnId: 'turn-1', terminalReason: 'stop',
	}), null);
	const action = await reducer.reduce({
		type: 'action-started', conversationAnchorId: 'conversation-anchor:shared', sequence: '6', turnId: 'turn-1',
		action: { actionId: 'action-1', turnId: 'turn-1', capabilityContract: 'image.generate', status: 'started', projectionMessageId: null, artifactId: null, reasonCode: null, message: null },
	});
	assert.equal(action?.chat.eventTypes[0], 'action-started');
	const voice = await reducer.reduce({
		type: 'voice-ready', conversationAnchorId: 'conversation-anchor:shared', sequence: '7', turnId: 'turn-1',
		voice: { voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-1', state: 'ready', artifactId: 'voice-artifact-1', reasonCode: null, message: null },
	});
	assert.equal(voice?.chat.messages[0].kind, 'voice');
	assert.equal(voice?.chat.messages[0].metadata.voiceArtifactId, 'voice-artifact-1');
	const actionFailed = await reducer.reduce({
		type: 'action-failed', conversationAnchorId: 'conversation-anchor:shared', sequence: '8', turnId: 'turn-1',
		action: { actionId: 'action-1', turnId: 'turn-1', capabilityContract: 'image.generate', status: 'failed', projectionMessageId: null, artifactId: null, reasonCode: 'AI_PROVIDER_UNAVAILABLE', message: 'Image provider unavailable.' },
	});
	assert.equal(actionFailed?.chat.actions[0].status, 'failed');
	const completed = await reducer.reduce({
		type: 'turn-completed', conversationAnchorId: 'conversation-anchor:shared', sequence: '9', turnId: 'turn-1', terminalReason: 'stop',
	});
	assert.equal(completed?.chat.state, 'completed');
	assert.equal(completed?.chat.actions[0].status, 'failed');
	assert.equal(completed?.chat.actions[0].reasonCode, 'AI_PROVIDER_UNAVAILABLE');
});

test('ambient reducer scopes repeated action ids to their Runtime turn', async () => {
	const { createZhiyuAmbientConversationEventReducer } = await importAmbientModule();
	const reducer = createZhiyuAmbientConversationEventReducer({
		agentHandle: 'opaque-agent-handle',
		conversationAnchorId: 'conversation-anchor:shared',
	});
	await reducer.reduce({
		type: 'action-failed', conversationAnchorId: 'conversation-anchor:shared', sequence: '1', turnId: 'turn-1',
		action: { actionId: 'action-0', turnId: 'turn-1', capabilityContract: 'image.generate', status: 'failed', projectionMessageId: null, artifactId: null, reasonCode: 'FIRST_FAILURE', message: 'First failure.' },
	});
	const second = await reducer.reduce({
		type: 'action-failed', conversationAnchorId: 'conversation-anchor:shared', sequence: '2', turnId: 'turn-2',
		action: { actionId: 'action-0', turnId: 'turn-2', capabilityContract: 'image.generate', status: 'failed', projectionMessageId: null, artifactId: null, reasonCode: 'SECOND_FAILURE', message: 'Second failure.' },
	});

	assert.deepEqual(
		second?.chat.actions.map(({ turnId, actionId, reasonCode }) => ({ turnId, actionId, reasonCode })),
		[
			{ turnId: 'turn-1', actionId: 'action-0', reasonCode: 'FIRST_FAILURE' },
			{ turnId: 'turn-2', actionId: 'action-0', reasonCode: 'SECOND_FAILURE' },
		],
	);
});

test('ambient synchronization subscribes before snapshot and replays only above high-water', async () => {
	const { subscribeZhiyuAmbientConversation } = await importAmbientModule();
	let subscribed = false;
	let canceled = false;
	const updates = [];
	let resolveFresh;
	const fresh = new Promise((resolve) => { resolveFresh = resolve; });
	const cleanup = subscribeZhiyuAmbientConversation({
		conversation: {
			async subscribe() {
				subscribed = true;
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: 'turn-failed', conversationAnchorId: 'conversation-anchor:shared', sequence: '5', turnId: 'turn-1', reasonCode: 'STALE', message: null };
						yield { type: 'turn-completed', conversationAnchorId: 'conversation-anchor:shared', sequence: '6', turnId: 'turn-1', terminalReason: 'stop' };
					},
					async cancel() { canceled = true; },
				};
			},
		},
		identity: { agentHandle: 'opaque-agent-handle', conversationAnchorId: 'conversation-anchor:shared' },
		async hydrate() {
			assert.equal(subscribed, true, 'subscription must be established before snapshot hydration');
			return { ...perSendChat({ requestId: 'request-1', runtimeTurnId: 'turn-1', runtimeMessageId: 'message-1' }), diagnostics: { throughSequence: '5' } };
		},
		onChat(chat) {
			updates.push(chat);
			if (chat.eventTypes.includes('turn-completed')) resolveFresh();
		},
	});
	await fresh;
	cleanup();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(updates.some((chat) => chat.reasonCode === 'STALE'), false);
	assert.equal(updates.at(-1).state, 'completed');
	assert.equal(canceled, true);
});

test('ambient synchronization replaces subscription once after exact retryable overflow', async () => {
	const { subscribeZhiyuAmbientConversation } = await importAmbientModule();
	let subscribeCalls = 0;
	let hydrateCalls = 0;
	let cancelCalls = 0;
	let resolveCompleted;
	const completed = new Promise((resolve) => { resolveCompleted = resolve; });
	const cleanup = subscribeZhiyuAmbientConversation({
		conversation: {
			async subscribe() {
				subscribeCalls += 1;
				const attempt = subscribeCalls;
				return {
					async *[Symbol.asyncIterator]() {
						if (attempt === 1) {
							throw Object.assign(new Error('conversation overflow'), {
								reasonCode: 'local-app-owner-unavailable',
								details: { retryable: true, reasonMetadata: { diagnostic_stage: 'local_app_conversation_subscription_overflow' } },
							});
						}
						yield { type: 'turn-completed', conversationAnchorId: 'conversation-anchor:shared', sequence: '7', turnId: 'turn-1', terminalReason: 'stop' };
					},
					async cancel() { cancelCalls += 1; },
				};
			},
		},
		identity: { agentHandle: 'opaque-agent-handle', conversationAnchorId: 'conversation-anchor:shared' },
		async hydrate() {
			hydrateCalls += 1;
			return {
				...perSendChat({ requestId: 'request-1', runtimeTurnId: 'turn-1', runtimeMessageId: 'message-1' }),
				diagnostics: { throughSequence: hydrateCalls === 1 ? '5' : '6' },
			};
		},
		onChat(chat) {
			if (chat.eventTypes.includes('turn-completed')) resolveCompleted();
		},
	});
	await completed;
	cleanup();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(subscribeCalls, 2);
	assert.equal(hydrateCalls, 2);
	assert.equal(cancelCalls, 2);
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
		sequence: payload.sequence ?? '1',
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
		actions: [],
    latestAssistantText: 'Shared committed answer',
    reasoningText: null,
    outputText: 'Shared committed answer',
    diagnostics: null,
  };
}
