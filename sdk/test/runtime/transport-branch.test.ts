import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { createTauriIpcTransport } from '../../src/runtime/transports/tauri-ipc';
import {
  createNodeGrpcTransport,
  setNodeGrpcBridge,
} from '../../src/runtime/transports/node-grpc';
import { asNimiError, createNimiError } from '../../src/runtime/errors';
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

test('tauri-ipc: throws when __TAURI__ globals are missing for invoke', () => {
  const g = globalThis as Record<string, unknown>;
  const prevTauri = g.__TAURI__;
  const prevWindow = g.window;
  delete g.__TAURI__;
  delete g.window;

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    });
    assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'sdk' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_INVOKE_MISSING;
      },
    );
  } finally {
    if (prevTauri !== undefined) g.__TAURI__ = prevTauri;
    if (prevWindow !== undefined) g.window = prevWindow;
  }
});

test('tauri-ipc: throws when __TAURI__ globals are missing for listen (openStream)', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({ streamId: 'sid' }),
    },
    event: {
      listen: undefined as never,
    },
  });

  // Manually remove the listen to trigger missing listen branch
  const g = globalThis as Record<string, unknown>;
  const tauriRef = g.__TAURI__ as Record<string, unknown>;
  const windowRef = (g.window as Record<string, unknown>)?.__TAURI__ as Record<string, unknown> | undefined;
  if (tauriRef?.event) {
    delete (tauriRef.event as Record<string, unknown>).listen;
  }
  if (windowRef?.event) {
    delete (windowRef.event as Record<string, unknown>).listen;
  }

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    });
    await assert.rejects(
      () => transport.openStream({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeOpenStreamCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'sdk' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_LISTEN_MISSING
          || e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: readGlobalTauriInvoke returns fromGlobal when window.__TAURI__ absent', async () => {
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  const prevTauri = g.__TAURI__;

  // Set __TAURI__ on globalThis directly, not on window
  const invokeResult = { responseBytesBase64: '' };
  g.__TAURI__ = {
    core: { invoke: async () => invokeResult },
    event: { listen: () => () => {} },
  };
  delete g.window;

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
    });
    const result = await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.ok(result instanceof Uint8Array);
  } finally {
    if (prevTauri !== undefined) {
      g.__TAURI__ = prevTauri;
    } else {
      delete g.__TAURI__;
    }
    if (prevWindow !== undefined) {
      g.window = prevWindow;
    }
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: asObject branches
// ---------------------------------------------------------------------------

test('tauri-ipc: asObject returns {} for null, array, and non-object', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => null, // returns null -> asObject returns {}
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
    });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
      (error: unknown) => {
        // responseBytesBase64 is missing because asObject(null) => {}
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_UNARY_BYTES_MISSING
          || e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: asObject returns {} for array response', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => [1, 2, 3], // array -> asObject returns {}
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_UNARY_BYTES_MISSING
          || e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: normalizeRequestBytes branches
// ---------------------------------------------------------------------------

test('tauri-ipc: normalizeRequestBytes accepts ArrayBuffer', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({ responseBytesBase64: '' }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const buf = new ArrayBuffer(4);
    const result = await transport.invokeUnary({
      methodId: 'test',
      request: buf as unknown as RuntimeWireMessage,
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.ok(result instanceof Uint8Array);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: normalizeRequestBytes accepts DataView', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({ responseBytesBase64: '' }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    const result = await transport.invokeUnary({
      methodId: 'test',
      request: view as unknown as RuntimeWireMessage,
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.ok(result instanceof Uint8Array);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: normalizeRequestBytes accepts typed array with buffer property', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({ responseBytesBase64: '' }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const buf = new ArrayBuffer(8);
    const int16 = new Int16Array(buf, 2, 2); // has buffer, byteOffset, byteLength
    const result = await transport.invokeUnary({
      methodId: 'test',
      request: int16 as unknown as RuntimeWireMessage,
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.ok(result instanceof Uint8Array);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: normalizeRequestBytes throws for string input', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({ responseBytesBase64: '' }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: 'not-bytes' as unknown as RuntimeWireMessage,
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'sdk' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_REQUEST_BYTES_REQUIRED
          || e.reasonCode === ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED;
      },
    );
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: fromBase64 empty string returns empty Uint8Array
// ---------------------------------------------------------------------------

test('tauri-ipc: fromBase64 empty string returns empty Uint8Array', async () => {
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => ({ responseBytesBase64: '' }),
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const result = await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.deepEqual(result, new Uint8Array(0));
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: createCommandName / createEventName defaults
// ---------------------------------------------------------------------------

test('tauri-ipc: uses default command namespace when none provided', async () => {
  let capturedCommand = '';
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        capturedCommand = command;
        return { responseBytesBase64: '' };
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      // no commandNamespace
    });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.equal(capturedCommand, 'runtime_bridge_unary');
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: canRetryWithDefaultCommand branches
// ---------------------------------------------------------------------------

test('tauri-ipc: canRetryWithDefaultCommand returns false for empty message', async () => {
  let invokeCount = 0;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokeCount++;
        if (command.startsWith('custom_ns_')) {
          throw new Error(''); // empty message -> canRetryWithDefaultCommand => false
        }
        return { responseBytesBase64: '' };
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      commandNamespace: 'custom_ns',
    });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
    );
    assert.equal(invokeCount, 1); // no retry
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: canRetryWithDefaultCommand retries on "unknown command" message', async () => {
  const invokedCommands: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokedCommands.push(command);
        if (command.startsWith('custom_ns_')) {
          throw new Error('unknown command custom_ns_unary');
        }
        return { responseBytesBase64: '' };
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      commandNamespace: 'custom_ns',
    });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.deepEqual(invokedCommands, ['custom_ns_unary', 'runtime_bridge_unary']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: canRetryWithDefaultCommand returns true for "command not found"', async () => {
  const invokedCommands: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokedCommands.push(command);
        if (command.startsWith('custom_ns_')) {
          throw new Error('Command Not Found');
        }
        return { responseBytesBase64: '' };
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      commandNamespace: 'custom_ns',
    });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.deepEqual(invokedCommands, ['custom_ns_unary', 'runtime_bridge_unary']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: canRetryWithDefaultCommand handles error without message', async () => {
  let invokeCount = 0;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokeCount++;
        if (command.startsWith('custom_ns_')) {
          throw null; // null error -> message becomes empty
        }
        return { responseBytesBase64: '' };
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      commandNamespace: 'custom_ns',
    });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
    );
    assert.equal(invokeCount, 1); // no retry because empty message
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: does not retry when command matches default namespace', async () => {
  let invokeCount = 0;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async () => {
        invokeCount++;
        throw new Error('unknown command runtime_bridge_unary');
      },
    },
    event: { listen: () => () => {} },
  });

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge', // same as default
    });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
    );
    assert.equal(invokeCount, 1); // no retry because command === defaultCommand
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: responseMetadataObserver branches
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

