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

test('tauri-ipc: readGlobalTauriInvoke returns from __NIMI_TAURI_TEST__ hook', async () => {
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  const prevHook = g.__NIMI_TAURI_TEST__;

  g.__NIMI_TAURI_TEST__ = {
    invoke: async () => ({ responseBytesBase64: '' }),
    listen: () => () => {},
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
    if (prevHook !== undefined) {
      g.__NIMI_TAURI_TEST__ = prevHook;
    } else {
      delete g.__NIMI_TAURI_TEST__;
    }
    if (prevWindow !== undefined) {
      g.window = prevWindow;
    }
  }
});

test('tauri-ipc: openStream uses __NIMI_TAURI_RUNTIME__ hook when legacy globals are absent', async () => {
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  const prevHook = g.__NIMI_TAURI_RUNTIME__;
  const prevTauri = g.__TAURI__;
  const seenCommands: string[] = [];
  let listenedEvent = '';

  g.__NIMI_TAURI_RUNTIME__ = {
    invoke: async (command: string) => {
      seenCommands.push(command);
      if (command === 'runtime_bridge_stream_open') {
        return { streamId: 'runtime-hook-stream' };
      }
      if (command === 'runtime_bridge_stream_close') {
        return undefined;
      }
      return { responseBytesBase64: '' };
    },
    listen: (eventName: string) => {
      listenedEvent = eventName;
      return () => {};
    },
  };
  delete g.__TAURI__;
  delete g.window;

  try {
    const transport = createTauriIpcTransport({
      type: 'tauri-ipc',
    });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    const iterator = stream[Symbol.asyncIterator]();
    if (iterator.return) {
      await iterator.return();
    }
    assert.equal(listenedEvent, 'runtime_bridge:stream:runtime-hook-stream');
    assert.deepEqual(seenCommands, ['runtime_bridge_stream_open', 'runtime_bridge_stream_close']);
  } finally {
    if (prevHook !== undefined) {
      g.__NIMI_TAURI_RUNTIME__ = prevHook;
    } else {
      delete g.__NIMI_TAURI_RUNTIME__;
    }
    if (prevTauri !== undefined) {
      g.__TAURI__ = prevTauri;
    } else {
      delete g.__TAURI__;
    }
    if (prevWindow !== undefined) {
      g.window = prevWindow;
    } else {
      delete g.window;
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
// tauri-ipc: configured command namespace is authoritative
// ---------------------------------------------------------------------------

test('tauri-ipc: custom command namespace fails closed for empty message', async () => {
  let invokeCount = 0;
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokeCount++;
        if (command.startsWith('custom_ns_')) {
          throw new Error('');
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

test('tauri-ipc: custom command namespace fails closed on "unknown command" message', async () => {
  const invokedCommands: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokedCommands.push(command);
        if (command.startsWith('custom_ns_')) {
          throw new Error('unknown command custom_ns_unary');
        }
        throw new Error(`unexpected tauri command: ${command}`);
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
    assert.deepEqual(invokedCommands, ['custom_ns_unary']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: custom command namespace fails closed on "command not found"', async () => {
  const invokedCommands: string[] = [];
  const restoreTauri = installTauriRuntime({
    core: {
      invoke: async (command: string) => {
        invokedCommands.push(command);
        if (command.startsWith('custom_ns_')) {
          throw new Error('Command Not Found');
        }
        throw new Error(`unexpected tauri command: ${command}`);
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
    assert.deepEqual(invokedCommands, ['custom_ns_unary']);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: custom command namespace fails closed on error without message', async () => {
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
    assert.equal(invokeCount, 1);
  } finally {
    restoreTauri();
  }
});

test('tauri-ipc: default command namespace also fails closed on unknown command', async () => {
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
    assert.equal(invokeCount, 1);
  } finally {
    restoreTauri();
  }
});

// ---------------------------------------------------------------------------
// tauri-ipc: responseMetadataObserver branches
// ---------------------------------------------------------------------------
