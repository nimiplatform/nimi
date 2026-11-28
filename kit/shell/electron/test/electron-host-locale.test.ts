import path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  registerNimiElectronRuntimeBridge,
} from '../src/main/index.js';
import {
  NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
  withTempDir,
} from './electron-shell-test-utils.js';

const HOST_LOCALE_COMMAND = NIMI_STANDARD_SHELL_COMMANDS['shell-ui.hostLocaleGet'];

describe('Electron shell-ui.hostLocaleGet host handler', () => {
  it('reads valid host-locale.v1.json for local-app hosts and supports en and zh', async () => {
    await withTempDir('host-locale-valid', async (dir) => {
      const filePath = path.join(dir, 'host-locale.v1.json');
      await writeFile(filePath, JSON.stringify({ schemaVersion: 1, locale: 'en' }), 'utf8');

      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.harness',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          hostLocale: { filePath },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
      })).resolves.toEqual({ locale: 'en' });

      await writeFile(filePath, JSON.stringify({ schemaVersion: 1, locale: 'zh' }), 'utf8');
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
        payload: {},
      })).resolves.toEqual({ locale: 'zh' });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
        payload: { payload: {} },
      })).resolves.toEqual({ locale: 'zh' });
    });
  });

  it('admits shell-ui.hostLocaleGet for the bundled Avatar capability set', async () => {
    await withTempDir('host-locale-bundled-avatar', async (dir) => {
      const filePath = path.join(dir, 'host-locale.v1.json');
      await writeFile(filePath, JSON.stringify({ schemaVersion: 1, locale: 'en' }), 'utf8');

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
          standardShellHost: {
            capabilitySetRef: NIMI_BUNDLED_AVATAR_STANDARD_SHELL_CAPABILITY_SET_ID,
            hostLocale: { filePath },
          },
        },
      });

      await expect(invokeBridge(ipcMain, avatarEvent, {
        command: HOST_LOCALE_COMMAND,
        payload: {},
      })).resolves.toEqual({ locale: 'en' });
    });
  });

  it('prefers standardShellHost.readHostLocale when provided and validates its result', async () => {
    let returned: unknown = 'en';
    let shouldThrow = false;
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.harness',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        readHostLocale: async () => {
          if (shouldThrow) {
            throw new Error('/private/path/host-locale.v1.json failed');
          }
          return returned as 'en' | 'zh' | null;
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: HOST_LOCALE_COMMAND,
      payload: {},
    })).resolves.toEqual({ locale: 'en' });

    returned = 'zh';
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: HOST_LOCALE_COMMAND,
      payload: {},
    })).resolves.toEqual({ locale: 'zh' });

    returned = null;
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: HOST_LOCALE_COMMAND,
      payload: {},
    })).resolves.toEqual({ locale: null });

    returned = 'fr';
    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: HOST_LOCALE_COMMAND,
      payload: {},
    })).resolves.toEqual({ locale: null });

    shouldThrow = true;
    const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
      command: HOST_LOCALE_COMMAND,
      payload: {},
    });
    expect(result).toEqual({ locale: null });
    expect(JSON.stringify(result)).not.toContain('/private/path');
  });

  it('returns { locale: null } when host-locale.v1.json is missing without disclosing paths', async () => {
    await withTempDir('host-locale-missing', async (dir) => {
      const missingPath = path.join(dir, 'missing', 'host-locale.v1.json');
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.harness',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          hostLocale: { filePath: missingPath },
        },
      });

      const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
        payload: {},
      });
      expect(result).toEqual({ locale: null });
      expect(JSON.stringify(result)).not.toContain(dir);
    });
  });

  it('refuses symlinked ancestor directories before reading file content', async () => {
    await withTempDir('host-locale-symlink-dir', async (dir) => {
      const realDir = path.join(dir, 'real');
      const linkDir = path.join(dir, 'link');
      await mkdir(realDir);
      await symlink(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
      await writeFile(path.join(realDir, 'host-locale.v1.json'), JSON.stringify({ schemaVersion: 1, locale: 'en' }), 'utf8');

      let readAttempted = false;
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.harness',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          hostLocale: {
            filePath: path.join(linkDir, 'host-locale.v1.json'),
            readTextFile: async () => {
              readAttempted = true;
              throw new Error('must not read through symlink ancestry');
            },
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
        payload: {},
      })).resolves.toEqual({ locale: null });
      expect(readAttempted).toBe(false);
    });
  });

  it('refuses symlinked host-locale target files before reading content', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await withTempDir('host-locale-symlink-file', async (dir) => {
      const realFile = path.join(dir, 'real-locale.json');
      const linkFile = path.join(dir, 'host-locale.v1.json');
      await writeFile(realFile, JSON.stringify({ schemaVersion: 1, locale: 'en' }), 'utf8');
      await symlink(realFile, linkFile, 'file');

      let readAttempted = false;
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.harness',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          hostLocale: {
            filePath: linkFile,
            readTextFile: async () => {
              readAttempted = true;
              throw new Error('must not read symlink target');
            },
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
        payload: {},
      })).resolves.toEqual({ locale: null });
      expect(readAttempted).toBe(false);
    });
  });

  it('returns { locale: null } for corrupt, malformed, wrong-schema, unknown-locale, directory, or oversized targets', async () => {
    await withTempDir('host-locale-corrupt', async (dir) => {
      const filePath = path.join(dir, 'host-locale.v1.json');
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.harness',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          hostLocale: { filePath },
        },
      });

      for (const content of [
        '{"schemaVersion":1,"locale":"en"',
        'null',
        '[]',
        JSON.stringify({ schemaVersion: 2, locale: 'en' }),
        JSON.stringify({ schemaVersion: 1, locale: 'fr' }),
        JSON.stringify({ schemaVersion: 1, locale: 'EN' }),
        JSON.stringify({ schemaVersion: 1, locale: 'en-US' }),
        JSON.stringify({ schemaVersion: 1, locale: null }),
        JSON.stringify({ schemaVersion: 1, locale: 'en', extra: true }),
        JSON.stringify({ locale: 'en' }),
        `{"schemaVersion":1,"locale":"en"}${' '.repeat(5000)}`,
      ]) {
        await writeFile(filePath, content, 'utf8');
        const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
          command: HOST_LOCALE_COMMAND,
          payload: {},
        });
        expect(result).toEqual({ locale: null });
        expect(JSON.stringify(result)).not.toContain(dir);
      }

      const dirTarget = path.join(dir, 'as-directory');
      await mkdir(dirTarget);
      const dirIpc = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.harness',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain: dirIpc,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          hostLocale: { filePath: dirTarget },
        },
      });
      await expect(invokeBridge(dirIpc, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
        payload: {},
      })).resolves.toEqual({ locale: null });
    });
  });

  it('rejects non-empty request payloads before accessing host locale callback or disk', async () => {
    let callbackCalled = false;
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.harness',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
        readHostLocale: async () => {
          callbackCalled = true;
          return 'en';
        },
      },
    });

    for (const invalidPayload of [
      { locale: 'zh' },
      { path: '/etc/passwd' },
      { payload: { filePath: '/etc/passwd' } },
      { payload: 'invalid' },
    ]) {
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: HOST_LOCALE_COMMAND,
        payload: invalidPayload,
      })).rejects.toMatchObject({
        code: 'invalid-payload',
      });
    }

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: HOST_LOCALE_COMMAND,
      payload: { path: '/etc/passwd' },
    })).rejects.toMatchObject({
      code: 'invalid-payload',
      reasonCode: 'electron-shell-host-locale-payload-must-be-empty',
    });
    expect(callbackCalled).toBe(false);
  });
});
