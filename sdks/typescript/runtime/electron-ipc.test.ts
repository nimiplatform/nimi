import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentEventType, RuntimeHealthStatus } from '../core-generated/runtime-typed-client';
import {
  AgentEvent,
  SubscribeAgentEventsRequest,
} from '../core-generated/runtime-protobuf/runtime/v1/agent_service';
import {
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
} from '../core-generated/runtime-protobuf/runtime/v1/audit';
import { createRuntimeElectronIpcTransport, Runtime } from './index';
import { ReasonCode } from '../types';

type ElectronInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type ElectronListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => (() => void);

type ElectronTestGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: {
    invoke?: ElectronInvoke;
    listen?: ElectronListen;
  };
  __NIMI_TAURI_RUNTIME__?: {
    invoke?: ElectronInvoke;
    listen?: ElectronListen;
  };
};

const STANDARD_ELECTRON_RUNTIME_COMMANDS = {
  unary: 'nimi.shell.runtime.unary',
  streamOpen: 'nimi.shell.runtime.stream.open',
  streamClose: 'nimi.shell.runtime.stream.close',
  eventNamespace: 'nimi.shell.runtime',
} as const;

function installElectronTestHook(input: { invoke?: ElectronInvoke; listen?: ElectronListen }): () => void {
  const target = globalThis as ElectronTestGlobal;
  const previous = target.__NIMI_ELECTRON_TEST__;
  target.__NIMI_ELECTRON_TEST__ = input;
  return () => {
    if (previous) {
      target.__NIMI_ELECTRON_TEST__ = previous;
    } else {
      delete target.__NIMI_ELECTRON_TEST__;
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

test('electron-ipc Runtime transport encodes and decodes protobuf unary calls', async () => {
  let capturedPayload: Record<string, unknown> = {};
  const restore = installElectronTestHook({
    invoke: async (command, payload) => {
      assert.equal(command, STANDARD_ELECTRON_RUNTIME_COMMANDS.unary);
      capturedPayload = unwrapPayload(payload);
      return {
        responseBytesBase64: toBase64(GetRuntimeHealthResponse.toBinary(GetRuntimeHealthResponse.create({
          status: RuntimeHealthStatus.READY,
          reason: 'electron-ok',
        }))),
        responseMetadata: { 'x-nimi-runtime-version': '0.5.0' },
      };
    },
  });

  try {
    const runtime = new Runtime({
      appId: 'nimi.electron.test',
      transport: { type: 'electron-ipc' },
    });

    const health = await runtime.ready();

    assert.equal(health.status, RuntimeHealthStatus.READY);
    assert.equal(health.reason, 'electron-ok');
    assert.equal(capturedPayload.methodId, '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
    assert.deepEqual(GetRuntimeHealthRequest.fromBinary(fromBase64(capturedPayload.requestBytesBase64)), {});
    assert.equal((capturedPayload.metadata as { appId?: string } | undefined)?.appId, undefined);
    assert.equal((capturedPayload.metadata as { protocolVersion?: string }).protocolVersion, '1.0.0');
    assert.equal(capturedPayload.appSession, undefined);
    assert.equal(capturedPayload.protectedAccessToken, undefined);
    assert.equal(capturedPayload.authorization, undefined);
    assert.equal(runtime.runtimeVersion(), '0.5.0');
    assert.equal(runtime.versionCompatibility().state, 'compatible');
  } finally {
    restore();
  }
});

test('electron-ipc Runtime unary abort requests bottom transport cancellation before settling', async () => {
  const controller = new AbortController();
  let rejectBottomUnary: ((error: unknown) => void) | undefined;
  let markBottomUnaryStarted: (() => void) | undefined;
  const bottomUnaryStarted = new Promise<void>((resolve) => {
    markBottomUnaryStarted = resolve;
  });
  const cancellationPayloads: Record<string, unknown>[] = [];
  const restore = installElectronTestHook({
    invoke: async (command, payload) => {
      assert.equal(command, STANDARD_ELECTRON_RUNTIME_COMMANDS.unary);
      const request = unwrapPayload(payload);
      if (request.cancel === true) {
        cancellationPayloads.push(request);
        rejectBottomUnary?.({ reasonCode: 'runtime-request-canceled' });
        return { canceled: true };
      }
      markBottomUnaryStarted?.();
      return new Promise<unknown>((_resolve, reject) => {
        rejectBottomUnary = reject;
      });
    },
  });

  const transport = createRuntimeElectronIpcTransport();
  const operation = transport.unary({
    methodId: '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
    body: GetRuntimeHealthRequest.create(),
    signal: controller.signal,
  });
  try {
    await bottomUnaryStarted;
    controller.abort(new DOMException('voice input canceled', 'AbortError'));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(cancellationPayloads.length, 1);
    assert.equal(cancellationPayloads[0]?.cancel, true);
    assert.match(String(cancellationPayloads[0]?.requestId || ''), /^runtime-client-unary-/u);
    await assert.rejects(
      operation,
      (error: unknown) => (error as { name?: string }).name === 'AbortError',
    );
  } finally {
    rejectBottomUnary?.(new Error('test cleanup'));
    await operation.catch(() => undefined);
    restore();
  }
});

test('electron-ipc Runtime transport decodes protobuf server streams', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  let capturedPayload: Record<string, unknown> = {};
  const restore = installElectronTestHook({
    invoke: async (command, payload) => {
      if (command === STANDARD_ELECTRON_RUNTIME_COMMANDS.streamOpen) {
        capturedPayload = unwrapPayload(payload);
        const streamId = String(capturedPayload.streamId || '');
        assert.match(streamId, /^runtime-client-stream-/);
        listeners.get(`${STANDARD_ELECTRON_RUNTIME_COMMANDS.eventNamespace}:stream:${streamId}`)?.({
          payload: {
            streamId,
            eventType: 'next',
            payloadBytesBase64: toBase64(AgentEvent.toBinary(AgentEvent.create({
              agentId: 'agent-electron',
              sequence: '42',
              eventType: AgentEventType.LIFECYCLE,
            }))),
          },
        });
        listeners.get(`${STANDARD_ELECTRON_RUNTIME_COMMANDS.eventNamespace}:stream:${streamId}`)?.({
          payload: {
            streamId,
            eventType: 'completed',
          },
        });
        return { streamId };
      }
      if (command === STANDARD_ELECTRON_RUNTIME_COMMANDS.streamClose) {
        return {};
      }
      throw new Error(`unexpected electron command: ${command}`);
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
      appId: 'nimi.electron.test',
      transport: { type: 'electron-ipc' },
    });
    const events = [];

    for await (const event of runtime.agents.subscribeAgentEvents({
      agentId: 'agent-electron',
      cursor: '41',
      eventFilters: [],
    })) {
      events.push(event);
    }

    assert.equal(capturedPayload.methodId, '/nimi.runtime.v1.RuntimeAgentService/SubscribeAgentEvents');
    assert.deepEqual(SubscribeAgentEventsRequest.fromBinary(fromBase64(capturedPayload.requestBytesBase64)), {
      agentId: 'agent-electron',
      cursor: '41',
      eventFilters: [],
    });
    assert.equal((capturedPayload.metadata as { appId?: string } | undefined)?.appId, undefined);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.agentId, 'agent-electron');
    assert.equal(events[0]?.eventType, AgentEventType.LIFECYCLE);
  } finally {
    restore();
  }
});

test('electron-ipc Runtime transport fails closed when invoke is unavailable and does not spoof Tauri', async () => {
  const target = globalThis as ElectronTestGlobal;
  const previousTauri = target.__NIMI_TAURI_RUNTIME__;
  target.__NIMI_TAURI_RUNTIME__ = {
    invoke: async () => {
      throw new Error('electron transport must not use tauri hook');
    },
  };
  const restore = installElectronTestHook({});
  try {
    const runtime = new Runtime({ transport: { type: 'electron-ipc' } });
    await assert.rejects(
      runtime.ready(),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'SDK_RUNTIME_ELECTRON_INVOKE_MISSING');
        return true;
      },
    );
  } finally {
    restore();
    if (previousTauri) {
      target.__NIMI_TAURI_RUNTIME__ = previousTauri;
    } else {
      delete target.__NIMI_TAURI_RUNTIME__;
    }
  }
});

