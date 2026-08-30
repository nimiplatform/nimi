import { describe, expect, it, vi } from 'vitest';
import { registerNimiElectronRuntimeBridge } from '../src/main/index.js';
import { FakeIpcMain, invokeBridge } from './electron-shell-test-utils.js';

function rendererEvent(url: string) {
  const parsed = new URL(url);
  return {
    senderFrame: { origin: parsed.origin, url: parsed.toString() },
    sender: { send: () => undefined },
  };
}

describe('Desktop-supervised bundled Avatar host profile', () => {
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
