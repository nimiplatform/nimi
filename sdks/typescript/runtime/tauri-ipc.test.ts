import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountEventType, RuntimeHealthStatus } from '../core-generated/runtime-typed-client';
import {
  AccountSessionEvent,
  SubscribeAccountSessionEventsRequest,
} from '../core-generated/runtime-protobuf/runtime/v1/account';
import {
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
} from '../core-generated/runtime-protobuf/runtime/v1/audit';
import { Runtime } from './index';
import { ReasonCode } from '../types';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void> | (() => void);

type TauriTestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: TauriInvoke;
    listen?: TauriListen;
  };
};

function installTauriTestHook(input: { invoke?: TauriInvoke; listen?: TauriListen }): () => void {
  const target = globalThis as TauriTestGlobal;
  const previous = target.__NIMI_TAURI_TEST__;
  target.__NIMI_TAURI_TEST__ = input;
  return () => {
    if (previous) {
      target.__NIMI_TAURI_TEST__ = previous;
    } else {
      delete target.__NIMI_TAURI_TEST__;
    }
  };
}

function unwrapPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const nested = (payload as Record<string, unknown>).payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return {};
  }
  return nested as Record<string, unknown>;
}

function fromBase64(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(String(value || ''), 'base64'));
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

test('tauri-ipc Runtime transport encodes and decodes protobuf unary calls', async () => {
  let capturedPayload: Record<string, unknown> = {};
  const restore = installTauriTestHook({
    invoke: async (command, payload) => {
      assert.equal(command, 'runtime_bridge_unary');
      capturedPayload = unwrapPayload(payload);
      return {
        responseBytesBase64: toBase64(GetRuntimeHealthResponse.toBinary(GetRuntimeHealthResponse.create({
          status: RuntimeHealthStatus.READY,
          reason: 'tauri-ok',
        }))),
        responseMetadata: { 'x-nimi-runtime-version': '0.5.0' },
      };
    },
  });

  try {
    const runtime = new Runtime({
      appId: 'nimi.tauri.test',
      transport: { type: 'tauri-ipc' },
      authMetadata: () => ({
        authorization: 'Bearer tauri-token',
        'x-nimi-session-id': 'session-tauri',
        'x-nimi-session-token': 'session-token-tauri',
      }),
    });

    const health = await runtime.ready();

    assert.equal(health.status, RuntimeHealthStatus.READY);
    assert.equal(health.reason, 'tauri-ok');
    assert.equal(capturedPayload.methodId, '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    assert.deepEqual(GetRuntimeHealthRequest.fromBinary(fromBase64(capturedPayload.requestBytesBase64)), {});
    assert.equal((capturedPayload.metadata as { appId?: string }).appId, 'nimi.tauri.test');
    assert.equal((capturedPayload.metadata as { protocolVersion?: string }).protocolVersion, '1.0.0');
    assert.deepEqual(capturedPayload.appSession, {
      sessionId: 'session-tauri',
      sessionToken: 'session-token-tauri',
    });
    assert.equal((capturedPayload.metadata as { extra?: Record<string, string> }).extra?.['x-nimi-session-id'], undefined);
    assert.equal(capturedPayload.authorization, 'Bearer tauri-token');
    assert.equal(runtime.runtimeVersion(), '0.5.0');
    assert.equal(runtime.versionCompatibility().state, 'compatible');
  } finally {
    restore();
  }
});

test('tauri-ipc Runtime transport decodes protobuf server streams', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  let capturedPayload: Record<string, unknown> = {};
  const restore = installTauriTestHook({
    invoke: async (command, payload) => {
      if (command === 'runtime_bridge_stream_open') {
        capturedPayload = unwrapPayload(payload);
        const streamId = 'tauri-stream-1';
        setTimeout(() => {
          listeners.get(`runtime_bridge:stream:${streamId}`)?.({
            payload: {
              streamId,
              eventType: 'next',
              payloadBytesBase64: toBase64(AccountSessionEvent.toBinary(AccountSessionEvent.create({
                eventId: 'event-tauri',
                sequence: '42',
                eventType: AccountEventType.LOGIN_COMPLETED,
              }))),
            },
          });
          listeners.get(`runtime_bridge:stream:${streamId}`)?.({
            payload: {
              streamId,
              eventType: 'completed',
            },
          });
        }, 0);
        return { streamId };
      }
      if (command === 'runtime_bridge_stream_close') {
        return {};
      }
      throw new Error(`unexpected tauri command: ${command}`);
    },
    listen: (event, handler) => {
      listeners.set(event, handler);
      return () => {
        listeners.delete(event);
      };
    },
  });

  try {
    const runtime = new Runtime({
      appId: 'nimi.tauri.test',
      transport: { type: 'tauri-ipc' },
    });
    const events = [];

    for await (const event of runtime.account.subscribeAccountSessionEvents({ afterSequence: '41' })) {
      events.push(event);
    }

    assert.equal(capturedPayload.methodId, '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents');
    assert.deepEqual(SubscribeAccountSessionEventsRequest.fromBinary(fromBase64(capturedPayload.requestBytesBase64)), {
      afterSequence: '41',
    });
    assert.equal((capturedPayload.metadata as { appId?: string }).appId, 'nimi.tauri.test');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.eventId, 'event-tauri');
    assert.equal(events[0]?.eventType, AccountEventType.LOGIN_COMPLETED);
  } finally {
    restore();
  }
});

