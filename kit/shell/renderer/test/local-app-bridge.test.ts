import { afterEach, describe, expect, it } from 'vitest';
import { createNimiClient } from '@nimiplatform/kit/core/sdk-contract';

import { createNimiLocalAppStandardShellSurface } from '../src/bridge/index.js';

afterEach(() => {
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
});

describe('renderer local-app standard-shell surface', () => {
  it('is consumed directly by the SDK without an app-local adapter', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string) => {
        if (command.endsWith('sessionStatus')) {
          return { state: 'ready', reasonCode: 'action-executed', retryable: false };
        }
        throw new Error(`unexpected command ${command}`);
      },
      listen: () => () => {},
    };
    const client = createNimiClient({
      localApp: {
        standardShell: createNimiLocalAppStandardShellSurface(),
      },
    });
    await expect(client.auth.status()).resolves.toMatchObject({
      mode: 'local-app',
      state: 'session-bound',
      reasonCode: 'action-executed',
      retryable: false,
    });
  });

  it('emits only product permission ids and declared request fields', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        return {
          state: 'granted',
          permissionId: 'agents.interact',
          canRequest: false,
          reasonCode: 'action-executed',
          agents: [{ agentHandle: 'lash_owner_issued', displayName: 'Owned Agent' }],
        };
      },
      listen: () => () => {},
    };
    const surface = createNimiLocalAppStandardShellSurface();
    await expect(surface.permission.status({ permissionId: 'agents.interact' })).resolves.toMatchObject({
      state: 'granted',
      agents: [{ agentHandle: 'lash_owner_issued', displayName: 'Owned Agent' }],
    });
    await surface.permission.request({ permissionId: 'agents.interact', reason: 'Continue the conversation' });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.permissionStatus',
        payload: { payload: { permissionId: 'agents.interact' } },
      },
      {
        command: 'nimi.shell.localApp.permissionRequest',
        payload: { payload: { permissionId: 'agents.interact', reason: 'Continue the conversation' } },
      },
    ]);
    expect(surface).not.toHaveProperty('agent');
    expect(surface).not.toHaveProperty('artifacts');
  });

  it('rejects a permission reason beyond 240 UTF-8 bytes before host invocation', () => {
    const invocations: unknown[] = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (...args: unknown[]) => { invocations.push(args); return {}; },
      listen: () => () => {},
    };
    expect(() => createNimiLocalAppStandardShellSurface().permission.request({
      permissionId: 'agents.interact',
      reason: '需'.repeat(81),
    })).toThrowError(/reason is invalid/u);
    expect(invocations).toEqual([]);
  });

  it('rejects protected authority material in a permission projection', async () => {
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async () => ({
        state: 'unavailable',
        permissionId: 'agents.interact',
        canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
        agents: [],
        grantId: 'forbidden',
      }),
      listen: () => () => {},
    };
    await expect(createNimiLocalAppStandardShellSurface().permission.status({
      permissionId: 'agents.interact',
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
    });
  });

  it('projects conversation events through a cancellable bounded async subscription', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    let eventHandler: ((event: { payload: unknown }) => void) | undefined;
    let unlistenCount = 0;
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if ((payload as { payload?: { action?: string } })?.payload?.action === 'cancel') {
          return { subscriptionId: 'conversation-1', closed: true };
        }
        return { subscriptionId: 'conversation-1', eventName: 'local-app-conversation.conversation-1' };
      },
      listen: (_eventName: string, handler: (event: { payload: unknown }) => void) => {
        eventHandler = handler;
        return () => { unlistenCount += 1; };
      },
    };
    const subscription = await createNimiLocalAppStandardShellSurface().conversation.subscribe({
      agentHandle: 'lash_owner_issued',
      conversationAnchorId: 'anchor-1',
    });
    const iterator = subscription.events[Symbol.asyncIterator]();
    const next = iterator.next();
    eventHandler?.({
      payload: {
        subscriptionId: 'conversation-1',
        eventType: 'next',
        event: {
          eventType: 1,
          sequence: '1',
          messageId: 'message-1',
          messageType: 'runtime.agent.turn.delta',
          payload: { text: 'hello' },
          reasonCode: 'ACTION_EXECUTED',
          traceId: 'trace-1',
          timestampUnixMs: 123,
        },
      },
    });
    await expect(next).resolves.toMatchObject({ done: false, value: { sequence: '1' } });
    await subscription.cancel();
    await subscription.cancel();
    expect(unlistenCount).toBe(1);
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.localApp.conversationSubscribe',
        payload: { payload: { agentHandle: 'lash_owner_issued', conversationAnchorId: 'anchor-1' } },
      },
      {
        command: 'nimi.shell.localApp.conversationSubscribe',
        payload: { payload: { action: 'cancel', subscriptionId: 'conversation-1' } },
      },
    ]);
  });

  it('carries bounded app-private storage documents without exposing a path or root', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__ = {
      invoke: async (command: string, payload: unknown) => {
        invocations.push({ command, payload });
        if (command.endsWith('removeJson')) return { removed: false };
        return { value: { token: 'app-content' }, sizeBytes: 23 };
      },
      listen: () => () => {},
    };
    const storage = createNimiLocalAppStandardShellSurface().storage;
    await expect(storage.writeJson('agent-chat/state.json', { token: 'app-content' })).resolves.toEqual({
      value: { token: 'app-content' },
      sizeBytes: 23,
    });
    await expect(storage.removeJson('agent-chat/state.json')).resolves.toEqual({ removed: false });
    expect(invocations).toEqual([
      {
        command: 'nimi.shell.storage.writeJson',
        payload: { payload: { relativePath: 'agent-chat/state.json', value: { token: 'app-content' } } },
      },
      {
        command: 'nimi.shell.storage.removeJson',
        payload: { payload: { relativePath: 'agent-chat/state.json' } },
      },
    ]);
    expect(() => storage.readJson('../escape.json')).toThrow(/relativePath is invalid/u);
  });
});
