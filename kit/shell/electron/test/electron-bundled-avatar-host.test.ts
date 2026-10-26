import { describe, expect, it, vi } from 'vitest';
import { registerNimiElectronRuntimeBridge } from '../src/main/index.js';
import * as desktopControl from '../src/main/desktop-control-host.js';
import type { RuntimeGrpcBridgeStreamHandlers } from '../src/main/types.js';
import { NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID, NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { FakeIpcMain, invokeBridge } from './electron-shell-test-utils.js';

function rendererEvent(url: string) {
  const parsed = new URL(url);
  return {
    senderFrame: { origin: parsed.origin, url: parsed.toString() },
    sender: { send: () => undefined },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function embodimentPullBridge() {
  const started = deferred<void>();
  const closed = deferred<void>();
  const mutationStarted = deferred<void>();
  const mutation = deferred<{ applied: boolean }>();
  let handlers: RuntimeGrpcBridgeStreamHandlers | undefined;
  const nativeCancel = vi.fn(() => { closed.resolve(); });
  const factory = vi.spyOn(desktopControl, 'createNimiElectronDesktopControlHost').mockReturnValue({
    bundledAvatarServerStream: (request) => {
      expect(request.methodId).toBe('/nimi.runtime.v1.RuntimeAgentService/SubscribeLocalAppEmbodimentEvents');
      return {
        start: (current: RuntimeGrpcBridgeStreamHandlers) => { handlers = current; started.resolve(); },
        cancel: nativeCancel,
        closed: closed.promise,
      };
    },
  } as desktopControl.NimiElectronDesktopControlHost);
  const ipcMain = new FakeIpcMain();
  const event = rendererEvent('http://127.0.0.1:1427/');
  let invalidate: ((sender: object) => void | Promise<void>) | undefined;
  const bridge = registerNimiElectronRuntimeBridge({
    appId: 'nimi.desktop', runtimeEndpoint: 'protected-desktop-control',
    allowedOrigins: ['http://127.0.0.1:1420'], allowedRendererUrls: ['http://127.0.0.1:1420/'], ipcMain,
    bundledAvatarHost: {
      rendererUrl: 'http://127.0.0.1:1427/', authorizeSender: (candidate) => candidate === event,
      subscribeSenderInvalidation: (listener) => { invalidate = listener; return () => undefined; },
      standardShellHost: { capabilitySetRef: NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID },
      commandHandlers: {
        'avatar.test.committed-mutation': async () => { mutationStarted.resolve(); return mutation.promise; },
      },
    },
  });
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.embodimentSubscribe'];
  return {
    started: started.promise, nativeCancel, mutationStarted: mutationStarted.promise, mutation,
    invokeMutation: () => invokeBridge(ipcMain, event, { command: 'avatar.test.committed-mutation', payload: {} }),
    async open() {
      const result = await invokeBridge(ipcMain, event, { command, payload: { payload: {
        agentHandle: `agent_ref_${'a'.repeat(43)}`, conversationAnchorId: 'anchor-1', afterSequence: '0',
      } } }) as { subscriptionId: string };
      return result.subscriptionId;
    },
    next: (subscriptionId: string) => invokeBridge(ipcMain, event, { command, payload: { payload: { action: 'next', subscriptionId } } }),
    invalidate: () => Promise.resolve(invalidate?.(event.sender)),
    end() { handlers?.onEnd(); closed.resolve(); },
    async cleanup() {
      mutation.resolve({ applied: true });
      await bridge.disposeFormalAppResources?.();
      bridge.unregister();
      factory.mockRestore();
    },
  };
}

describe('Desktop-supervised bundled Avatar host profile', () => {
  it('returns the existing sender terminal error when an in-flight embodiment pull ends during invalidation', async () => {
    const fixture = embodimentPullBridge();
    try {
      const subscriptionId = await fixture.open();
      const next = fixture.next(subscriptionId);
      const rejected = expect(next).rejects.toMatchObject({ reasonCode: 'electron-bundled-avatar-sender-invalidated' });
      await fixture.started;
      await fixture.invalidate();
      await rejected;
      expect(fixture.nativeCancel).toHaveBeenCalled();
    } finally { await fixture.cleanup(); }
  });

  it('preserves ordinary embodiment EOF while the Avatar sender remains active', async () => {
    const fixture = embodimentPullBridge();
    try {
      const subscriptionId = await fixture.open();
      const next = fixture.next(subscriptionId);
      await fixture.started;
      fixture.end();
      await expect(next).resolves.toEqual({ subscriptionId, completed: true });
    } finally { await fixture.cleanup(); }
  });

  it('does not rewrite an admitted committed mutation result after sender invalidation', async () => {
    const fixture = embodimentPullBridge();
    try {
      const committed = fixture.invokeMutation();
      await fixture.mutationStarted;
      await fixture.invalidate();
      fixture.mutation.resolve({ applied: true });
      await expect(committed).resolves.toEqual({ applied: true });
    } finally { await fixture.cleanup(); }
  });

  it('admits the packaged standard-scheme origin for the exact Avatar sender', async () => {
    const ipcMain = new FakeIpcMain();
    const avatarEvent = {
      senderFrame: { origin: 'nimi-app://avatar', url: 'nimi-app://avatar/index.html' },
      sender: { send: () => undefined },
    };
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.desktop',
      runtimeEndpoint: 'protected-desktop-control',
      allowedOrigins: ['nimi-app://desktop'],
      allowedRendererUrls: ['nimi-app://desktop/index.html'],
      ipcMain,
      bundledAvatarHost: {
        rendererUrl: 'nimi-app://avatar/index.html',
        authorizeSender: (event) => event === avatarEvent,
        subscribeSenderInvalidation: () => () => undefined,
        commandHandlers: { nimi_avatar_get_launch_context: ({ appId }) => ({ appId }) },
      },
    });
    await expect(invokeBridge(ipcMain, avatarEvent, {
      command: 'nimi_avatar_get_launch_context', payload: {},
    })).resolves.toEqual({ appId: 'nimi.avatar' });
  });

  it('derives the fixed Avatar app id only from the exact authorized sender', async () => {
    const ipcMain = new FakeIpcMain();
    const avatarEvent = rendererEvent('http://127.0.0.1:1427/');
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.desktop',
      runtimeEndpoint: 'protected-desktop-control',
      allowedOrigins: ['http://127.0.0.1:1420'],
      allowedRendererUrls: ['http://127.0.0.1:1420/'],
      ipcMain,
      commandHandlers: {
        'desktop.test.identity': ({ appId }) => ({ appId }),
      },
      bundledAvatarHost: {
        rendererUrl: 'http://127.0.0.1:1427/',
        authorizeSender: (event) => event === avatarEvent,
        subscribeSenderInvalidation: () => () => undefined,
        commandHandlers: {
          'avatar.test.identity': ({ appId }) => ({ appId }),
        },
      },
    });

    await expect(invokeBridge(
      ipcMain,
      avatarEvent,
      { command: 'avatar.test.identity', payload: {} },
    )).resolves.toEqual({ appId: 'nimi.avatar' });

    await expect(invokeBridge(
      ipcMain,
      rendererEvent('http://127.0.0.1:1420/'),
      { command: 'desktop.test.identity', payload: {} },
    )).resolves.toEqual({ appId: 'nimi.desktop' });

    await expect(invokeBridge(
      ipcMain,
      rendererEvent('http://127.0.0.1:1420/'),
      { command: 'avatar.test.identity', payload: {} },
    )).rejects.toMatchObject({ reasonCode: 'unsupported-electron-shell-command' });
  });

  it('does not widen an authorized sender after navigation', async () => {
    const ipcMain = new FakeIpcMain();
    const avatarEvent = rendererEvent('http://127.0.0.1:1427/other');
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.desktop',
      runtimeEndpoint: 'protected-desktop-control',
      allowedOrigins: ['http://127.0.0.1:1420'],
      allowedRendererUrls: ['http://127.0.0.1:1420/'],
      ipcMain,
      bundledAvatarHost: {
        rendererUrl: 'http://127.0.0.1:1427/avatar',
        authorizeSender: (event) => event === avatarEvent,
        subscribeSenderInvalidation: () => () => undefined,
        commandHandlers: {
          'avatar.test.identity': ({ appId }) => ({ appId }),
        },
      },
    });

    await expect(invokeBridge(
      ipcMain,
      avatarEvent,
      { command: 'avatar.test.identity', payload: {} },
    )).rejects.toMatchObject({ reasonCode: 'electron-bundled-avatar-navigation-integrity-failed' });
  });

  it('tombstones an invalidated sender before async disposal and never recreates its scope', async () => {
    const ipcMain = new FakeIpcMain();
    const avatarEvent = rendererEvent('http://127.0.0.1:1427/');
    let invalidateSender: ((sender: object) => void | Promise<void>) | undefined;
    let releasePolicy: (() => void) | undefined;
    let markPolicyStarted: (() => void) | undefined;
    const policyStarted = new Promise<void>((resolve) => {
      markPolicyStarted = resolve;
    });
    const policyGate = new Promise<void>((resolve) => {
      releasePolicy = resolve;
    });
    const handler = vi.fn(() => ({ accepted: true }));
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.desktop',
      runtimeEndpoint: 'protected-desktop-control',
      allowedOrigins: ['http://127.0.0.1:1420'],
      allowedRendererUrls: ['http://127.0.0.1:1420/'],
      ipcMain,
      bundledAvatarHost: {
        rendererUrl: 'http://127.0.0.1:1427/',
        authorizeSender: (event) => event === avatarEvent,
        subscribeSenderInvalidation: (listener) => {
          invalidateSender = listener;
          return () => undefined;
        },
        commandPolicy: async () => {
          markPolicyStarted?.();
          await policyGate;
          return { allow: true };
        },
        commandHandlers: {
          'avatar.test.race': handler,
        },
      },
    });

    const racedInvoke = invokeBridge(
      ipcMain,
      avatarEvent,
      { command: 'avatar.test.race', payload: {} },
    );
    await policyStarted;
    const invalidation = Promise.resolve(invalidateSender?.(avatarEvent.sender));
    releasePolicy?.();

    await expect(racedInvoke).rejects.toMatchObject({
      reasonCode: 'electron-bundled-avatar-sender-invalidated',
    });
    await invalidation;
    expect(handler).not.toHaveBeenCalled();
    await expect(invokeBridge(
      ipcMain,
      avatarEvent,
      { command: 'avatar.test.race', payload: {} },
    )).rejects.toMatchObject({
      reasonCode: 'electron-bundled-avatar-sender-invalidated',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects bundled Avatar registration outside the Desktop host', () => {
    expect(() => registerNimiElectronRuntimeBridge({
      appId: 'acme.widget',
      runtimeEndpoint: 'protected-local-app',
      allowedOrigins: ['http://127.0.0.1:1421'],
      allowedRendererUrls: ['http://127.0.0.1:1421/'],
      ipcMain: new FakeIpcMain(),
      bundledAvatarHost: {
        rendererUrl: 'http://127.0.0.1:1427/',
        authorizeSender: () => true,
        subscribeSenderInvalidation: () => () => undefined,
      },
    })).toThrowError(expect.objectContaining({
      reasonCode: 'electron-bundled-avatar-desktop-host-required',
    }));
  });
});
