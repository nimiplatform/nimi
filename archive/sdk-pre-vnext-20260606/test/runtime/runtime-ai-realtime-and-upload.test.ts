import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Runtime,
  RuntimeMethodIds,
  setNodeGrpcBridge,
  type NodeGrpcBridge,
} from '../../src/runtime/index.js';
import {
  ReasonCode,
} from '../../src/types/index.js';
import {
  AppendRealtimeInputResponse,
  CloseRealtimeSessionResponse,
  OpenRealtimeSessionResponse,
  ReadRealtimeEventsRequest,
  RealtimeCompleted,
  RealtimeEvent,
  RealtimeEventType,
  RoutePolicy,
} from '../../src/runtime/generated/runtime/v1/ai.js';

test('Runtime ai realtime methods bridge unary and stream calls', async () => {
  const bridge: NodeGrpcBridge = {
    invokeUnary: async (_config, input) => {
      switch (input.methodId) {
        case RuntimeMethodIds.aiRealtime.openRealtimeSession:
          return OpenRealtimeSessionResponse.toBinary(OpenRealtimeSessionResponse.create({
            sessionId: 'rt_123',
            routeDecision: RoutePolicy.LOCAL,
            modelResolved: 'local/realtime-model',
            traceId: 'trace-open',
          }));
        case RuntimeMethodIds.aiRealtime.appendRealtimeInput:
          return AppendRealtimeInputResponse.toBinary(AppendRealtimeInputResponse.create({
            ack: { ok: true },
            traceId: 'trace-append',
          }));
        case RuntimeMethodIds.aiRealtime.closeRealtimeSession:
          return CloseRealtimeSessionResponse.toBinary(CloseRealtimeSessionResponse.create({
            ack: { ok: true },
          }));
        default:
          throw new Error(`unexpected unary method ${input.methodId}`);
      }
    },
    openStream: async (_config, input) => {
      assert.equal(input.methodId, RuntimeMethodIds.aiRealtime.readRealtimeEvents);
      return {
        async *[Symbol.asyncIterator]() {
          yield RealtimeEvent.toBinary(RealtimeEvent.create({
            eventType: RealtimeEventType.REALTIME_EVENT_TEXT_DELTA,
            sequence: '1',
            traceId: 'trace-stream',
            payload: {
              oneofKind: 'textDelta',
              textDelta: { text: 'hello' },
            },
          }));
          yield RealtimeEvent.toBinary(RealtimeEvent.create({
            eventType: RealtimeEventType.REALTIME_EVENT_COMPLETED,
            sequence: '2',
            traceId: 'trace-stream',
            payload: {
              oneofKind: 'completed',
              completed: RealtimeCompleted.create({}),
            },
          }));
        },
      };
    },
    closeStream: async () => {},
  };

  setNodeGrpcBridge(bridge);
  try {
    const runtime = new Runtime({
      appId: 'nimi.test',
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      subjectContext: { subjectUserId: 'user-001' },
    });

    const opened = await runtime.ai.openRealtimeSession({
      head: {
        appId: 'nimi.test',
        modelId: 'local/realtime-model',
        routePolicy: RoutePolicy.LOCAL,
      },
    });
    assert.equal(opened.sessionId, 'rt_123');

    const appended = await runtime.ai.appendRealtimeInput({
      sessionId: 'rt_123',
      items: [],
    });
    assert.equal(appended.ack?.ok, true);

    const events = await runtime.ai.readRealtimeEvents(ReadRealtimeEventsRequest.create({
      sessionId: 'rt_123',
    }));
    const received: RealtimeEvent[] = [];
    for await (const event of events) {
      received.push(event);
    }
    assert.deepEqual(received.map((event) => event.eventType), [
      RealtimeEventType.REALTIME_EVENT_TEXT_DELTA,
      RealtimeEventType.REALTIME_EVENT_COMPLETED,
    ]);

    const closed = await runtime.ai.closeRealtimeSession({
      sessionId: 'rt_123',
    });
    assert.equal(closed.ack?.ok, true);
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('Runtime ai uploadArtifact rejects non-node transport', async () => {
  const runtime = new Runtime({
    appId: 'nimi.test',
    transport: { type: 'tauri-ipc' },
    subjectContext: { subjectUserId: 'user-001' },
  });

  await assert.rejects(
    () => runtime.ai.uploadArtifact({
      mimeType: 'audio/wav',
      bytes: new Uint8Array([1, 2, 3]),
    }),
    (error: unknown) => {
      const typed = error as { reasonCode?: string };
      return typed?.reasonCode === ReasonCode.SDK_TRANSPORT_INVALID;
    },
  );
});
