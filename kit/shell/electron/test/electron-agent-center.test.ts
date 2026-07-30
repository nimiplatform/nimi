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
  it('applies the shared exact-payload fixture matrix at the actual dispatcher boundary', async () => {
    const fixtures = JSON.parse(readFileSync(path.resolve(
      process.cwd(),
      'shell/capabilities/test/agent-center-payload-fixtures.json',
    ), 'utf8')) as Array<{
      readonly command: string;
      readonly valid: Readonly<Record<string, unknown>>;
      readonly unknown: Readonly<Record<string, unknown>>;
      readonly missing: Readonly<Record<string, unknown>>;
      readonly wrong: Readonly<Record<string, unknown>>;
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
      for (const payload of [fixture.unknown, fixture.missing, fixture.wrong]) {
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
        payload: { kind: 'file', title: 'Select Live2D package' },
      })).resolves.toEqual({ canceled: false, paths: [sourceRoot] });

      const imported = await invokeBridge(ipcMain, event, {
        command: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
        payload: {
          hostScope: 'local-agent',
          accountId: 'account_1',
          ownerUserId: 'owner_1',
          runtimeSourceRef: 'runtime-source:local',
          localAgentRef: 'local-agent:ren',
          backendKind: 'live2d',
          sourcePath: sourceRoot,
        },
      });

      expect(imported).toMatchObject({
        role: 'avatar', backendKind: 'live2d', fileName: 'ren-live2d.zip', mediaType: 'application/zip',
      });
      expect((imported as { content?: Uint8Array }).content).toEqual(Uint8Array.from(Buffer.from('runtime-validates-this-package')));
      expect((imported as { sha256?: string }).sha256).toMatch(/^[a-f0-9]{64}$/u);
    });
  });

  it('rejects incomplete local-agent scope with the canonical Electron error envelope', async () => {
    await withTempDir('agent-center-scope', async (root) => {
      const ipcMain = registerAgentCenterBridge({
        standardDataRootBinding: {
          source: 'runtime-launch-projection',
          durableDataRoot: path.join(root, 'data'),
          projectionRef: 'electron-agent-center-scope-test',
        },
      });
      const { event } = createInvokeEvent();

      for (const [command, extra] of [
        [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'], { avatarAssetRef: 'live2d_111111111111' }],
        [NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove'], {}],
      ] as const) {
        await expect(invokeBridge(ipcMain, event, {
          command,
          payload: {
            hostScope: 'local-agent',
            accountId: 'account_1',
            localAgentRef: 'local-agent:ren',
            ...extra,
          },
        })).rejects.toMatchObject({
          code: 'invalid-payload',
          reasonCode: 'electron-agent-center-payload-invalid',
          actionHint: 'send_standard_agent_center_payload',
          source: 'electron',
        });
      }
    });
  });

  it('does not admit retired Agent Center config commands', () => {
    expect(isElectronAgentCenterCommand('nimi.shell.agentCenter.configGet')).toBe(false);
    expect(isElectronAgentCenterCommand('nimi.shell.agentCenter.configSet')).toBe(false);
  });
});
