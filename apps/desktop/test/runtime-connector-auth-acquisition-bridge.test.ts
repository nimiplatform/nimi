import assert from 'node:assert/strict';
import test from 'node:test';

import { desktopManagedConnectorCredentialAcquisitionHost } from '../src/shell/renderer/bridge/runtime-bridge/connector-auth-acquisition.js';
import {
  DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
  DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND,
  DESKTOP_MANAGED_CONNECTOR_AUTH_PENDING_EVENT_PREFIX,
} from '../src/shell/shared/connector-auth-acquisition-contract.js';

test('Desktop renderer connector-auth bridge carries only typed pending and result projections', async () => {
  type EventHandler = (event: { payload: unknown }) => void;
  const root = globalThis as unknown as {
    window?: { __NIMI_ELECTRON_TEST__?: unknown };
    __NIMI_ELECTRON_TEST__?: unknown;
  };
  const previousHook = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  const order: string[] = [];
  let listener: EventHandler | undefined;
  let unsubscribed = 0;
  let returnSecret = false;
  const hook = {
    listen(eventName: string, handler: EventHandler) {
      order.push(`listen:${eventName}`);
      listener = handler;
      return () => {
        unsubscribed += 1;
      };
    },
    async invoke(command: string, payload: unknown) {
      order.push(`invoke:${command}`);
      assert.equal(command, DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND);
      const envelope = payload as { payload: Record<string, unknown> };
      assert.deepEqual(Object.keys(envelope.payload).sort(), [
        'connectorId',
        'endpoint',
        'label',
        'profileId',
        'provider',
        'requestId',
      ]);
      listener?.({
        payload: {
          userCode: 'USER-CODE',
          verificationUrl: 'https://auth.openai.com/device',
          expiresInSeconds: 60,
          pollIntervalSeconds: 3,
        },
      });
      return returnSecret
        ? {
            profileId: 'openai_codex',
            providerAuthProfile: 'openai_codex',
            connectorId: 'connector-1',
            accessToken: 'must-not-project',
          }
        : {
            profileId: 'openai_codex',
            providerAuthProfile: 'openai_codex',
            connectorId: 'connector-1',
          };
    },
  };
  try {
    root.__NIMI_ELECTRON_TEST__ = hook;
    root.window = { __NIMI_ELECTRON_TEST__: hook };
    const pending: unknown[] = [];
    const result = await desktopManagedConnectorCredentialAcquisitionHost
      .acquireManagedConnectorCredential({
        profileId: 'openai_codex',
        connectorId: 'connector-1',
        provider: 'openai_codex',
        endpoint: 'https://chatgpt.com/backend-api/codex',
        label: 'Codex',
        onPending: (state) => pending.push(state),
      });

    assert.deepEqual(result, {
      profileId: 'openai_codex',
      providerAuthProfile: 'openai_codex',
      connectorId: 'connector-1',
    });
    assert.equal(order[0]?.startsWith(`listen:${DESKTOP_MANAGED_CONNECTOR_AUTH_PENDING_EVENT_PREFIX}`), true);
    assert.equal(order[1], `invoke:${DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND}`);
    assert.equal(JSON.stringify(pending).includes('token'), false);
    assert.equal(unsubscribed, 1);

    returnSecret = true;
    await assert.rejects(
      () => desktopManagedConnectorCredentialAcquisitionHost.acquireManagedConnectorCredential({
        profileId: 'openai_codex',
      }),
      /unexpected field accessToken/,
    );
    assert.equal(unsubscribed, 2);
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previousHook;
    root.window = previousWindow;
  }
});

test('Desktop renderer connector-auth bridge sends request-keyed cancellation for AbortSignal', async () => {
  const root = globalThis as unknown as {
    window?: { __NIMI_ELECTRON_TEST__?: unknown };
    __NIMI_ELECTRON_TEST__?: unknown;
  };
  const previousHook = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  const commands: string[] = [];
  let rejectAcquire: ((error: unknown) => void) | undefined;
  let acquireRequestId = '';
  const hook = {
    listen() {
      return () => undefined;
    },
    async invoke(command: string, payload: unknown) {
      commands.push(command);
      const envelope = payload as { payload: { requestId?: string } };
      if (command === DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND) {
        acquireRequestId = String(envelope.payload.requestId || '');
        return new Promise<never>((_resolve, reject) => {
          rejectAcquire = reject;
        });
      }
      assert.equal(command, DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND);
      assert.equal(envelope.payload.requestId, acquireRequestId);
      rejectAcquire?.(new DOMException('canceled in native host', 'AbortError'));
      return { canceled: true };
    },
  };
  try {
    root.__NIMI_ELECTRON_TEST__ = hook;
    root.window = { __NIMI_ELECTRON_TEST__: hook };
    const controller = new AbortController();
    const acquisition = desktopManagedConnectorCredentialAcquisitionHost.acquireManagedConnectorCredential({
      profileId: 'openai_codex',
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException('renderer abandoned acquisition', 'AbortError'));
    await assert.rejects(acquisition, (error: unknown) => (error as { name?: string }).name === 'AbortError');
    assert.deepEqual(commands.slice(0, 2), [
      DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND,
      DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
    ]);
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previousHook;
    root.window = previousWindow;
  }
});

test('Desktop renderer preserves the exact native result when cancellation loses the dispatch race', async () => {
  const root = globalThis as unknown as {
    window?: { __NIMI_ELECTRON_TEST__?: unknown };
    __NIMI_ELECTRON_TEST__?: unknown;
  };
  const previousHook = root.__NIMI_ELECTRON_TEST__;
  const previousWindow = root.window;
  const commands: string[] = [];
  let rejectAcquire: ((error: unknown) => void) | undefined;
  const hook = {
    listen() {
      return () => undefined;
    },
    async invoke(command: string) {
      commands.push(command);
      if (command === DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND) {
        return new Promise<never>((_resolve, reject) => {
          rejectAcquire = reject;
        });
      }
      assert.equal(command, DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND);
      return { canceled: false };
    },
  };
  try {
    root.__NIMI_ELECTRON_TEST__ = hook;
    root.window = { __NIMI_ELECTRON_TEST__: hook };
    const controller = new AbortController();
    const acquisition = desktopManagedConnectorCredentialAcquisitionHost.acquireManagedConnectorCredential({
      profileId: 'openai_codex',
      signal: controller.signal,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException('renderer abandoned after dispatch', 'AbortError'));
    while (commands.length < 2) await Promise.resolve();
    rejectAcquire?.(new Error('exact Runtime custody failure'));

    await assert.rejects(acquisition, (error: unknown) => {
      const record = error as { readonly name?: string; readonly details?: { readonly rawMessage?: string } };
      assert.notEqual(record.name, 'AbortError');
      assert.match(String(record.details?.rawMessage || ''), /exact Runtime custody failure/);
      return true;
    });
    assert.deepEqual(commands.slice(0, 2), [
      DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND,
      DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
    ]);
  } finally {
    root.__NIMI_ELECTRON_TEST__ = previousHook;
    root.window = previousWindow;
  }
});