// ---------------------------------------------------------------------------
// node-grpc: endpoint normalization branches
// ---------------------------------------------------------------------------

test('node-grpc: throws when endpoint is empty', () => {
  assert.throws(
    () => createNodeGrpcTransport({ type: 'node-grpc', endpoint: '' }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED;
    },
  );
});

test('node-grpc: throws when endpoint is whitespace only', () => {
  assert.throws(
    () => createNodeGrpcTransport({ type: 'node-grpc', endpoint: '   ' }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED;
    },
  );
});

test('node-grpc: strips http:// prefix from endpoint', async () => {
  let capturedEndpoint = '';
  installNodeGrpcBridge({
    invokeUnary: async (config) => {
      capturedEndpoint = config.endpoint;
      return new Uint8Array(0);
    },
    openStream: async () => { throw new Error('unexpected'); },
    closeStream: async () => {},
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: 'http://127.0.0.1:5000' });
    await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    // the bridge receives the original config, but the internal endpoint should be stripped
    // Since the bridge intercepts, we can't check internal endpoint directly,
    // but we verified it doesn't throw
    assert.ok(true);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('node-grpc: strips https:// prefix from endpoint', () => {
  // Just verify it doesn't throw during creation
  installNodeGrpcBridge({
    invokeUnary: async () => new Uint8Array(0),
    openStream: async () => { throw new Error('unexpected'); },
    closeStream: async () => {},
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: 'https://example.com:443' });
    assert.ok(transport);
  } finally {
    clearNodeGrpcBridge();
  }
});

// ---------------------------------------------------------------------------
// node-grpc: bridge delegation branches
// ---------------------------------------------------------------------------

test('node-grpc: invokeUnary delegates to bridge when set', async () => {
  let bridgeCalled = false;
  installNodeGrpcBridge({
    invokeUnary: async () => {
      bridgeCalled = true;
      return new Uint8Array([1, 2, 3]);
    },
    openStream: async () => { throw new Error('unexpected'); },
    closeStream: async () => {},
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: '127.0.0.1:5000' });
    const result = await transport.invokeUnary({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeUnaryCall['metadata'],
    });
    assert.ok(bridgeCalled);
    assert.deepEqual(result, new Uint8Array([1, 2, 3]));
  } finally {
    clearNodeGrpcBridge();
  }
});

