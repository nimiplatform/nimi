import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AiRealtimeAudioCodec,
  AiRealtimeOutputTrackLifecycle,
  AiRealtimeSpeechState,
  AiRealtimeTurnDetectionMode,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai_realtime.js';
import { ReasonCode } from '../../core-generated/runtime-protobuf/runtime/v1/common.js';
import {
  RealtimeAdapterKind,
  RealtimeBackpressureState,
  RealtimeLifecycle,
  RealtimeTerminalReason,
  type RealtimeControlStatus,
} from '../../core-generated/runtime-protobuf/runtime/v1/realtime_control.js';
import {
  createNimiAgentRealtimeRuntimeClient,
  type NimiAgentRealtimeRuntime,
} from './local-app-runtime-platform-direct-agent-realtime.js';
import {
  createNimiRealmRealtimeRuntimeClient,
  type NimiRealmRealtimeRuntime,
} from './local-app-runtime-platform-direct-realm-realtime.js';
import {
  createNimiRealmChatRuntimeClient,
  type NimiRealmChatRuntime,
} from './local-app-runtime-platform-realm-chat.js';

const agentHandle = `agent_ref_${'a'.repeat(43)}` as const;
const audioFormat = {
  codec: AiRealtimeAudioCodec.PCM_S16LE,
  sampleRateHz: 16_000,
  channelCount: 1,
  frameDurationMs: 100,
  maximumFrameBytes: 3_200,
};

function control(adapterKind: RealtimeAdapterKind, subscriptionId = ''): RealtimeControlStatus {
  return {
    realtimeSessionId: 'session-1', channelId: 'channel-1', subscriptionId,
    adapterKind, lifecycle: RealtimeLifecycle.READY, generation: '1', sequence: '0',
    correlationId: 'correlation-1', backpressure: RealtimeBackpressureState.NORMAL,
    bufferedItems: 0, bufferCapacity: 32,
    terminalReason: RealtimeTerminalReason.UNSPECIFIED, actionHint: '',
    occurredAt: { seconds: '1', nanos: 0 },
  };
}

const ack = { ok: true, reasonCode: ReasonCode.ACTION_EXECUTED, actionHint: '' };

