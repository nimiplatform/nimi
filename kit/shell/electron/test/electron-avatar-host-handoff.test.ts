import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '@nimiplatform/kit/shell/capabilities';
import { registerNimiElectronRuntimeBridge } from '../src/main/index.js';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
  withTempDir,
} from './electron-shell-test-utils.js';

const NOW = '2026-08-29T00:00:05.000Z';
const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

describe('Electron Avatar Host handoff carrier', () => {
  it('posts the exact Host-stamped mechanic to the independent Avatar path', async () => {
    await withTempDir('avatar-host-handoff', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, 'desktop-avatar-bridge');
      const calls: Array<{ url: string; body: unknown }> = [];
      const localAppHost = runtimeValidatedLocalAppHost();
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => { throw new Error('not used'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          localAppHost,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(NOW),
            fetch: async (url, init) => {
              calls.push({ url, body: JSON.parse(init.body) });
              return {
                status: 200,
                json: async () => ({
                  bridgeId: 'desktop-avatar-bridge',
                  command: 'launch',
                  state: 'present',
                  avatarInstanceRef: 'avatar-instance:opaque',
                  committedPresentationRef: 'presentation:opaque',
                  temporaryCustodyRef: 'custody:opaque',
                }),
              };
            },
          },
        },
      });

      const request = launchRequest();
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff'],
        payload: { payload: request },
      })).resolves.toEqual({
        command: 'launch',
        state: 'present',
        avatarInstanceRef: 'avatar-instance:opaque',
        committedPresentationRef: 'presentation:opaque',
        temporaryCustodyRef: 'custody:opaque',
      });
      expect(calls).toEqual([{
        url: 'http://127.0.0.1:49152/v1/avatar-handoff',
        body: {
          schemaVersion: 1,
          sourceApp: 'nimi.zhiyu',
          request,
        },
      }]);
      expect(localAppHost.conversationSnapshot).toHaveBeenCalledWith({
        agentHandle: AGENT_HANDLE,
        conversationAnchorId: 'conversation-anchor:1',
      });
    });
  });

  it('resolves an omitted launch anchor through the caller formal Runtime session', async () => {
    await withTempDir('avatar-host-handoff-open', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, 'desktop-avatar-bridge');
      const calls: unknown[] = [];
      const localAppHost = runtimeValidatedLocalAppHost({
        conversationAnchorId: 'conversation-anchor:resolved',
      });
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => { throw new Error('not used'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          localAppHost,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(NOW),
            fetch: async (_url, init) => {
              calls.push(JSON.parse(init.body));
              return {
                status: 200,
                json: async () => ({
                  bridgeId: 'desktop-avatar-bridge',
                  command: 'launch',
                  state: 'present',
                  avatarInstanceRef: 'avatar-instance:opaque',
                  committedPresentationRef: null,
                  temporaryCustodyRef: null,
                }),
              };
            },
          },
        },
      });

      const request = launchRequest();
      await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff'],
        payload: {
          payload: {
            ...request,
            target: { ...request.target, conversationAnchorId: null },
          },
        },
      });
      expect(localAppHost.conversationOpen).toHaveBeenCalledWith({ agentHandle: AGENT_HANDLE });
      expect(calls).toEqual([{
        schemaVersion: 1,
        sourceApp: 'nimi.zhiyu',
        request: {
          ...request,
          target: { ...request.target, conversationAnchorId: 'conversation-anchor:resolved' },
        },
      }]);
    });
  });

  it('forwards handle-only presence without entering a Runtime product operation', async () => {
    await withTempDir('avatar-host-handoff-presence', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, 'desktop-avatar-bridge');
      const calls: unknown[] = [];
      const localAppHost = runtimeValidatedLocalAppHost();
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => { throw new Error('not used'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          localAppHost,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(NOW),
            fetch: async (_url, init) => {
              calls.push(JSON.parse(init.body));
              return {
                status: 200,
                json: async () => ({
                  bridgeId: 'desktop-avatar-bridge',
                  command: 'presence',
                  state: 'absent',
                  avatarInstanceRef: null,
                  committedPresentationRef: null,
                  temporaryCustodyRef: null,
                }),
              };
            },
          },
        },
      });

      const launch = launchRequest();
      const request = {
        command: 'presence',
        target: { ...launch.target, conversationAnchorId: null },
      } as const;
      await invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff'],
        payload: { payload: request },
      });
      expect(localAppHost.agentPresentationSnapshot).not.toHaveBeenCalled();
      expect(localAppHost.conversationSnapshot).not.toHaveBeenCalled();
      expect(localAppHost.conversationOpen).not.toHaveBeenCalled();
      expect(calls).toEqual([{
        schemaVersion: 1,
        sourceApp: 'nimi.zhiyu',
        request,
      }]);
    });
  });

  it('rejects a mismatched handle and Conversation anchor before contacting Desktop', async () => {
    await withTempDir('avatar-host-handoff-pair-mismatch', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, 'desktop-avatar-bridge');
      let contacted = false;
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => { throw new Error('not used'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          localAppHost: runtimeValidatedLocalAppHost({ snapshotAnchorId: 'conversation-anchor:other' }),
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(NOW),
            fetch: async () => { contacted = true; throw new Error('must not fetch'); },
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff'],
        payload: { payload: launchRequest() },
      })).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'avatar-host-agent-anchor-mismatch',
      });
      expect(contacted).toBe(false);
    });
  });

  it('rejects identity and product-authority sidebands before contacting Desktop', async () => {
    await withTempDir('avatar-host-handoff-invalid', async (dir) => {
      const descriptorPath = path.join(dir, 'presence.v1.json');
      await writeDescriptor(descriptorPath, 'desktop-avatar-bridge');
      let contacted = false;
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => { throw new Error('not used'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          desktopOpen: {
            descriptorPath,
            now: () => Date.parse(NOW),
            fetch: async () => { contacted = true; throw new Error('must not fetch'); },
          },
        },
      });

      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff'],
        payload: {
          payload: {
            ...launchRequest(),
            target: { ...launchRequest().target, ownerUserId: 'forbidden' },
          },
        },
      })).rejects.toMatchObject({
        code: 'invalid-payload',
        reasonCode: 'avatar-host-handoff-payload-invalid',
      });
      expect(contacted).toBe(false);
    });
  });

  it('fails closed when the Desktop process witness is absent or changes', async () => {
    await withTempDir('avatar-host-handoff-witness', async (dir) => {
      const ipcMain = new FakeIpcMain();
      registerNimiElectronRuntimeBridge({
        appId: 'nimi.zhiyu',
        runtimeEndpoint: '127.0.0.1:46371',
        allowedOrigins: ['http://localhost:1430'],
        ipcMain,
        createGrpcClient: async () => { throw new Error('not used'); },
        standardShellHost: {
          capabilitySetRef: NIMI_LOCAL_APP_STANDARD_SHELL_CAPABILITY_SET_ID,
          desktopOpen: { descriptorPath: path.join(dir, 'missing.json') },
        },
      });
      await expect(invokeBridge(ipcMain, createInvokeEvent().event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['avatar.hostHandoff'],
        payload: { payload: launchRequest() },
      })).rejects.toMatchObject({
        code: 'capability-unavailable',
        reasonCode: 'avatar-host-desktop-not-running',
      });
    });
  });
});