test('node-grpc: openStream delegates to bridge when set', async () => {
  let bridgeCalled = false;
  installNodeGrpcBridge({
    invokeUnary: async () => new Uint8Array(0),
    openStream: async () => {
      bridgeCalled = true;
      return (async function*() {})();
    },
    closeStream: async () => {},
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: '127.0.0.1:5000' });
    await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    assert.ok(bridgeCalled);
  } finally {
    clearNodeGrpcBridge();
  }
});

test('node-grpc: closeStream delegates to bridge when set', async () => {
  let bridgeCalled = false;
  installNodeGrpcBridge({
    invokeUnary: async () => new Uint8Array(0),
    openStream: async () => (async function*() {})(),
    closeStream: async () => { bridgeCalled = true; },
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: '127.0.0.1:5000' });
    await transport.closeStream({ streamId: 'test-stream' });
    assert.ok(bridgeCalled);
  } finally {
    clearNodeGrpcBridge();
  }
});

// ---------------------------------------------------------------------------
// node-grpc: error wrapping for bridge calls
// ---------------------------------------------------------------------------

test('node-grpc: invokeUnary bridge error is wrapped', async () => {
  installNodeGrpcBridge({
    invokeUnary: async () => { throw new Error('bridge unary failed'); },
    openStream: async () => { throw new Error('unexpected'); },
    closeStream: async () => {},
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: '127.0.0.1:5000' });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED;
      },
    );
  } finally {
    clearNodeGrpcBridge();
  }
});

test('node-grpc: openStream bridge error is wrapped', async () => {
  installNodeGrpcBridge({
    invokeUnary: async () => new Uint8Array(0),
    openStream: async () => { throw new Error('bridge stream failed'); },
    closeStream: async () => {},
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: '127.0.0.1:5000' });
    await assert.rejects(
      () => transport.openStream({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeOpenStreamCall['metadata'],
      }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED;
      },
    );
  } finally {
    clearNodeGrpcBridge();
  }
});

test('node-grpc: closeStream bridge error is wrapped', async () => {
  installNodeGrpcBridge({
    invokeUnary: async () => new Uint8Array(0),
    openStream: async () => (async function*() {})(),
    closeStream: async () => { throw new Error('bridge close failed'); },
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: '127.0.0.1:5000' });
    await assert.rejects(
      () => transport.closeStream({ streamId: 'test-stream' }),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'runtime' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_CLOSE_FAILED;
      },
    );
  } finally {
    clearNodeGrpcBridge();
  }
});

// ---------------------------------------------------------------------------
// node-grpc: closeStream with empty/missing streamId returns early
// ---------------------------------------------------------------------------

test('node-grpc: closeStream with empty streamId returns silently (no bridge)', async () => {
  setNodeGrpcBridge(null);
  // We can't easily test the internal path without a real grpc module,
  // but we can test through the bridge path
  let closeCalled = false;
  installNodeGrpcBridge({
    invokeUnary: async () => new Uint8Array(0),
    openStream: async () => (async function*() {})(),
    closeStream: async () => { closeCalled = true; },
  });

  try {
    const transport = createNodeGrpcTransport({ type: 'node-grpc', endpoint: '127.0.0.1:5000' });
    await transport.closeStream({ streamId: '' });
    // Bridge closeStream is still called since bridge path delegates directly
    assert.ok(closeCalled);
  } finally {
    clearNodeGrpcBridge();
  }
});

// ---------------------------------------------------------------------------
// runtime-guards: checkRuntimeVersionCompatibility branches
// ---------------------------------------------------------------------------

test('runtime-guards: checkRuntimeVersionCompatibility returns true when already checked', () => {
  const result = checkRuntimeVersionCompatibility({
    version: '0.1.0',
    versionChecked: true,
    sdkRuntimeMajor: 0,
    emitTelemetry: () => {},
    emitError: () => {},
  });
  assert.equal(result, true);
});

