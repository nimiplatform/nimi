import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { createTauriIpcTransport } from '../../src/runtime/transports/tauri-ipc';
import {
  createNodeGrpcTransport,
  setNodeGrpcBridge,
} from '../../src/runtime/transports/node-grpc';
import { asNimiError, createNimiError } from '../../src/core/errors';
import {
  checkRuntimeVersionCompatibility,
  assertRuntimeMethodAvailable,
  wrapModeDStream,
  resolveRuntimeSubjectUserId,
  resolveOptionalRuntimeSubjectUserId,
  runtimeAiRequestRequiresSubject,
} from '../../src/runtime/runtime-guards.js';
import {
  connectRuntime,
  readyRuntime,
  closeRuntime,
} from '../../src/runtime/runtime-lifecycle.js';
import {
  toRuntimeGenerateResult,
  runtimeGenerateConvenience,
  runtimeStreamConvenience,
} from '../../src/runtime/runtime-convenience.js';
import {
  installTauriRuntime,
  unwrapTauriInvokePayload,
  clearNodeGrpcBridge,
  installNodeGrpcBridge,
} from './runtime-client-fixtures.js';
import { RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai';
import type {
  RuntimeWireMessage,
  RuntimeUnaryCall,
  RuntimeOpenStreamCall,
  RuntimeConnectionState,
} from '../../src/runtime/types';

// ---------------------------------------------------------------------------
// tauri-ipc: readGlobalTauriInvoke / readGlobalTauriListen branches
// ---------------------------------------------------------------------------

test('tauri-ipc: responseMetadataObserver is called from config when input observer absent', async () => {
  let observedMeta: Record<string, string> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({
        responseBytesBase64: '',
        responseMetadata: { 'x-nimi-runtime-version': '0.1.0' },
      }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      _responseMetadataObserver: (meta) => { observedMeta = meta; },
    });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.deepEqual(observedMeta, { 'x-nimi-runtime-version': '0.1.0' });
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: responseMetadataObserver skipped when metadata is empty object', async () => {
  let observerCalled = false;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({
        responseBytesBase64: '',
        responseMetadata: {},
      }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      _responseMetadataObserver: () => { observerCalled = true; },
    });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.equal(observerCalled, false);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: responseMetadataObserver skipped when responseMetadata is undefined', async () => {
  let observerCalled = false;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({
        responseBytesBase64: '',
        // no responseMetadata
      }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      _responseMetadataObserver: () => { observerCalled = true; },
    });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.equal(observerCalled, false);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: input _responseMetadataObserver takes precedence over config', async () => {
  let inputObserverMeta: Record<string, string> | null = null;
  let configObserverCalled = false;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({
        responseBytesBase64: '',
        responseMetadata: { key: 'value' },
      }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      _responseMetadataObserver: () => { configObserverCalled = true; },
    });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
      _responseMetadataObserver: (meta) => { inputObserverMeta = meta; },
    });
    assert.deepEqual(inputObserverMeta, { key: 'value' });
    assert.equal(configObserverCalled, false);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: responseMetadataObserver accepts snake_case bridge metadata', async () => {
  let observedMeta: Record<string, string> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({
        responseBytesBase64: '',
        response_metadata: {
          'x-nimi-route-describe-result': 'route-describe-payload',
        },
      }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
      _responseMetadataObserver: (meta) => { observedMeta = meta; },
    });
    assert.deepEqual(observedMeta, {
      'x-nimi-route-describe-result': 'route-describe-payload',
    });
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: responseMetadataObserver keeps non-empty snake_case metadata when camelCase is empty', async () => {
  let observedMeta: Record<string, string> | null = null;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({
        responseBytesBase64: '',
        responseMetadata: {},
        response_metadata: {
          'x-nimi-route-describe-result': 'route-describe-payload',
        },
      }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
      _responseMetadataObserver: (meta) => { observedMeta = meta; },
    });
    assert.deepEqual(observedMeta, {
      'x-nimi-route-describe-result': 'route-describe-payload',
    });
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream open returns empty streamId
// ---------------------------------------------------------------------------

test('tauri-ipc: stream open throws when streamId is empty', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) return { streamId: '' };
        return {};
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await assert.rejects(
      () => transport.openStream({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeOpenStreamCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_STREAM_ID_MISSING
          || e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream error without explicit error payload
// ---------------------------------------------------------------------------

test('tauri-ipc: stream error event without error payload creates default error', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) {
          const streamId = 'stream-default-error';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (handler) {
              handler({
                payload: {
                  streamId,
                  eventType: 'error',
                  // no error payload -> should create default error
                },
              });
            }
          }, 0);
          return { streamId };
        }
        return {};
      },
    },
    event: {
      listen: (event: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(event, handler);
        return () => { listeners.delete(event); };
      },
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    const iter = stream[Symbol.asyncIterator]();
    await assert.rejects(
      () => iter.next(),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_STREAM_REMOTE_ERROR
          || e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_STREAM_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream with already-aborted signal
// ---------------------------------------------------------------------------

test('tauri-ipc: stream with already-aborted signal closes immediately', async () => {
  const closeRequests: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command.includes('stream_open')) return { streamId: 'stream-pre-aborted' };
        if (command.includes('stream_close')) {
          const p = unwrapTauriInvokePayload(payload);
          closeRequests.push(String(p.streamId || ''));
          return {};
        }
        return {};
      },
    },
    event: {
      listen: (_event: string, _handler: (event: { payload: unknown }) => void) => {
        return () => {};
      },
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const controller = new AbortController();
    controller.abort();
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
      signal: controller.signal,
    });
    const iter = stream[Symbol.asyncIterator]();
    const result = await iter.next();
    assert.equal(result.done, true);
    assert.deepEqual(closeRequests, ['stream-pre-aborted']);
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream iterator throw
// ---------------------------------------------------------------------------

