import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
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

function registerAgentCenterBridge(standardShellHost: NimiElectronStandardShellHost): FakeIpcMain {
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
      ...standardShellHost,
    },
  });
  return ipcMain;
}

describe('Electron standard Agent Center host', () => {
  it('imports a file-dialog admitted Live2D folder through standard Agent Center commands', async () => {
    await withTempDir('agent-center-live2d', async (root) => {
      const dataRoot = path.join(root, 'data');
      const sourceRoot = path.join(root, 'source-live2d');
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(path.join(sourceRoot, 'ren.model3.json'), '{"Version":3,"FileReferences":{}}\n', 'utf8');
      await writeFile(path.join(sourceRoot, 'ren.png'), 'not-a-real-png-but-host-custody-only', 'utf8');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerAgentCenterBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: dataRoot,
          projectionRef: 'electron-agent-center-test',
        },
        localAssetProtocolHost: protocolHost,
        openFileDialog: () => ({ canceled: false, paths: [sourceRoot] }),
      });
      const { event } = createInvokeEvent();

      await expect(invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
        payload: { kind: 'directory', title: 'Select Live2D folder' },
      })).resolves.toEqual({ canceled: false, paths: [sourceRoot] });

      const imported = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
        payload: {
          hostScope: 'local-agent',
          accountId: 'account_1',
          localAgentRef: 'local-agent:ren',
          backendKind: 'live2d',
          sourcePath: sourceRoot,
        },
      });

      expect(imported).toMatchObject({
        backendKind: 'live2d',
        validationStatus: 'valid',
      });
      expect((imported as { avatarAssetRef?: string }).avatarAssetRef).toMatch(/^live2d_[a-f0-9]{12}$/u);
    });
  });

  it('does not admit retired Agent Center config commands', () => {
    expect(isElectronAgentCenterCommand('nimi.shell.agentCenter.configGet')).toBe(false);
    expect(isElectronAgentCenterCommand('nimi.shell.agentCenter.configSet')).toBe(false);
  });
});