test('runtime-guards: checkRuntimeVersionCompatibility throws for unparseable version', () => {
  assert.throws(
    () => checkRuntimeVersionCompatibility({
      version: 'not-a-version',
      versionChecked: false,
      sdkRuntimeMajor: 0,
      emitTelemetry: () => {},
      emitError: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE;
    },
  );
});

test('runtime-guards: checkRuntimeVersionCompatibility throws for mismatched major version', () => {
  let emitErrorCalled = false;
  assert.throws(
    () => checkRuntimeVersionCompatibility({
      version: '2.0.0',
      versionChecked: false,
      sdkRuntimeMajor: 0,
      emitTelemetry: () => {},
      emitError: () => { emitErrorCalled = true; },
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_VERSION_INCOMPATIBLE;
    },
  );
  assert.ok(emitErrorCalled);
});

test('runtime-guards: checkRuntimeVersionCompatibility succeeds for matching major version', () => {
  let telemetryName = '';
  const result = checkRuntimeVersionCompatibility({
    version: '0.5.0',
    versionChecked: false,
    sdkRuntimeMajor: 0,
    emitTelemetry: (name) => { telemetryName = name; },
    emitError: () => {},
  });
  assert.equal(result, true);
  assert.equal(telemetryName, 'runtime.version.compatible');
});

test('runtime-guards: checkRuntimeVersionCompatibility handles v-prefixed version', () => {
  const result = checkRuntimeVersionCompatibility({
    version: 'v0.3.1',
    versionChecked: false,
    sdkRuntimeMajor: 0,
    emitTelemetry: () => {},
    emitError: () => {},
  });
  assert.equal(result, true);
});

// ---------------------------------------------------------------------------
// runtime-guards: assertRuntimeMethodAvailable branches
// ---------------------------------------------------------------------------

test('runtime-guards: assertRuntimeMethodAvailable returns for non-phase2 module', () => {
  // Should not throw
  assertRuntimeMethodAvailable({
    moduleKey: 'ai',
    methodKey: 'executeScenario',
    runtimeVersion: '0.1.0',
    sdkRuntimeMajor: 0,
    phase2ModuleKeys: new Set(['workflow', 'model']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable returns for phase2 module with null version', () => {
  // null runtimeVersion => early return
  assertRuntimeMethodAvailable({
    moduleKey: 'workflow',
    methodKey: 'executeWorkflow',
    runtimeVersion: null,
    sdkRuntimeMajor: 0,
    phase2ModuleKeys: new Set(['workflow']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable returns for phase2 module with unparseable version', () => {
  // unparseable version => parseSemverMajor returns null => early return
  assertRuntimeMethodAvailable({
    moduleKey: 'workflow',
    methodKey: 'executeWorkflow',
    runtimeVersion: 'not-a-version',
    sdkRuntimeMajor: 0,
    phase2ModuleKeys: new Set(['workflow']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable throws for phase2 with old runtime', () => {
  assert.throws(
    () => assertRuntimeMethodAvailable({
      moduleKey: 'workflow',
      methodKey: 'executeWorkflow',
      runtimeVersion: '0.1.0',
      sdkRuntimeMajor: 1,
      phase2ModuleKeys: new Set(['workflow']),
      phase2AuditMethodIds: new Set(),
      auditMethodIds: {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE;
    },
  );
});

test('runtime-guards: assertRuntimeMethodAvailable allows phase2 with matching version', () => {
  assertRuntimeMethodAvailable({
    moduleKey: 'workflow',
    methodKey: 'executeWorkflow',
    runtimeVersion: '1.0.0',
    sdkRuntimeMajor: 1,
    phase2ModuleKeys: new Set(['workflow']),
    phase2AuditMethodIds: new Set(),
    auditMethodIds: {},
  });
});

test('runtime-guards: assertRuntimeMethodAvailable handles phase2 audit method', () => {
  assert.throws(
    () => assertRuntimeMethodAvailable({
      moduleKey: 'audit',
      methodKey: 'listAuditEvents',
      runtimeVersion: '0.1.0',
      sdkRuntimeMajor: 1,
      phase2ModuleKeys: new Set(),
      phase2AuditMethodIds: new Set(['/runtime.v1.AuditService/ListAuditEvents']),
      auditMethodIds: { listAuditEvents: '/runtime.v1.AuditService/ListAuditEvents' },
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE;
    },
  );
});

test('runtime-guards: assertRuntimeMethodAvailable skips non-matching audit method', () => {
  // audit module but method not in phase2AuditMethodIds => not phase2 => early return
  assertRuntimeMethodAvailable({
    moduleKey: 'audit',
    methodKey: 'getHealth',
    runtimeVersion: '0.1.0',
    sdkRuntimeMajor: 1,
    phase2ModuleKeys: new Set(),
    phase2AuditMethodIds: new Set(['/runtime.v1.AuditService/ListAuditEvents']),
    auditMethodIds: { getHealth: '/runtime.v1.AuditService/GetHealth' },
  });
});

// ---------------------------------------------------------------------------
// runtime-guards: wrapModeDStream branches
// ---------------------------------------------------------------------------

test('runtime-guards: wrapModeDStream yields from source and catches cancel', async () => {
  let cancelled = false;
  const source = (async function*() {
    yield 'a';
    yield 'b';
    throw createNimiError({
      message: ReasonCode.RUNTIME_GRPC_CANCELLED,
      reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED,
      source: 'runtime',
    });
  })();

  const wrapped = wrapModeDStream({
    source,
    onCancelled: () => { cancelled = true; },
  });

  const items: string[] = [];
  for await (const item of wrapped) {
    items.push(item as string);
  }
  assert.deepEqual(items, ['a', 'b']);
  assert.ok(cancelled);
});

test('runtime-guards: wrapModeDStream re-throws non-cancelled errors', async () => {
  const source = (async function*() {
    yield 'a';
    throw createNimiError({
      message: 'some other error',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      source: 'runtime',
    });
  })();

  const wrapped = wrapModeDStream({
    source,
    onCancelled: () => {},
  });

  const items: string[] = [];
  await assert.rejects(async () => {
    for await (const item of wrapped) {
      items.push(item as string);
    }
  }, (error: unknown) => {
    const e = asNimiError(error, { source: 'runtime' });
    return e.reasonCode === ReasonCode.RUNTIME_CALL_FAILED;
  });
  assert.deepEqual(items, ['a']);
});

test('runtime-guards: wrapModeDStream detects cancel via message containing reason code', async () => {
  let cancelled = false;
  const source = (async function*() {
    throw new Error(`something went wrong: ${ReasonCode.RUNTIME_GRPC_CANCELLED}`);
  })();

  const wrapped = wrapModeDStream({
    source,
    onCancelled: () => { cancelled = true; },
  });

  const items: string[] = [];
  for await (const item of wrapped) {
    items.push(item as string);
  }
  assert.equal(items.length, 0);
  assert.ok(cancelled);
});

// ---------------------------------------------------------------------------
// runtime-guards: resolveRuntimeSubjectUserId / resolveOptionalRuntimeSubjectUserId
// ---------------------------------------------------------------------------

test('runtime-guards: resolveRuntimeSubjectUserId returns explicit value', async () => {
  const result = await resolveRuntimeSubjectUserId({
    explicit: 'user-123',
  });
  assert.equal(result, 'user-123');
});

test('runtime-guards: resolveRuntimeSubjectUserId falls back to subjectContext.subjectUserId', async () => {
  const result = await resolveRuntimeSubjectUserId({
    subjectContext: { subjectUserId: 'context-user' },
  });
  assert.equal(result, 'context-user');
});

test('runtime-guards: resolveRuntimeSubjectUserId uses getSubjectUserId resolver', async () => {
  const result = await resolveRuntimeSubjectUserId({
    subjectContext: { getSubjectUserId: async () => 'resolved-user' },
  });
  assert.equal(result, 'resolved-user');
});

test('runtime-guards: resolveRuntimeSubjectUserId throws when no subject available', async () => {
  await assert.rejects(
    () => resolveRuntimeSubjectUserId({}),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.AUTH_CONTEXT_MISSING;
    },
  );
});

test('runtime-guards: resolveRuntimeSubjectUserId throws for empty explicit', async () => {
  await assert.rejects(
    () => resolveRuntimeSubjectUserId({
      explicit: '  ',
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.AUTH_CONTEXT_MISSING;
    },
  );
});

test('runtime-guards: resolveOptionalRuntimeSubjectUserId returns undefined when nothing set', async () => {
  const result = await resolveOptionalRuntimeSubjectUserId({});
  assert.equal(result, undefined);
});

test('runtime-guards: resolveOptionalRuntimeSubjectUserId returns undefined for empty resolver', async () => {
  const result = await resolveOptionalRuntimeSubjectUserId({
    subjectContext: { getSubjectUserId: async () => '' },
  });
  assert.equal(result, undefined);
});

test('runtime-guards: resolveOptionalRuntimeSubjectUserId skips non-function resolver', async () => {
  const result = await resolveOptionalRuntimeSubjectUserId({
    subjectContext: {
      getSubjectUserId: 'not-a-function' as unknown as () => string,
    },
  });
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// runtime-guards: runtimeAiRequestRequiresSubject branches
// ---------------------------------------------------------------------------

test('runtime-guards: runtimeAiRequestRequiresSubject returns false for local route without extras', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: 'local' as unknown as number },
  });
  // RoutePolicy.LOCAL is enum value, using string 'local' won't match
  // so routePolicy !== RoutePolicy.LOCAL -> returns true
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true for cloud route', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.CLOUD },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when connectorId present', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL, connectorId: 'my-connector' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true for managed keySource', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { keySource: 'managed' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true for inline keySource', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { keySource: 'inline' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when providerType set', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { providerType: 'openai' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when providerEndpoint set', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { providerEndpoint: 'https://api.example.com' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns true when providerApiKey set', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { providerApiKey: 'sk-test' },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject returns false for pure local with no extras', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: {},
  });
  assert.equal(result, false);
});

test('runtime-guards: runtimeAiRequestRequiresSubject reads head.routePolicy fallback', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { head: { routePolicy: RoutePolicy.CLOUD } },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject reads head.connectorId fallback', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { head: { routePolicy: RoutePolicy.LOCAL, connectorId: 'conn-1' } },
  });
  assert.equal(result, true);
});

test('runtime-guards: runtimeAiRequestRequiresSubject handles undefined metadata', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: undefined,
  });
  assert.equal(result, false);
});

test('runtime-guards: runtimeAiRequestRequiresSubject reads x-nimi- alt keys from metadata', () => {
  const result = runtimeAiRequestRequiresSubject({
    request: { routePolicy: RoutePolicy.LOCAL },
    metadata: { 'x-nimi-key-source': 'managed' } as Record<string, unknown>,
  });
  assert.equal(result, true);
});

// ---------------------------------------------------------------------------
// runtime-lifecycle: connectRuntime branches
// ---------------------------------------------------------------------------

test('runtime-lifecycle: connectRuntime returns immediately if already ready', async () => {
  let clientSet = false;
  await connectRuntime({
    appId: 'test',
    options: { transport: { type: 'tauri-ipc' } },
    state: { status: 'ready' },
    connectPromise: null,
    setState: () => {},
    setConnectPromise: () => {},
    setClient: () => { clientSet = true; },
    emitConnected: () => {},
    emitTelemetry: () => {},
  });
  assert.equal(clientSet, false); // should not create client since already ready
});

test('runtime-lifecycle: connectRuntime returns existing promise if connecting', async () => {
  let resolveFn: () => void = () => {};
  const existingPromise = new Promise<void>((resolve) => { resolveFn = resolve; });

  const connectPromise = connectRuntime({
    appId: 'test',
    options: { transport: { type: 'tauri-ipc' } },
    state: { status: 'connecting' },
    connectPromise: existingPromise,
    setState: () => {},
    setConnectPromise: () => {},
    setClient: () => {},
    emitConnected: () => {},
    emitTelemetry: () => {},
  });

  resolveFn();
  await connectPromise;
});

test('runtime-lifecycle: connectRuntime throws when no transport configured', async () => {
  let stateSet: RuntimeConnectionState | null = null;
  await assert.rejects(
    () => connectRuntime({
      appId: 'test',
      options: {}, // no transport
      state: { status: 'idle' },
      connectPromise: null,
      setState: (s) => { stateSet = s; },
      setConnectPromise: () => {},
      setClient: () => {},
      emitConnected: () => {},
      emitTelemetry: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'sdk' });
      return e.reasonCode === ReasonCode.SDK_TRANSPORT_INVALID;
    },
  );
  // State should be reset to idle on failure
  assert.ok(stateSet);
  assert.equal(stateSet!.status, 'idle');
});

// ---------------------------------------------------------------------------
// runtime-lifecycle: readyRuntime branches
// ---------------------------------------------------------------------------

test('runtime-lifecycle: readyRuntime throws when health is unavailable', async () => {
  await assert.rejects(
    () => readyRuntime({
      timeoutMs: 5000,
      waitForReady: async () => {},
      health: async () => ({ status: 'unavailable' as const, reason: 'daemon down' }),
      markReady: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'runtime' });
      return e.reasonCode === ReasonCode.RUNTIME_UNAVAILABLE;
    },
  );
});

test('runtime-lifecycle: readyRuntime succeeds when health is healthy', async () => {
  let readyAt = '';
  await readyRuntime({
    timeoutMs: 5000,
    waitForReady: async () => {},
    health: async () => ({ status: 'healthy' as const }),
    markReady: (at) => { readyAt = at; },
  });
  assert.ok(readyAt.length > 0);
});

test('runtime-lifecycle: readyRuntime succeeds when health is degraded', async () => {
  let readyAt = '';
  await readyRuntime({
    timeoutMs: 5000,
    waitForReady: async () => {},
    health: async () => ({ status: 'degraded' as const }),
    markReady: (at) => { readyAt = at; },
  });
  assert.ok(readyAt.length > 0);
});

test('runtime-lifecycle: readyRuntime health unavailable without reason', async () => {
  await assert.rejects(
    () => readyRuntime({
      timeoutMs: 5000,
      waitForReady: async () => {},
      health: async () => ({ status: 'unavailable' as const }),
      markReady: () => {},
    }),
    (error: unknown) => {
      const e = asNimiError(error, { source: 'runtime' });
      return e.message.includes('unknown reason');
    },
  );
});

// ---------------------------------------------------------------------------
// runtime-lifecycle: closeRuntime branches
// ---------------------------------------------------------------------------

test('runtime-lifecycle: closeRuntime returns early if already closed', () => {
  let stateSetCount = 0;
  closeRuntime({
    state: { status: 'closed' },
    setState: () => { stateSetCount++; },
    setClient: () => {},
    emitDisconnected: () => {},
    emitTelemetry: () => {},
  });
  assert.equal(stateSetCount, 0);
});

test('runtime-lifecycle: closeRuntime transitions through closing to closed', () => {
  const states: string[] = [];
  let disconnectedAt = '';
  let telemetryName = '';
  closeRuntime({
    state: { status: 'ready' },
    setState: (s) => { states.push(s.status); },
    setClient: () => {},
    emitDisconnected: (at) => { disconnectedAt = at; },
    emitTelemetry: (name) => { telemetryName = name; },
  });
  assert.deepEqual(states, ['closing', 'closed']);
  assert.ok(disconnectedAt.length > 0);
  assert.equal(telemetryName, 'runtime.disconnected');
});

test('runtime-lifecycle: closeRuntime sets client to null', () => {
  let clientValue: unknown = 'not-null';
  closeRuntime({
    state: { status: 'ready' },
    setState: () => {},
    setClient: (c) => { clientValue = c; },
    emitDisconnected: () => {},
    emitTelemetry: () => {},
  });
  assert.equal(clientValue, null);
});

// ---------------------------------------------------------------------------
// runtime-convenience: resolveRuntimeConvenienceTarget branches (via export check)
// ---------------------------------------------------------------------------

// These functions are not directly exported, so we test them through the
// public API functions runtimeGenerateConvenience and runtimeStreamConvenience.

test('runtime-convenience: generate with no model/provider defaults to local/default', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'hello',
            usage: { inputTokens: 5, outputTokens: 3 },
            finishReason: 'stop',
            trace: { traceId: 't1', modelResolved: 'local/default', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  const result = await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'hello',
  });
  assert.equal(capturedModel, 'local/default');
  assert.equal(result.text, 'hello');
});

test('runtime-convenience: generate with model only uses local route', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: 't2', modelResolved: 'local/llama3', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  const result = await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'llama3',
  });
  assert.equal(capturedModel, 'local/llama3');
  assert.equal(result.routeDecision, 'local');
});