test('Desktop protected Runtime can project the canonical Agent Realtime client', async () => {
  let appendedFrame: Uint8Array | undefined;
  const runtime: NimiAgentRealtimeRuntime = {
    async openLocalAppAgentRealtime(request) {
      assert.equal(request.agentHandle, agentHandle);
      assert.equal(request.turnDetection, AiRealtimeTurnDetectionMode.SERVER_VAD);
      return {
        conversationAnchorId: 'anchor-1', realtimeSessionId: 'session-1', channelId: 'channel-1',
        generation: '1', negotiatedInputAudio: audioFormat, negotiatedOutputAudio: audioFormat,
        control: control(RealtimeAdapterKind.LOCAL_AGENT),
      };
    },
    async appendLocalAppAgentRealtimeInput(request) {
      assert.equal(request.input.oneofKind, 'audioFrame');
      if (request.input.oneofKind === 'audioFrame') appendedFrame = request.input.audioFrame.frame;
      return { ack, control: control(RealtimeAdapterKind.LOCAL_AGENT) };
    },
    async *subscribeLocalAppAgentRealtimeEvents() {
      yield {
        control: control(RealtimeAdapterKind.LOCAL_AGENT, 'subscription-1'),
        event: { oneofKind: 'speechStatus', speechStatus: {
          inputTrackId: 'input-1', utteranceId: 'utterance-1', state: AiRealtimeSpeechState.STARTED,
        } },
      };
      yield {
        control: { ...control(RealtimeAdapterKind.LOCAL_AGENT, 'subscription-1'), sequence: '1' },
        event: { oneofKind: 'outputTrack', outputTrack: {
          requestId: 'request-1', outputTrackId: 'output-1',
          lifecycle: AiRealtimeOutputTrackLifecycle.INTERRUPTED,
          reasonCode: ReasonCode.ACTION_EXECUTED,
        } },
      };
    },
    async getLocalAppAgentRealtimeStatus() {
      return { control: control(RealtimeAdapterKind.LOCAL_AGENT) };
    },
    async interruptLocalAppAgentRealtimeOutput() {
      return { ack, control: control(RealtimeAdapterKind.LOCAL_AGENT) };
    },
    async closeLocalAppAgentRealtime() {
      return { ack, control: control(RealtimeAdapterKind.LOCAL_AGENT) };
    },
  };
  const client = createNimiAgentRealtimeRuntimeClient(runtime);
  const opened = await client.open({
    agentHandle,
    inputAudio: { codec: 'pcm-s16le', sampleRateHz: 16_000, channelCount: 1, frameDurationMs: 100, maximumFrameBytes: 3_200 },
    turnDetection: 'server-vad',
  });
  assert.equal(opened.conversationAnchorId, 'anchor-1');
  await client.appendInput({
    agentHandle, realtimeSessionId: opened.realtimeSessionId, generation: opened.generation,
    input: { type: 'audio-frame', inputTrackId: 'input-1', utteranceId: 'utterance-1', frameSequence: '1', frame: Uint8Array.of(1, 2) },
  });
  assert.deepEqual(appendedFrame, Uint8Array.of(1, 2));
  const subscription = await client.subscribe({ agentHandle, realtimeSessionId: 'session-1', generation: '1' });
  const iterator = subscription[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.deepEqual(first.value?.event, {
    type: 'speech-status', inputTrackId: 'input-1', utteranceId: 'utterance-1', state: 'started',
  });
  const interrupted = await iterator.next();
  assert.deepEqual(interrupted.value?.event, {
    type: 'output-track', requestId: 'request-1', outputTrackId: 'output-1',
    lifecycle: 'interrupted', reasonCode: 'ACTION_EXECUTED',
  });
});

test('Desktop protected Runtime can project the canonical Realm Realtime client', async () => {
  let subscribedTarget = '';
  const runtime: NimiRealmRealtimeRuntime = {
    async openRealmRealtimeChannel() {
      return {
        realtimeSessionId: 'session-1', channelId: 'channel-1', generation: '1',
        status: control(RealtimeAdapterKind.REALM),
      };
    },
    async *subscribeRealmRealtimeEvents(request) {
      subscribedTarget = request.target.oneofKind ?? '';
      yield {
        realtimeSessionId: 'session-1', channelId: 'channel-1', subscriptionId: 'subscription-1',
        generation: '1', sequence: '1', correlationId: 'correlation-1',
        occurredAt: { seconds: '1', nanos: 0 },
        event: { oneofKind: 'inbox', inbox: {
          chatId: 'chat-1', highWatermarkSeq: '7', occurredAt: { seconds: '1', nanos: 0 },
        } },
      };
    },
    async ackRealmRealtimeEvents() { return { ack }; },
    async closeRealmRealtimeSubscription() { return { ack }; },
    async closeRealmRealtimeChannel() { return { ack }; },
  };
  const client = createNimiRealmRealtimeRuntimeClient(runtime);
  const opened = await client.open();
  const subscription = await client.subscribe({ channelId: opened.channelId, target: { type: 'inbox' } });
  const first = await subscription[Symbol.asyncIterator]().next();
  assert.equal(subscribedTarget, 'inbox');
  assert.deepEqual(first.value?.event, {
    type: 'inbox', chatId: 'chat-1', highWatermarkSeq: '7', occurredAt: { seconds: '1', nanos: 0 },
  });
  assert.equal((await client.closeChannel({ channelId: opened.channelId })).reasonCode, 'ACTION_EXECUTED');
});

test('Desktop protected Runtime projects the authoritative Realm Chat list through the canonical client', async () => {
  const runtime: NimiRealmChatRuntime = {
    async listRealmChats(request) {
      assert.equal(request.limit, 20);
      return {
        items: [{
          chatId: 'chat-1', unreadCount: 2,
          otherUser: {
            id: 'user-2', handle: 'friend', displayName: 'Friend', avatarUrl: '', status: 'ACTIVE',
            presenceStatus: 'online', presenceText: '', presenceEmoji: '', createdAt: { seconds: '1', nanos: 0 },
          },
          createdAt: { seconds: '1', nanos: 0 }, updatedAt: { seconds: '2', nanos: 0 },
        }],
        nextCursor: '',
      };
    },
  };
  const page = await createNimiRealmChatRuntimeClient(runtime).list({ limit: 20 });
  assert.equal(page.items[0]?.chatId, 'chat-1');
  assert.equal(page.items[0]?.otherUser.handle, 'friend');
  assert.equal(page.items[0]?.lastMessage, null);
  assert.equal(page.nextCursor, null);
});