function launchRequest() {
  return {
    command: 'launch',
    target: {
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: 'conversation-anchor:1',
      avatarInstanceId: 'zhiyu-avatar:1',
      launchSource: 'zhiyu',
      committedPresentationRef: null,
      temporaryCustodyRef: null,
    },
  } as const;
}

function runtimeValidatedLocalAppHost(input: {
  readonly conversationAnchorId?: string;
  readonly snapshotAnchorId?: string;
} = {}) {
  const conversationAnchorId = input.conversationAnchorId ?? 'conversation-anchor:1';
  return {
    conversationOpen: vi.fn(async () => ({ conversationAnchorId })),
    conversationSnapshot: vi.fn(async () => ({
      conversationAnchorId: input.snapshotAnchorId ?? conversationAnchorId,
    })),
    agentPresentationSnapshot: vi.fn(async () => ({
      profile: null,
      presentationRevision: '1',
    })),
  } as never;
}

async function writeDescriptor(descriptorPath: string, bridgeId: string): Promise<void> {
  await writeFile(descriptorPath, JSON.stringify({
    schemaVersion: 1,
    desktopAppId: 'nimi.desktop',
    bridgeId,
    pid: 12345,
    endpoint: 'http://127.0.0.1:49152',
    token: 'desktop-avatar-token',
    startedAt: '2026-08-29T00:00:00.000Z',
    lastHeartbeatAt: NOW,
  }), 'utf8');
}
