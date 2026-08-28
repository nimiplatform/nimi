import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  createElectronShellFileProtocolHost,
  isElectronAgentCenterCommand,
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

function registerAgentCenterBridge(standardShellHost: NimiElectronStandardShellHost): FakeIpcMain {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronRuntimeBridge({
    appId: 'acme.widget',
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
    const ipcMain = registerAgentCenterBridge({});
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

  it('returns null when the Host-native selection is canceled', async () => {
    const ipcMain = registerAgentCenterBridge({
      openFileDialog: () => ({ canceled: true, paths: [] }),
    });
    const { event } = createInvokeEvent();
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
      payload: { backendKind: 'vrm' },
    })).resolves.toBeNull();
    await expect(invokeBridge(ipcMain, event, {
      command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
      payload: {},
    })).resolves.toBeNull();
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