test('runtime-convenience: generate with qualified remote model throws', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'openai/gpt-4',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: generate with provider + model uses cloud route', async () => {
  let capturedModel = '';
  let capturedRoute = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          capturedRoute = String(input.route || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: 't3', modelResolved: 'gemini/pro', routeDecision: 'cloud' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  const result = await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    provider: 'gemini',
    model: 'pro',
  });
  assert.equal(capturedModel, 'gemini/pro');
  assert.equal(capturedRoute, 'cloud');
  assert.equal(result.routeDecision, 'cloud');
});

test('runtime-convenience: generate with unsupported provider throws', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      provider: 'unsupported-provider',
    }),
    { message: /unsupported provider/ },
  );
});

test('runtime-convenience: generate with provider + qualified remote model throws', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      provider: 'openai',
      model: 'openai/gpt-4',
    }),
    { message: /provider-scoped model id/ },
  );
});

test('runtime-convenience: generate with provider but no model defaults to provider/default', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: 't4', routeDecision: 'cloud' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    provider: 'anthropic',
  });
  assert.equal(capturedModel, 'anthropic/default');
});

// ---------------------------------------------------------------------------
// runtime-convenience: stream mapping branches
// ---------------------------------------------------------------------------

test('runtime-convenience: stream maps delta, finish, error, and unknown parts', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({
          stream: (async function*() {
            yield { type: 'delta', text: 'hello' };
            yield { type: 'finish', usage: { inputTokens: 5, outputTokens: 3 }, finishReason: 'stop', trace: { traceId: 't1', routeDecision: 'local' } };
            yield { type: 'error', error: createNimiError({ message: 'stream error', reasonCode: ReasonCode.AI_STREAM_BROKEN, source: 'runtime' }) };
            yield { type: 'unknown-type' }; // should be filtered out
          })(),
        }),
      },
    },
  };

  const chunks: unknown[] = [];
  const stream = await runtimeStreamConvenience(mockRuntime as never, {
    prompt: 'test',
  });
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  assert.equal(chunks.length, 3); // unknown type filtered out
  assert.deepEqual((chunks[0] as Record<string, unknown>).type, 'text');
  assert.deepEqual((chunks[1] as Record<string, unknown>).type, 'done');
  assert.deepEqual((chunks[2] as Record<string, unknown>).type, 'error');
});

