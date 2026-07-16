import path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  registerNimiElectronRuntimeBridge,
} from '../src/main/index.js';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
  withTempDir,
} from './electron-shell-test-utils.js';

const nowIso = '2026-07-08T00:00:05.000Z';

describe('Electron Desktop Open Intent host client', () => {
  it('admits the exact local-app intent and host-stamps its source class', async () => {
    await withTempDir('desktop-open', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, {
        bridgeId: 'desktop-open-20260708-bridge',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: nowIso,
      });
      const fetchCalls: Array<{ url: string; init: Record<string, unknown> }> = [];
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(nowIso),
            fetch: async (url, init) => {
              fetchCalls.push({ url, init: init as Record<string, unknown> });
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  status: 'accepted',
                  confirmation: 'desktop-accepted',
                  bridgeId: 'desktop-open-20260708-bridge',
                  requestId: 'desktop-open-20260708-request',
                  appliedTarget: 'open-explore',
                }),
              };
            },
          },
        },
      });

      const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: {
          payload: {
            requestId: 'desktop-open-20260708-request',
            intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
          },
        },
      });
      expect(result).toEqual({
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-20260708-bridge',
        requestId: 'desktop-open-20260708-request',
        appliedTarget: 'open-explore',
      });
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toBe('http://127.0.0.1:49152/v1/open-intent');
      expect(JSON.parse(String(fetchCalls[0]?.init.body))).toEqual({
        schemaVersion: 1,
        sourceApp: 'nimi.zhiyu',
        sourceHost: 'desktop-electron-local-app-host',
        requestId: 'desktop-open-20260708-request',
        intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
      });
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: {
          payload: {
            sourceHost: 'electron-standard-shell',
            intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
          },
        },
      })).resolves.toEqual({
        status: 'rejected',
        reasonCode: 'desktop-open-intent-invalid',
        actionHint: 'fix_desktop_open_intent',
      });
      expect(fetchCalls).toHaveLength(1);
    });
  });

  it('rejects accepted bridge results that do not match the posted envelope', async () => {
    await withTempDir('desktop-open-result-mismatch', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, {
        bridgeId: 'desktop-open-20260708-bridge',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: nowIso,
      });
      const responses = [
        {
          status: 'accepted',
          confirmation: 'desktop-accepted',
          bridgeId: 'desktop-open-20260708-bridge',
          requestId: 'desktop-open-20260708-other',
          appliedTarget: 'open-explore',
        },
        {
          status: 'accepted',
          confirmation: 'desktop-accepted',
          bridgeId: 'desktop-open-20260708-bridge',
          requestId: 'desktop-open-20260708-request',
          appliedTarget: 'open-settings',
        },
      ];
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(nowIso),
            fetch: async () => ({
              ok: true,
              status: 200,
              json: async () => responses.shift(),
            }),
          },
        },
      });

      for (let index = 0; index < 2; index += 1) {
        const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
          command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
          payload: {
            payload: {
              requestId: 'desktop-open-20260708-request',
              intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' },
            },
          },
        });

        expect(result).toEqual({
          status: 'rejected',
          reasonCode: 'desktop-open-intent-invalid',
          actionHint: 'fix_desktop_open_intent',
        });
      }
    });
  });

  it('ignores local-app host source-class overrides and injects the canonical class', async () => {
    await withTempDir('desktop-open-installed-sourcehost-override', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, {
        bridgeId: 'desktop-open-20260708-bridge',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: nowIso,
      });
      let postedSourceHost = '';
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.local-app-fixture',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          desktopOpen: {
            descriptorPath,
            sourceHost: 'electron-standard-shell',
            now: () => Date.parse(nowIso),
            fetch: async (_url, init) => {
              const body = JSON.parse(String((init as { body?: unknown }).body)) as { sourceHost: string };
              postedSourceHost = body.sourceHost;
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  status: 'accepted',
                  confirmation: 'desktop-accepted',
                  bridgeId: 'desktop-open-20260708-bridge',
                  requestId: 'desktop-open-20260708-installed',
                  appliedTarget: 'open-apps',
                }),
              };
            },
          },
        },
      });

      const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: {
          payload: {
            requestId: 'desktop-open-20260708-installed',
            intent: { kind: 'open-apps' },
          },
        },
      });
      expect(result).toEqual({
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-20260708-bridge',
        requestId: 'desktop-open-20260708-installed',
        appliedTarget: 'open-apps',
      });
      expect(postedSourceHost).toBe('desktop-electron-local-app-host');
    });
  });

  it('generates a host-owned requestId when the renderer omits one', async () => {
    await withTempDir('desktop-open-generated-request-id', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, {
        bridgeId: 'desktop-open-20260708-bridge',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: nowIso,
      });
      let postedRequestId = '';
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(nowIso),
            fetch: async (_url, init) => {
              const body = JSON.parse(String((init as { body?: unknown }).body)) as { requestId: string };
              postedRequestId = body.requestId;
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  status: 'accepted',
                  confirmation: 'desktop-accepted',
                  bridgeId: 'desktop-open-20260708-bridge',
                  requestId: postedRequestId,
                  appliedTarget: 'open-apps',
                }),
              };
            },
          },
        },
      });

      const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: { payload: { intent: { kind: 'open-apps' } } },
      });

      expect(postedRequestId).toMatch(/^desktop-open-[A-Za-z0-9][A-Za-z0-9._:-]+$/u);
      expect(result).toEqual({
        status: 'accepted',
        confirmation: 'desktop-accepted',
        bridgeId: 'desktop-open-20260708-bridge',
        requestId: postedRequestId,
        appliedTarget: 'open-apps',
      });
    });
  });

  it('returns not-running for missing descriptors without starting Desktop', async () => {
    await withTempDir('desktop-open-missing', async (dir) => {
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          desktopOpen: {
            descriptorPath: path.join(dir, 'missing.json'),
            now: () => Date.parse(nowIso),
            fetch: async () => {
              throw new Error('fetch must not be called');
            },
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: { payload: { intent: { kind: 'open-apps' } } },
      })).resolves.toEqual({
        status: 'rejected',
        reasonCode: 'desktop-open-desktop-not-running',
        actionHint: 'open_desktop_first',
      });
    });
  });

  it('returns not-running for bridgeId mismatch', async () => {
    await withTempDir('desktop-open-mismatch', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, {
        bridgeId: 'desktop-open-20260708-bridge-a',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: nowIso,
      });
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(nowIso),
            fetch: async () => ({
              ok: true,
              status: 200,
              json: async () => ({
                status: 'accepted',
                confirmation: 'desktop-accepted',
                bridgeId: 'desktop-open-20260708-bridge-b',
                requestId: 'desktop-open-20260708-request',
                appliedTarget: 'open-apps',
              }),
            }),
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: { payload: { intent: { kind: 'open-apps' } } },
      })).resolves.toEqual({
        status: 'rejected',
        reasonCode: 'desktop-open-desktop-not-running',
        actionHint: 'open_desktop_first',
      });
    });
  });

  it('returns host-unavailable only when the shell host lacks transport primitives', async () => {
    await withTempDir('desktop-open-host-unavailable', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, {
        bridgeId: 'desktop-open-20260708-bridge',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: nowIso,
      });
      const originalFetch = globalThis.fetch;
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: undefined,
      });
      try {
        const ipcMain = new FakeIpcMain();
        registerNimiElectronRuntimeBridge({
          appId: 'nimi.tester',
          runtimeEndpoint: '127.0.0.1:46371',
          allowedOrigins: ['http://localhost:1430'],
          ipcMain,
          createGrpcClient: async () => {
            throw new Error('not used');
          },
          standardShellHost: {
            allowAllStandardShellCommands: true,
            desktopOpen: {
              descriptorPath,
              now: () => Date.parse(nowIso),
            },
          },
        });

        await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
          command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
          payload: { payload: { intent: { kind: 'open-apps' } } },
        })).resolves.toEqual({
          status: 'rejected',
          reasonCode: 'desktop-open-host-unavailable',
          actionHint: 'check_desktop_runtime_bridge',
        });
      } finally {
        Object.defineProperty(globalThis, 'fetch', {
          configurable: true,
          value: originalFetch,
        });
      }
    });
  });

  it('returns not-running for stale descriptors without contacting the bridge', async () => {
    await withTempDir('desktop-open-stale', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, {
        bridgeId: 'desktop-open-20260708-bridge',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: '2026-07-08T00:00:00.000Z',
      });
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse('2026-07-08T00:00:20.000Z'),
            fetch: async () => {
              throw new Error('fetch must not be called');
            },
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: { payload: { intent: { kind: 'open-apps' } } },
      })).resolves.toEqual({
        status: 'rejected',
        reasonCode: 'desktop-open-desktop-not-running',
        actionHint: 'open_desktop_first',
      });
    });
  });

  it('rejects symlink descriptor ancestry before reading token material', async () => {
    await withTempDir('desktop-open-symlink-ancestry', async (dir) => {
      const realDir = path.join(dir, 'real');
      const linkDir = path.join(dir, 'link');
      await mkdir(realDir);
      await symlink(realDir, linkDir, process.platform === 'win32' ? 'junction' : 'dir');
      await writeDescriptor(path.join(realDir, 'presence.v1.json'), {
        bridgeId: 'desktop-open-20260708-bridge',
        endpoint: 'http://127.0.0.1:49152',
        token: 'desktop-open-token',
        lastHeartbeatAt: nowIso,
      });
      let readAttempted = false;
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          desktopOpen: {
            descriptorPath: path.join(linkDir, 'presence.v1.json'),
            readTextFile: async () => {
              readAttempted = true;
              throw new Error('descriptor read must not happen through symlink ancestry');
            },
            fetch: async () => {
              throw new Error('fetch must not be called');
            },
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: { payload: { intent: { kind: 'open-apps' } } },
      })).resolves.toEqual({
        status: 'rejected',
        reasonCode: 'desktop-open-desktop-not-running',
        actionHint: 'open_desktop_first',
      });
      expect(readAttempted).toBe(false);
    });
  });

  it('returns not-running for malformed descriptors without leaking token material', async () => {
    await withTempDir('desktop-open-malformed', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeFile(descriptorPath, '{"schemaVersion":1,"token":"desktop-open-token"', 'utf8');
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.tester',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => {
          throw new Error('not used');
        },
        standardShellHost: {
          allowAllStandardShellCommands: true,
          desktopOpen: {
            descriptorPath,
            fetch: async () => {
              throw new Error('fetch must not be called');
            },
          },
        },
      });

      const result = await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
        payload: { payload: { intent: { kind: 'open-apps' } } },
      });
      expect(result).toEqual({
        status: 'rejected',
        reasonCode: 'desktop-open-desktop-not-running',
        actionHint: 'open_desktop_first',
      });
      expect(JSON.stringify(result)).not.toContain('desktop-open-token');
    });
  });

  it('returns invalid for malformed renderer requestId before descriptor access', async () => {
    const ipcMain = new FakeIpcMain();
    registerNimiElectronRuntimeBridge({
      appId: 'nimi.tester',
      runtimeEndpoint: '127.0.0.1:46371',
      allowedOrigins: ['http://localhost:1430'],
      ipcMain,
      createGrpcClient: async () => {
        throw new Error('not used');
      },
      standardShellHost: {
        allowAllStandardShellCommands: true,
        desktopOpen: {
          fetch: async () => {
            throw new Error('fetch must not be called');
          },
        },
      },
    });

    await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent'],
      payload: {
        payload: {
          requestId: 'bad id',
          intent: { kind: 'open-apps' },
        },
      },
    })).resolves.toEqual({
      status: 'rejected',
      reasonCode: 'desktop-open-intent-invalid',
      actionHint: 'fix_desktop_open_intent',
    });
  });
});

async function writeDescriptor(
  descriptorPath: string,
  overrides: {
    readonly bridgeId: string;
    readonly endpoint: string;
    readonly token: string;
    readonly lastHeartbeatAt: string;
  },
): Promise<void> {
  await writeFile(descriptorPath, JSON.stringify({
    schemaVersion: 1,
    desktopAppId: 'nimi.desktop',
    bridgeId: overrides.bridgeId,
    pid: 12345,
    endpoint: overrides.endpoint,
    token: overrides.token,
    startedAt: '2026-07-08T00:00:00.000Z',
    lastHeartbeatAt: overrides.lastHeartbeatAt,
  }), 'utf8');
}
