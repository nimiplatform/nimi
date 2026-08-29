import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, truncate, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  createElectronShellFileProtocolHost,
  isElectronAgentCenterCommand,
  requestElectronAgentCenterResourcePackPlacement,
  registerNimiElectronRuntimeBridge,
  type NimiElectronStandardShellHost,
} from '../src/main/index.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  FakeIpcMain,
  createInvokeEvent,
  invokeBridge,
  withTempDir,
} from './electron-shell-test-utils.js';
import { FakeElectronProtocol } from './fake-electron-protocol.js';

const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function registerAgentCenterBridge(
  standardShellHost: NimiElectronStandardShellHost,
  appId = 'acme.widget',
): FakeIpcMain {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronRuntimeBridge({
    appId,
    runtimeEndpoint: '127.0.0.1:46371',
    allowedOrigins: ['http://localhost:1430'],
    ipcMain,
    createGrpcClient: async () => {
      throw new Error('not used');
    },
    standardShellHost: {
      allowAllStandardShellCommands: true,
      ...standardShellHost,
    },
  });
  return ipcMain;
}

describe('Electron standard Agent Center host', () => {
  it('applies the shared exact-payload fixture matrix at the actual dispatcher boundary', async () => {
    const fixtures = JSON.parse(readFileSync(path.resolve(
      process.cwd(),
      'shell/capabilities/test/agent-center-payload-fixtures.json',
    ), 'utf8')) as Array<{
      readonly command: string;
      readonly valid: Readonly<Record<string, unknown>>;
      readonly invalid: readonly Readonly<Record<string, unknown>>[];
    }>;
    const ipcMain = registerAgentCenterBridge({}, 'nimi.zhiyu');
    const { event } = createInvokeEvent();

    for (const fixture of fixtures) {
      try {
        await invokeBridge(ipcMain, event, {
          command: fixture.command,
          payload: fixture.valid,
        });
      } catch (error) {
        expect(error, `${fixture.command} valid fixture must pass payload parsing`).not.toMatchObject({
          reasonCode: 'electron-agent-center-payload-invalid',
        });
      }
      for (const payload of fixture.invalid) {
        await expect(invokeBridge(ipcMain, event, {
          command: fixture.command,
          payload,
        }), `${fixture.command} must reject ${JSON.stringify(payload)}`).rejects.toMatchObject({
          code: 'invalid-payload',
          reasonCode: 'electron-agent-center-payload-invalid',
        });
      }
    }
  });

  it('forwards bounded file-dialog material without persistent Shell import', async () => {
    await withTempDir('agent-center-live2d', async (root) => {
      const dataRoot = path.join(root, 'data');
      const sourceRoot = path.join(root, 'ren-live2d.zip');
      await writeFile(sourceRoot, Buffer.from('runtime-validates-this-package'));
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const dialogCalls: unknown[] = [];
      const ipcMain = registerAgentCenterBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-agent-center-test',
        },
        localAssetProtocolHost: protocolHost,
        openFileDialog: (input) => {
          dialogCalls.push(input);
          return { canceled: false, paths: [sourceRoot] };
        },
      });
      const { event } = createInvokeEvent();

      const imported = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
        payload: { backendKind: 'live2d' },
      });

      expect(imported).toMatchObject({
        role: 'avatar', backendKind: 'live2d', fileName: 'ren-live2d.zip', mediaType: 'application/zip',
      });
      expect((imported as { content?: Uint8Array }).content).toEqual(Uint8Array.from(Buffer.from('runtime-validates-this-package')));
      expect((imported as { sha256?: string }).sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(dialogCalls).toEqual([{
        kind: 'file', title: 'Select Live2D package',
        filters: [{ name: 'Live2D package', extensions: ['zip'] }], multiple: false,
      }]);
    });
  });

  it('returns bounded background bytes without creating Agent-scoped Shell state', async () => {
    await withTempDir('agent-center-background-selection', async (root) => {
      const sourcePath = path.join(root, 'space.png');
      await writeFile(sourcePath, VALID_PNG);
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const dialogCalls: unknown[] = [];
      const ipcMain = registerAgentCenterBridge({
        localAssetProtocolHost: protocolHost,
        openFileDialog: (input) => {
          dialogCalls.push(input);
          return { canceled: false, paths: [sourcePath] };
        },
      });
      const { event } = createInvokeEvent();

      const imported = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
        payload: {},
      });

      expect(imported).toMatchObject({
        role: 'background', fileName: 'space.png', mediaType: 'image/png',
      });
      expect((imported as { content?: Uint8Array }).content).toEqual(Uint8Array.from(VALID_PNG));
      expect((imported as { sha256?: string }).sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.keys(imported as object).sort()).toEqual([
        'content', 'custodyRef', 'fileName', 'mediaType', 'role', 'sha256',
      ]);
      expect(dialogCalls).toEqual([{
        kind: 'file', title: 'Select background image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], multiple: false,
      }]);
    });
  });

  it('returns one bounded .nimipack byte snapshot without parsing or retaining candidate state', async () => {
    await withTempDir('agent-center-resource-pack-selection', async (root) => {
      const sourcePath = path.join(root, 'technical-pack-a.nimipack');
      const sourceBytes = Buffer.from('PK\u0003\u0004w1-resource-pack-archive');
      await writeFile(sourcePath, sourceBytes);
      const dialogCalls: unknown[] = [];
      const ipcMain = registerAgentCenterBridge({
        openFileDialog: (input) => {
          dialogCalls.push(input);
          return { canceled: false, paths: [sourcePath] };
        },
      }, 'nimi.zhiyu');
      const { event } = createInvokeEvent();

      const imported = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport'],
        payload: {},
      });

      expect(imported).toMatchObject({
        role: 'resource-pack',
        fileName: 'technical-pack-a.nimipack',
        mediaType: 'application/vnd.nimi.resource-pack+zip',
      });
      expect((imported as { content?: Uint8Array }).content).toEqual(Uint8Array.from(sourceBytes));
      expect((imported as { sha256?: string }).sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.keys(imported as object).sort()).toEqual([
        'content', 'custodyRef', 'fileName', 'mediaType', 'role', 'sha256',
      ]);
      expect(dialogCalls).toEqual([{
        kind: 'file',
        title: 'Select Nimi Resource Pack',
        filters: [{ name: 'Nimi Resource Pack', extensions: ['nimipack'] }],
        multiple: false,
      }]);
    });
  });

  it('rejects Resource Pack selection outside the exact Zhiyu host before opening a picker', async () => {
    const dialogCalls: unknown[] = [];
    const ipcMain = registerAgentCenterBridge({
      openFileDialog: (input) => {
        dialogCalls.push(input);
        return { canceled: true, paths: [] };
      },
    }, 'acme.widget');
    const { event } = createInvokeEvent();

    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport'],
      payload: {},
    })).rejects.toMatchObject({
      code: 'forbidden-renderer-access',
      reasonCode: 'electron-agent-center-resource-pack-target-required',
    });
    expect(dialogCalls).toEqual([]);
  });

  it('rejects Resource Pack input outside the .nimipack and 2 MiB compressed archive boundary', async () => {
    await withTempDir('agent-center-resource-pack-invalid', async (root) => {
      const wrongExtension = path.join(root, 'technical-pack-a.zip');
      const oversize = path.join(root, 'technical-pack-a.nimipack');
      await writeFile(wrongExtension, Buffer.from('PK\u0003\u0004archive'));
      await writeFile(oversize, Buffer.alloc(0));
      await truncate(oversize, 2_097_153);
      const { event } = createInvokeEvent();

      for (const sourcePath of [wrongExtension, oversize]) {
        const ipcMain = registerAgentCenterBridge({
          openFileDialog: () => ({ canceled: false, paths: [sourcePath] }),
        }, 'nimi.zhiyu');
        await expect(invokeBridge(ipcMain, event, {
          command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport'],
          payload: {},
        })).rejects.toMatchObject({
          code: 'invalid-payload',
          reasonCode: 'electron-agent-center-payload-invalid',
        });
      }
    });
  });

  it('returns null when the Host-native selection is canceled', async () => {
    const ipcMain = registerAgentCenterBridge({
      openFileDialog: () => ({ canceled: true, paths: [] }),
    }, 'nimi.zhiyu');
    const { event } = createInvokeEvent();
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
      payload: { backendKind: 'vrm' },
    })).resolves.toBeNull();
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
      payload: {},
    })).resolves.toBeNull();
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackImport'],
      payload: {},
    })).resolves.toBeNull();
  });

  it('exposes bounded Zhiyu Resource Pack placement to an ordinary App through the public Host contract', async () => {
    const calls: unknown[] = [];
    const ipcMain = registerAgentCenterBridge({
      agentCenterResourcePackPlacement: (payload, input) => {
        calls.push({ payload, appId: input.appId, command: input.command });
        return { status: 'ready', reasonCode: 'zhiyu-resource-pack-placement-ready' };
      },
    }, 'acme.widget');
    const { event } = createInvokeEvent();
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackOpenZhiyu'],
      payload: { conversationAnchorId: 'conversation-anchor-1' },
    })).resolves.toEqual({
      status: 'ready',
      reasonCode: 'zhiyu-resource-pack-placement-ready',
    });
    expect(calls).toEqual([{
      payload: { conversationAnchorId: 'conversation-anchor-1' },
      appId: 'acme.widget',
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.resourcePackOpenZhiyu'],
    }]);
  });

  it('routes the public ordinary-App placement through authenticated Desktop presence without source handles', async () => {
    const calls: unknown[] = [];
    const result = await requestElectronAgentCenterResourcePackPlacement({
      conversationAnchorId: 'conversation-anchor-1',
      host: {
        desktopOpen: {
          descriptorPath: path.resolve(process.cwd(), 'package.json'),
          now: () => Date.parse('2026-08-30T03:00:00.000Z'),
          readTextFile: () => JSON.stringify({
            schemaVersion: 1,
            desktopAppId: 'nimi.desktop',
            bridgeId: 'desktop-open-bridge-test',
            endpoint: 'http://127.0.0.1:49152',
            token: 'desktop-open-token-test',
            startedAt: '2026-08-30T02:59:58.000Z',
            lastHeartbeatAt: '2026-08-30T02:59:59.000Z',
          }),
          fetch: async (url, init) => {
            calls.push({ url, body: JSON.parse(init.body), authorization: init.headers.Authorization });
            return {
              status: 200,
              json: async () => ({
                bridgeId: 'desktop-open-bridge-test',
                status: 'ready',
                reasonCode: 'zhiyu-resource-pack-placement-ready',
              }),
            };
          },
        },
      },
    });
    expect(result).toEqual({ status: 'ready', reasonCode: 'zhiyu-resource-pack-placement-ready' });
    expect(calls).toEqual([{
      url: 'http://127.0.0.1:49152/v1/agent-center-resource-pack-placement/request',
      body: { schemaVersion: 1, conversationAnchorId: 'conversation-anchor-1' },
      authorization: 'Bearer desktop-open-token-test',
    }]);
    expect(JSON.stringify(calls)).not.toMatch(/agentHandle|candidateBytes/u);
  });

  it('does not admit retired Agent Center product or config commands', () => {
    for (const command of [
      'nimi.shell.agentCenter.avatarAssetValidate',
      'nimi.shell.agentCenter.avatarAssetResolvePreview',
      'nimi.shell.agentCenter.live2dAdapterImport',
      'nimi.shell.agentCenter.backgroundGet',
      'nimi.shell.agentCenter.backgroundValidate',
      'nimi.shell.agentCenter.backgroundRemove',
      'nimi.shell.agentCenter.agentResourcesRemove',
      'nimi.shell.agentCenter.accountResourcesRemove',
    ]) {
      expect(isElectronAgentCenterCommand(command)).toBe(false);
    }
    expect(isElectronAgentCenterCommand('nimi.shell.agentCenter.configGet')).toBe(false);
    expect(isElectronAgentCenterCommand('nimi.shell.agentCenter.configSet')).toBe(false);
  });
});
