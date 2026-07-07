import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runNimiRuntimeAgentTurn,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentTurnsModule,
} from './index';

function structuredPayload(messageId: string, text: string): Record<string, unknown> {
  return {
    message: {
      message_id: messageId,
      text,
    },
    actions: [],
  };
}

test('Runtime Agent turn runner filters backlog and seals committed message', async () => {
  const requestIds: string[] = [];
  let snapshotQueryCount = 0;
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
        yield {
          eventName: 'runtime.agent.turn.accepted',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'backlog-turn',
          streamId: 'backlog-stream',
          detail: { requestId: 'backlog-request' },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.text_delta',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'backlog-turn',
          streamId: 'backlog-stream',
          detail: { text: 'backlog' },
        } as NimiRuntimeAgentConsumeEvent;
        while (!requestIds[0]) {
          await Promise.resolve();
        }
        yield {
          eventName: 'runtime.agent.turn.accepted',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: { requestId: requestIds[0] },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.structured',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: {
            payload: structuredPayload('assistant-message', 'runner complete'),
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.message_committed',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: {
            messageId: 'assistant-message',
            text: 'runner complete',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.completed',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: { terminalReason: 'stop' },
        } as NimiRuntimeAgentConsumeEvent;
      })();
    },
    async request(request) {
      requestIds.push(request.requestId || '');
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      snapshotQueryCount += 1;
      return {};
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'hello' }],
    },
    route: 'runtime-owned',
    modelId: 'runtime-owned',
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  assert.deepEqual(parts.map((part) => part.type), ['message-sealed', 'turn-completed']);
  assert.equal(parts.some((part) => part.type === 'text-delta' && part.textDelta === 'backlog'), false);
  assert.equal(parts.find((part) => part.type === 'message-sealed')?.envelope.message.messageId, 'assistant-message');
  assert.equal(parts.find((part) => part.type === 'turn-completed')?.outputText, 'runner complete');
  assert.equal(snapshotQueryCount, 0);
});

test('Runtime Agent turn runner recovers terminal snapshot after subscription closes', async () => {
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {})();
    },
    async request() {
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      return {
        requestId: 'request',
        lastTurn: {
          turnId: 'turn',
          streamId: 'stream',
          status: 'completed',
          messageId: 'assistant-message',
          text: 'recovered',
          finishReason: 'stop',
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          structured: structuredPayload('assistant-message', 'recovered'),
        },
      };
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  assert.deepEqual(parts.map((part) => part.type), ['message-sealed', 'turn-completed']);
  assert.equal(parts.find((part) => part.type === 'turn-completed')?.outputText, 'recovered');
});

test('Runtime Agent turn runner recovers terminal snapshot after active-turn snapshot bind', async () => {
  let snapshotQueryCount = 0;
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {})();
    },
    async request() {
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      snapshotQueryCount += 1;
      if (snapshotQueryCount === 1) {
        return {
          requestId: 'request',
          activeTurn: {
            turnId: 'turn',
            streamId: 'stream',
            status: 'accepted',
            updatedAt: new Date(Date.now()).toISOString(),
          },
        };
      }
      return {
        requestId: 'request',
        lastTurn: {
          turnId: 'turn',
          streamId: 'stream',
          status: 'completed',
          messageId: 'assistant-message',
          text: 'active-bound recovered',
          finishReason: 'stop',
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          structured: structuredPayload('assistant-message', 'active-bound recovered'),
        },
      };
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'hello' }],
    },
    stallRecoveryIntervalMs: 1,
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  assert.deepEqual(parts.map((part) => part.type), ['message-sealed', 'turn-completed']);
  assert.equal(parts.find((part) => part.type === 'turn-completed')?.outputText, 'active-bound recovered');
});

