import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '../../src/types/index.js';
import { createTauriIpcTransport } from '../../src/runtime/transports/tauri-ipc';
import { asNimiError } from '../../src/runtime/errors';
import type { RuntimeUnaryCall, RuntimeOpenStreamCall } from '../../src/runtime/types';

// SDK half of the runtime-transport bridge contract. The renderer platform owner
// (`installNimiShellRuntimeBridge()` in @nimiplatform/kit/shell/renderer/bridge)
// publishes `globalThis.__NIMI_TAURI_RUNTIME__ = { invoke, listen }`; the SDK
// tauri-ipc transport must resolve that hook for unary + stream and fail closed —
// never guess or synthesize a listener — when invoke/listen are absent. The Kit
// half (that the bridge installs the hook) is covered by kit's runtime-bridge test.

type RuntimeHookListenHandler = (event: { payload: unknown }) => void;
type RuntimeHook = {
  invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  listen?: (eventName: string, handler: RuntimeHookListenHandler) => (() => void) | Promise<() => void>;
};
type MutableGlobal = typeof globalThis & { __NIMI_TAURI_RUNTIME__?: RuntimeHook };

function installRuntimeHook(hook: RuntimeHook | null): () => void {
  const target = globalThis as MutableGlobal;
  const previous = target.__NIMI_TAURI_RUNTIME__;
  if (hook) {
    target.__NIMI_TAURI_RUNTIME__ = hook;
  } else {
    delete target.__NIMI_TAURI_RUNTIME__;
  }
  return () => {
    if (previous === undefined) {
      delete target.__NIMI_TAURI_RUNTIME__;
    } else {
      target.__NIMI_TAURI_RUNTIME__ = previous;
    }
  };
}

test('tauri-ipc: resolves the Kit __NIMI_TAURI_RUNTIME__ hook for stream open (no LISTEN_MISSING)', async () => {
  const listenedEvents: string[] = [];
  const handlers = new Map<string, RuntimeHookListenHandler>();
  const restore = installRuntimeHook({
    invoke: async (command: string) => {
      if (command.includes('stream_open')) {
        const streamId = 'kit-hook-stream';
        setTimeout(() => {
          handlers.get(`runtime_bridge:stream:${streamId}`)?.({
            payload: { streamId, eventType: 'completed' },
          });
        }, 0);
        return { streamId };
      }
      return {};
    },
    listen: (eventName: string, handler: RuntimeHookListenHandler) => {
      listenedEvents.push(eventName);
      handlers.set(eventName, handler);
      return () => {
        handlers.delete(eventName);
      };
    },
  });

  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    const stream = await transport.openStream({
      methodId: 'test',
      request: new Uint8Array(0),
      metadata: {} as RuntimeOpenStreamCall['metadata'],
    });
    // Resolution proof: the SDK subscribed via the Kit hook's listen, not a guess.
    assert.equal(listenedEvents.length, 1);
    assert.match(listenedEvents[0] ?? '', /runtime_bridge:stream:kit-hook-stream/);
    // The stream is real: it completes when the bridge emits the completed event.
    const result = await stream[Symbol.asyncIterator]().next();
    assert.equal(result.done, true);
  } finally {
    restore();
  }
});

test('tauri-ipc: fails closed with LISTEN_MISSING when the hook exposes no listen', async () => {
  const restore = installRuntimeHook({
    invoke: async () => ({ streamId: 'x' }),
  });
  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await assert.rejects(
      () => transport.openStream({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeOpenStreamCall['metadata'],
      }),
      (error: unknown) =>
        asNimiError(error, { source: 'sdk' }).reasonCode === ReasonCode.SDK_RUNTIME_TAURI_LISTEN_MISSING,
    );
  } finally {
    restore();
  }
});

test('tauri-ipc: fails closed with INVOKE_MISSING when no invoke source is present', async () => {
  const restore = installRuntimeHook(null);
  try {
    const transport = createTauriIpcTransport({ type: 'tauri-ipc' });
    await assert.rejects(
      () => transport.invokeUnary({
        methodId: 'test',
        request: new Uint8Array(0),
        metadata: {} as RuntimeUnaryCall['metadata'],
      }),
      (error: unknown) =>
        asNimiError(error, { source: 'sdk' }).reasonCode === ReasonCode.SDK_RUNTIME_TAURI_INVOKE_MISSING,
    );
  } finally {
    restore();
  }
});