test('tauri-ipc: stream iterator throw closes stream and re-throws', async () => {
  const closeRequests: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string, payload?: unknown) => {
        if (command.includes('stream_open')) return { streamId: 'stream-throw-test' };
        if (command.includes('stream_close')) {
          const p = unwrapTauriInvokePayload(payload);
          closeRequests.push(String(p.streamId || ''));
          return {};
        }
        return {};
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    const iter = stream[Symbol.asyncIterator]();
    const customError = new Error('user-thrown-error');
    await assert.rejects(() => iter.throw!(customError), { message: 'user-thrown-error' });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(closeRequests, ['stream-throw-test']);
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream close double-call is idempotent
// ---------------------------------------------------------------------------

test('tauri-ipc: closing already-closed stream is idempotent', async () => {
  let closeCount = 0;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) return { streamId: 'stream-close-twice' };
        if (command.includes('stream_close')) {
          closeCount++;
          return {};
        }
        return {};
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    const iter = stream[Symbol.asyncIterator]();
    // First return
    await iter.return!();
    // Second return should be idempotent
    await iter.return!();
    await new Promise((r) => setTimeout(r, 0));
    // closeRemoteStream should only be called once (closed flag)
    assert.equal(closeCount, 1);
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: closeStream error wrapping
// ---------------------------------------------------------------------------

test('tauri-ipc: closeStream wraps error with correct reason code', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_close')) {
          throw new Error('close failed');
        }
        return {};
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await assert.rejects(
      () => transport.closeStream({ streamId: 'stream-close-err' }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_STREAM_CLOSE_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream with no signal set
// ---------------------------------------------------------------------------

test('tauri-ipc: stream works without signal', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) {
          const streamId = 'stream-no-signal';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (handler) {
              handler({ payload: { streamId, eventType: 'completed' } });
            }
          }, 0);
          return { streamId };
        }
        return {};
      },
    },
    event: {
      listen: (event: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(event, handler);
        return () => { listeners.delete(event); };
      },
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
      // no signal
    });
    const items: RuntimeWireMessage[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    assert.equal(items.length, 0);
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream open failure with existing unsubscribe
// ---------------------------------------------------------------------------

test('tauri-ipc: stream open failure cleans up and re-throws', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) {
          throw new Error('open failed at bridge level');
        }
        return {};
      },
    },
    event: {
      listen: () => () => {},
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await assert.rejects(
      () => transport.openStream({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeOpenStreamCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: stream unknown eventType is ignored
// ---------------------------------------------------------------------------

test('tauri-ipc: stream unknown eventType is silently ignored', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) {
          const streamId = 'stream-unknown-event';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (handler) {
              // Send unknown event type first
              handler({ payload: { streamId, eventType: 'keepalive' } });
              // Then complete
              handler({ payload: { streamId, eventType: 'completed' } });
            }
          }, 0);
          return { streamId };
        }
        return {};
      },
    },
    event: {
      listen: (event: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(event, handler);
        return () => { listeners.delete(event); };
      },
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    const items: RuntimeWireMessage[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    // unknown eventType is ignored, stream completes normally
    assert.equal(items.length, 0);
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: iterator next when already done
// ---------------------------------------------------------------------------

test('tauri-ipc: iterator next returns done after stream completed', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) {
          const streamId = 'stream-done-check';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (handler) {
              handler({ payload: { streamId, eventType: 'completed' } });
            }
          }, 0);
          return { streamId };
        }
        return {};
      },
    },
    event: {
      listen: (event: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(event, handler);
        return () => { listeners.delete(event); };
      },
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    const iter = stream[Symbol.asyncIterator]();
    const first = await iter.next();
    assert.equal(first.done, true);
    // Call next again after done
    const second = await iter.next();
    assert.equal(second.done, true);
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: iterator next when queue has items
// ---------------------------------------------------------------------------

test('tauri-ipc: iterator next returns queued items synchronously', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        if (command.includes('stream_open')) {
          const streamId = 'stream-queued';
          setTimeout(() => {
            const handler = listeners.get(`runtime_bridge:stream:${streamId}`);
            if (handler) {
              handler({ payload: { streamId, eventType: 'next', payloadBytesBase64: Buffer.from([1, 2]).toString('base64') } });
              handler({ payload: { streamId, eventType: 'next', payloadBytesBase64: Buffer.from([3, 4]).toString('base64') } });
              handler({ payload: { streamId, eventType: 'completed' } });
            }
          }, 0);
          return { streamId };
        }
        return {};
      },
    },
    event: {
      listen: (event: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(event, handler);
        return () => { listeners.delete(event); };
      },
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    const items: RuntimeWireMessage[] = [];
    for await (const item of stream) {
      items.push(item);
    }
    assert.equal(items.length, 2);
  } finally {
    restoreTauri();
  }
});
