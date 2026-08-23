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

test('production conversation hydration maps the bounded local App snapshot', async () => {
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
        throughSequence: '8',
        turns: [{
          turnId: 'agent-turn-1', status: 'completed', phase: null,
          terminalReason: 'stop', reasonCode: null, message: null,
        }],
        messages: [
          {
            messageId: 'runtime-message-user-1', turnId: 'agent-turn-1', role: 'user',
            parts: [{ kind: 'text', text: 'Shared question' }],
          },
          {
            messageId: 'runtime-message-assistant-1', turnId: 'agent-turn-1', role: 'assistant',
            parts: [{ kind: 'text', text: 'Shared answer from Desktop' }],
          },
        ],
        actions: [],
        voices: [],
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
        throughSequence: '0',
        turns: [],
        messages: [],
        actions: [],
        voices: [],
        truncatedBefore: false,
      };
    },
  });

  assert.equal(hydrated.chat.ready, true);
  assert.equal(hydrated.chat.messageCount, 0);
  assert.deepEqual(hydrated.chat.messages, []);
});

test('production conversation hydration preserves active and terminal failure truth', async () => {
	const { hydrateZhiyuProductionConversation } = await importHydrationModule();
	for (const [status, state, ready] of [
		['active', 'streaming', false],
		['failed', 'failed', false],
		['interrupted', 'canceled', false],
	]) {
		const hydrated = await hydrateZhiyuProductionConversation({
			agentHandle: 'opaque-agent-handle', conversationAnchorId: 'conversation-anchor:shared',
			currentChat: idleChat(), currentSource: blockedSource(),
		}, {
			async snapshot() {
				return {
					conversationAnchorId: 'conversation-anchor:shared', throughSequence: '4',
					turns: [{ turnId: 'turn-state', status, phase: status === 'active' ? 'started' : null, terminalReason: null, reasonCode: status === 'failed' ? 'AI_PROVIDER_TIMEOUT' : null, message: null }],
					messages: [], actions: [], voices: [], truncatedBefore: false,
				};
			},
		});
		assert.equal(hydrated.chat.state, state);
		assert.equal(hydrated.chat.ready, ready);
		assert.equal(hydrated.chat.runtimeTurnId, 'turn-state');
	}
});

test('production conversation hydration preserves failed image action beside completed text turn', async () => {
	const { hydrateZhiyuProductionConversation } = await importHydrationModule();
	const hydrated = await hydrateZhiyuProductionConversation({
		agentHandle: 'opaque-agent-handle', conversationAnchorId: 'conversation-anchor:shared',
		currentChat: idleChat(), currentSource: blockedSource(),
	}, {
		async snapshot() {
			return {
				conversationAnchorId: 'conversation-anchor:shared', throughSequence: '12',
				turns: [{ turnId: 'turn-action-failed', status: 'completed', phase: null, terminalReason: 'stop', reasonCode: null, message: null }],
				messages: [{ messageId: 'assistant-action-failed', turnId: 'turn-action-failed', role: 'assistant', parts: [{ kind: 'text', text: 'Text reply remains.' }] }],
				actions: [{ actionId: 'action-failed-1', turnId: 'turn-action-failed', capabilityContract: 'image.generate', status: 'failed', projectionMessageId: null, artifactId: null, reasonCode: 'AI_PROVIDER_UNAVAILABLE', message: 'Image provider unavailable.' }],
				voices: [], truncatedBefore: false,
			};
		},
	});
	assert.equal(hydrated.chat.state, 'completed');
	assert.equal(hydrated.chat.messages[0].text, 'Text reply remains.');
	assert.deepEqual(hydrated.chat.actions, [{
		actionId: 'action-failed-1', turnId: 'turn-action-failed', capabilityContract: 'image.generate',
		status: 'failed', reasonCode: 'AI_PROVIDER_UNAVAILABLE', message: 'Image provider unavailable.',
	}]);
});

test('production conversation hydration resolves a final voice sidecar without an audio message part', async () => {
  const { hydrateZhiyuProductionConversation } = await importHydrationModule();
  const hydrated = await hydrateZhiyuProductionConversation({
    agentHandle: 'opaque-agent-handle',
    conversationAnchorId: 'conversation-anchor:shared',
    currentChat: idleChat(),
    currentSource: blockedSource(),
  }, {
    async snapshot() {
      return {
        conversationAnchorId: 'conversation-anchor:shared', throughSequence: '9',
        turns: [{
          turnId: 'agent-turn-voice', status: 'completed', phase: null,
          terminalReason: 'stop', reasonCode: null, message: null,
        }],
        messages: [{
          messageId: 'assistant-message-voice', turnId: 'agent-turn-voice', role: 'assistant',
          parts: [{ kind: 'text', text: 'Spoken answer' }],
        }],
        actions: [],
        voices: [{
          voiceId: 'voice-1', turnId: 'agent-turn-voice', messageId: 'assistant-message-voice',
          state: 'ready', artifactId: 'artifact-voice-1', reasonCode: null, message: null,
        }],
        truncatedBefore: false,
      };
    },
    async readArtifact(input) {
      assert.equal(input.artifactId, 'artifact-voice-1');
      return { artifactId: input.artifactId, bytes: Uint8Array.from([1, 2, 3]), mimeType: 'audio/wav', byteLength: 3 };
    },
  });
  assert.equal(hydrated.chat.messages[0].kind, 'voice');
  assert.equal(hydrated.chat.messages[0].metadata.voiceTranscript, 'Spoken answer');
  assert.match(hydrated.chat.messages[0].metadata.voiceUrl, /^data:audio\/wav;base64,/u);
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