test('Runtime Agent turn runner projects Runtime action artifact events', async () => {
  const requestIds: string[] = [];
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
        while (!requestIds[0]) {
          await Promise.resolve();
        }
        const base = {
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
        };
        yield {
          eventName: 'runtime.agent.turn.accepted',
          ...base,
          detail: { requestId: requestIds[0] },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.structured',
          ...base,
          detail: {
            payload: structuredPayload('assistant-message', 'creating image'),
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.message_committed',
          ...base,
          detail: {
            messageId: 'assistant-message',
            text: 'creating image',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.action_planned',
          ...base,
          detail: {
            actionId: 'action-image-1',
            projectionMessageId: 'projection-message-1',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.action_started',
          ...base,
          detail: {
            actionId: 'action-image-1',
            projectionMessageId: 'projection-message-1',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.artifact_ready',
          ...base,
          detail: {
            actionId: 'action-image-1',
            projectionMessageId: 'projection-message-1',
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.action_completed',
          ...base,
          detail: {
            actionId: 'action-image-1',
            projectionMessageId: 'projection-message-1',
            artifactId: 'artifact-image-1',
            mimeType: 'image/png',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.completed',
          ...base,
          detail: { terminalReason: 'stop' },
        } as NimiRuntimeAgentConsumeEvent;
      })();
    },
    async request(request) {
      requestIds.push(request.requestId || '');
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      return {};
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'make an image' }],
    },
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  assert.deepEqual(parts.map((part) => part.type), [
    'message-sealed',
    'beat-planned',
    'beat-delivery-started',
    'artifact-ready',
    'beat-delivered',
    'turn-completed',
  ]);
  const artifact = parts.find((part) => part.type === 'artifact-ready');
  assert.equal(artifact?.artifactId, 'artifact-image-1');
  assert.equal(artifact?.mimeType, 'image/png');
  assert.equal(artifact?.projectionMessageId, 'projection-message-1');
});

test('Runtime Agent turn runner preserves voice terminal projection diagnostics', async () => {
  const requestIds: string[] = [];
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
        while (!requestIds[0]) {
          await Promise.resolve();
        }
        const base = {
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
        };
        yield {
          eventName: 'runtime.agent.turn.accepted',
          ...base,
          detail: { requestId: requestIds[0] },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.structured',
          ...base,
          detail: {
            payload: structuredPayload('assistant-message', 'voice complete'),
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.message_committed',
          ...base,
          detail: {
            messageId: 'assistant-message',
            text: 'voice complete',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.presentation.voice_stream_chunk_available',
          ...base,
          detail: {
            voiceStreamId: 'voice-stream-1',
            chunkTransportRef: 'runtime-agent-voice-stream://voice-stream-1/chunks/000001',
            audioMimeType: 'audio/wav',
            finalChunk: false,
            voiceOutputMode: 'native_stream',
            voicePlaybackState: 'active',
            playbackTarget: 'avatar_autoplay',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.presentation.voice_playback_requested',
          ...base,
          detail: {
            voiceStreamId: 'voice-stream-1',
            audioArtifactId: 'artifact-final-1',
            audioMimeType: 'audio/wav',
            finalArtifact: true,
            voiceOutputMode: 'native_stream',
            voicePlaybackState: 'active',
            playbackTarget: 'avatar_autoplay',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.presentation.voice_playback_terminal',
          ...base,
          detail: {
            voiceStreamId: 'voice-stream-1',
            finalArtifactId: 'artifact-final-1',
            audioMimeType: 'audio/wav',
            terminalReason: 'native_stream_completed',
            voiceOutputMode: 'native_stream',
            voicePlaybackState: 'completed',
            playbackTarget: 'avatar_autoplay',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.completed',
          ...base,
          detail: { terminalReason: 'stop' },
        } as NimiRuntimeAgentConsumeEvent;
      })();
    },
    async request(request) {
      requestIds.push(request.requestId || '');
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      return {};
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'speak' }],
    },
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  const completed = parts.find((part) => part.type === 'turn-completed');
  const projectionEvents = completed?.diagnostics.runtimeProjectionEvents ?? [];
  assert.deepEqual(projectionEvents.map((event) => event.eventName), [
    'runtime.agent.presentation.voice_stream_chunk_available',
    'runtime.agent.presentation.voice_playback_requested',
    'runtime.agent.presentation.voice_playback_terminal',
  ]);
  assert.equal(projectionEvents.at(-1)?.detail.voicePlaybackState, 'completed');
  assert.equal(projectionEvents.at(-1)?.detail.terminalReason, 'native_stream_completed');
});

test('Runtime Agent turn runner omits caller route and model diagnostics', async () => {
  const requestIds: string[] = [];
  const logDetails: Record<string, unknown>[] = [];
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
        while (!requestIds[0]) {
          await Promise.resolve();
        }
        const base = {
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
        };
        yield {
          eventName: 'runtime.agent.turn.accepted',
          ...base,
          detail: { requestId: requestIds[0] },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.structured',
          ...base,
          detail: {
            payload: structuredPayload('assistant-message', 'diagnostics complete'),
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.message_committed',
          ...base,
          detail: {
            messageId: 'assistant-message',
            text: 'diagnostics complete',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.completed',
          ...base,
          detail: { terminalReason: 'stop' },
        } as NimiRuntimeAgentConsumeEvent;
      })();
    },
    async request(request) {
      requestIds.push(request.requestId || '');
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      return {};
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      runtimeSourceRef: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'hello' }],
    },
    route: 'app-local-route',
    modelId: 'app-local-model',
    connectorId: 'app-local-connector',
    resolveTrace: () => ({
      traceId: 'trace-runtime-1',
      modelResolved: 'app-local-trace-model',
      routeDecision: 'app-local-trace-route',
    }),
    logEvent: (event) => {
      logDetails.push(event.details as Record<string, unknown>);
    },
    logTiming: (event) => {
      logDetails.push(event.details as Record<string, unknown>);
    },
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }

  const completed = parts.find((part) => part.type === 'turn-completed');
  assert.equal(completed?.diagnostics.traceId, 'trace-runtime-1');
  for (const field of ['route', 'modelId', 'connectorId', 'modelResolved', 'routeDecision']) {
    assert.equal(field in (completed?.diagnostics ?? {}), false, `${field} must not be app-supplied diagnostics truth`);
  }
  for (const details of logDetails) {
    for (const field of ['route', 'modelId', 'connectorId']) {
      assert.equal(field in details, false, `${field} must not be logged from caller input`);
    }
  }
});