test('tauri-ipc Runtime transport drains queued stream chunks before surfacing remote error', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const restore = installTauriTestHook({
    invoke: async (command) => {
      if (command === 'runtime_bridge_stream_open') {
        const streamId = 'tauri-stream-error';
        setTimeout(() => {
          listeners.get(`runtime_bridge:stream:${streamId}`)?.({
            payload: {
              streamId,
              eventType: 'next',
              payloadBytesBase64: toBase64(AccountSessionEvent.toBinary(AccountSessionEvent.create({
                eventId: 'event-before-error',
                sequence: '43',
                eventType: AccountEventType.LOGIN_COMPLETED,
              }))),
            },
          });
          listeners.get(`runtime_bridge:stream:${streamId}`)?.({
            payload: {
              streamId,
              eventType: 'error',
              error: {
                reasonCode: ReasonCode.AI_STREAM_BROKEN,
                message: 'remote stream failed',
                actionHint: 'retry_stream',
              },
            },
          });
        }, 0);
        return { streamId };
      }
      if (command === 'runtime_bridge_stream_close') {
        return {};
      }
      throw new Error(`unexpected tauri command: ${command}`);
    },
    listen: (event, handler) => {
      listeners.set(event, handler);
      return () => {
        listeners.delete(event);
      };
    },
  });

  try {
    const runtime = new Runtime({
      appId: 'nimi.tauri.test',
      transport: { type: 'tauri-ipc' },
    });
    const iterator = runtime.account.subscribeAccountSessionEvents({ afterSequence: '42' })[Symbol.asyncIterator]();

    const first = await iterator.next();
    assert.equal(first.done, false);
    assert.equal(first.value.eventId, 'event-before-error');
    await assert.rejects(
      () => iterator.next(),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.AI_STREAM_BROKEN,
    );
  } finally {
    restore();
  }
});

test('tauri-ipc Runtime transport fails closed when invoke is unavailable', async () => {
  const restore = installTauriTestHook({});
  try {
    const runtime = new Runtime({ transport: { type: 'tauri-ipc' } });
    await assert.rejects(
      runtime.ready(),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'SDK_RUNTIME_TAURI_INVOKE_MISSING');
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('tauri-ipc Runtime transport preserves structured unary errors', async () => {
  const restore = installTauriTestHook({
    invoke: async () => {
      throw {
        message: 'remote provider timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_later',
        traceId: 'trace-tauri',
        retryable: true,
      };
    },
  });

  try {
    const runtime = new Runtime({ transport: { type: 'tauri-ipc' } });
    await assert.rejects(
      runtime.ready(),
      (error: unknown) => {
        const shaped = error as {
          code?: string;
          reasonCode?: string;
          actionHint?: string;
          traceId?: string;
          retryable?: boolean;
        };
        assert.equal(shaped.code, 'AI_PROVIDER_TIMEOUT');
        assert.equal(shaped.reasonCode, 'AI_PROVIDER_TIMEOUT');
        assert.equal(shaped.actionHint, 'retry_later');
        assert.equal(shaped.traceId, 'trace-tauri');
        assert.equal(shaped.retryable, true);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('tauri-ipc Runtime transport accepts empty protobuf unary responses', async () => {
  const restore = installTauriTestHook({
    invoke: async (command) => {
      assert.equal(command, 'runtime_bridge_unary');
      return {
        responseBytesBase64: '',
      };
    },
  });

  try {
    const runtime = new Runtime({ transport: { type: 'tauri-ipc' } });
    const response = await runtime.local.listLocalEnvironmentDependencyJobs({});
    assert.deepEqual(response.jobs, []);
  } finally {
    restore();
  }
});

test('tauri-ipc Runtime transport fails closed when unary bytes are missing', async () => {
  const restore = installTauriTestHook({
    invoke: async () => ({}),
  });

  try {
    const runtime = new Runtime({ transport: { type: 'tauri-ipc' } });
    await assert.rejects(
      runtime.ready(),
      (error: unknown) => {
        const shaped = error as { code?: string; reasonCode?: string };
        assert.equal(shaped.code, 'SDK_RUNTIME_TAURI_UNARY_BYTES_MISSING');
        assert.equal(shaped.reasonCode, 'SDK_RUNTIME_TAURI_UNARY_BYTES_MISSING');
        return true;
      },
    );
  } finally {
    restore();
  }
});