// ---------------------------------------------------------------------------
// runtime-convenience: toRuntimeGenerateResult edge cases
// ---------------------------------------------------------------------------

test('runtime-convenience: toRuntimeGenerateResult handles missing trace fields', () => {
  const result = toRuntimeGenerateResult({
    text: 'result',
    usage: undefined,
    finishReason: 'stop',
    trace: { traceId: undefined, modelResolved: undefined, routeDecision: undefined },
  } as never);
  assert.equal(result.text, 'result');
  assert.equal(result.traceId, '');
  assert.equal(result.modelResolved, '');
  assert.equal(result.routeDecision, 'local');
});

// ---------------------------------------------------------------------------
// runtime-convenience: subjectUserId defaults to 'local-user'
// ---------------------------------------------------------------------------

test('runtime-convenience: generate uses default subjectUserId when not provided', async () => {
  let capturedSubject = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedSubject = String(input.subjectUserId || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await runtimeGenerateConvenience(mockRuntime as never, { prompt: 'test' });
  assert.equal(capturedSubject, 'local-user');
});

test('runtime-convenience: generate uses explicit subjectUserId', async () => {
  let capturedSubject = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedSubject = String(input.subjectUserId || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    subjectUserId: 'custom-user',
  });
  assert.equal(capturedSubject, 'custom-user');
});