test('electron-ipc Runtime transport rejects authorization in caller metadata', async () => {
  const restore = installElectronTestHook({
    invoke: async () => {
      throw new Error('authorization metadata validation should run before electron invoke');
    },
  });

  try {
    const runtime = new Runtime({
      transport: { type: 'electron-ipc' },
      authMetadata: () => ({ authorization: 'Bearer electron-token' }),
    });
    await assert.rejects(
      runtime.ready(),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_TRANSPORT_INVALID
        && String((error as { message?: string }).message || '').includes('host-owned auth channel'),
    );
  } finally {
    restore();
  }
});

test('electron-ipc Runtime transport rejects sensitive token and session metadata from renderer callers', async () => {
  const restore = installElectronTestHook({
    invoke: async () => {
      throw new Error('sensitive metadata validation should run before electron invoke');
    },
  });

  try {
    for (const metadata of [
      { 'x-nimi-access-token-id': 'token-id' },
      { 'x-nimi-access-token-secret': 'token-secret' },
      { 'x-nimi-session-id': 'session-id' },
      { 'x-nimi-session-token': 'session-token' },
      { accessTokenId: 'token-id' },
      { sessionToken: 'session-token' },
    ]) {
      const runtime = new Runtime({
        transport: { type: 'electron-ipc' },
        authMetadata: () => metadata,
      });
      await assert.rejects(
        runtime.ready(),
        (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_TRANSPORT_INVALID
          && String((error as { message?: string }).message || '').includes('host-owned auth channel'),
      );
    }
  } finally {
    restore();
  }
});

test('electron-ipc Runtime transport rejects host-owned identity metadata from renderer callers', async () => {
  const restore = installElectronTestHook({
    invoke: async () => {
      throw new Error('identity metadata validation should run before electron invoke');
    },
  });

  try {
    for (const metadata of [
      { appId: 'evil.app' },
      { participantId: 'evil.participant' },
      { callerKind: 'desktop-host' },
      { callerId: 'evil.caller' },
      { 'x-nimi-app-id': 'evil.app' },
      { 'x-nimi-participant-id': 'evil.participant' },
      { 'x-nimi-caller-kind': 'desktop-host' },
      { 'x-nimi-caller-id': 'evil.caller' },
    ]) {
      const runtime = new Runtime({
        transport: { type: 'electron-ipc' },
        authMetadata: () => metadata,
      });
      await assert.rejects(
        runtime.ready(),
        (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_TRANSPORT_INVALID
          && String((error as { message?: string }).message || '').includes('host-owned identity channel'),
      );
    }
  } finally {
    restore();
  }
});

test('electron-ipc Runtime transport registers stream id mismatch as a public reason code', async () => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const restore = installElectronTestHook({
    invoke: async (command, payload) => {
      if (command === STANDARD_ELECTRON_RUNTIME_COMMANDS.streamOpen) {
        const requested = String(unwrapPayload(payload).streamId || '');
        return { streamId: `${requested}-other` };
      }
      throw new Error(`unexpected electron command: ${command}`);
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
      appId: 'nimi.electron.test',
      transport: { type: 'electron-ipc' },
    });
    await assert.rejects(
      async () => {
        for await (const _event of runtime.agents.subscribeAgentEvents({
          agentId: 'agent-electron',
          cursor: '',
          eventFilters: [],
        })) {
          // stream open should fail before yielding
        }
      },
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_RUNTIME_ELECTRON_STREAM_ID_MISMATCH,
    );
  } finally {
    restore();
  }
});