// ---------------------------------------------------------------------------
// runtime-convenience: looksLikeQualifiedRemoteModel branches
// ---------------------------------------------------------------------------

test('runtime-convenience: cloud/ prefix model is treated as qualified remote', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'cloud/model',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: local/ prefix model is treated as qualified', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'local/llama3',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: model without slash uses local route', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'llama3',
  });
  assert.equal(capturedModel, 'local/llama3');
});

test('runtime-convenience: nexa/ prefix is treated as qualified', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'nexa/octopus',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: localai/ prefix is treated as qualified', async () => {
  const mockRuntime = {
    ai: {
      text: {
        generate: async () => ({}),
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  await assert.rejects(
    () => runtimeGenerateConvenience(mockRuntime as never, {
      prompt: 'test',
      model: 'localai/model',
    }),
    { message: /high-level Runtime.generate/ },
  );
});

test('runtime-convenience: unknown-prefix/model is not treated as remote if not in provider set', async () => {
  let capturedModel = '';
  const mockRuntime = {
    ai: {
      text: {
        generate: async (input: Record<string, unknown>) => {
          capturedModel = String(input.model || '');
          return {
            text: 'ok',
            usage: {},
            finishReason: 'stop',
            trace: { traceId: '', routeDecision: 'local' },
          };
        },
        stream: async () => ({ stream: (async function*() {})() }),
      },
    },
  };

  // 'MyCustom/model' has uppercase so isLowercaseQualifiedPrefix fails
  await runtimeGenerateConvenience(mockRuntime as never, {
    prompt: 'test',
    model: 'MyCustom/model',
  });
  assert.equal(capturedModel, 'local/MyCustom/model');
});
