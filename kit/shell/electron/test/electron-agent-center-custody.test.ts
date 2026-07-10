import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  createElectronShellFileProtocolHost,
  registerNimiElectronRuntimeBridge,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronStandardShellHost,
} from '../src/main/index.js';
import { FakeElectronProtocol } from './fake-electron-protocol.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge, withTempDir } from './electron-shell-test-utils.js';

const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

type Scope = {
  readonly hostScope: 'local-agent';
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

const SCOPE_A: Scope = {
  hostScope: 'local-agent',
  accountId: 'account_a',
  ownerUserId: 'owner_a',
  runtimeSourceRef: 'runtime-source:a',
  localAgentRef: 'local-agent:a',
};

const SCOPE_B: Scope = {
  hostScope: 'local-agent',
  accountId: 'account_b',
  ownerUserId: 'owner_b',
  runtimeSourceRef: 'runtime-source:b',
  localAgentRef: 'local-agent:b',
};

const SCOPE_ACCOUNT_A_AGENT_B: Scope = {
  hostScope: 'local-agent',
  accountId: 'account_a',
  ownerUserId: 'owner_a',
  runtimeSourceRef: 'runtime-source:a-b',
  localAgentRef: 'local-agent:b',
};

const SCOPE_ACCOUNT_B_AGENT_A: Scope = {
  hostScope: 'local-agent',
  accountId: 'account_b',
  ownerUserId: 'owner_b',
  runtimeSourceRef: 'runtime-source:b-a',
  localAgentRef: 'local-agent:a',
};

const SCOPE_MISSING: Scope = {
  hostScope: 'local-agent',
  accountId: 'account_missing',
  ownerUserId: 'owner_missing',
  runtimeSourceRef: 'runtime-source:missing',
  localAgentRef: 'local-agent:missing',
};

function registerAgentCenterBridge(dataRoot: string, protocolHost?: NimiElectronShellFileProtocolHost): FakeIpcMain {
  const ipcMain = new FakeIpcMain();
  const standardShellHost: NimiElectronStandardShellHost = {
    allowAllStandardShellCommands: true,
    standardDataRootBinding: {
      source: 'runtime-launch-projection',
      durableDataRoot: dataRoot,
      projectionRef: 'electron-agent-center-custody-test',
    },
    localAssetProtocolHost: protocolHost,
  };
  registerNimiElectronRuntimeBridge({
    appId: 'nimi.tester',
    runtimeEndpoint: '127.0.0.1:46371',
    allowedOrigins: ['http://localhost:1430'],
    ipcMain,
    createGrpcClient: async () => { throw new Error('not used'); },
    standardShellHost,
  });
  return ipcMain;
}

async function invokeAgentCenter(
  ipcMain: FakeIpcMain,
  command: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const { event } = createInvokeEvent();
  return invokeBridge(ipcMain, event, { command, payload });
}

function custodySegment(value: string): string {
  const body = value.startsWith('~') ? value.slice(1) : value;
  return value.length <= 128 && /^[a-z0-9][a-z0-9_-]*$/u.test(body)
    ? value
    : `id_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function agentRoot(dataRoot: string, scope: Scope): string {
  return path.join(
    dataRoot,
    'agent-center',
    'accounts',
    custodySegment(scope.accountId),
    'agents',
    custodySegment(scope.localAgentRef),
    'agent-center',
  );
}

async function createValidLive2dSource(root: string, name: string, variant = 'valid'): Promise<string> {
  const source = path.join(root, name);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'model.moc3'), Buffer.from(`MOC3\x01${variant}`));
  await writeFile(path.join(source, 'texture.png'), VALID_PNG);
  await writeFile(path.join(source, 'model.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
  }));
  return source;
}

async function importAvatar(
  ipcMain: FakeIpcMain,
  protocolHost: NimiElectronShellFileProtocolHost,
  scope: Scope,
  sourcePath: string,
  backendKind: 'live2d' | 'vrm' = 'live2d',
): Promise<string> {
  await protocolHost.registerReadableFile(sourcePath);
  const result = await invokeAgentCenter(
    ipcMain,
    NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
    { ...scope, sourcePath, backendKind },
  ) as { avatarAssetRef: string };
  return result.avatarAssetRef;
}

async function importBackground(
  ipcMain: FakeIpcMain,
  protocolHost: NimiElectronShellFileProtocolHost,
  scope: Scope,
  sourcePath: string,
): Promise<string> {
  await protocolHost.registerReadableFile(sourcePath);
  const result = await invokeAgentCenter(
    ipcMain,
    NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'],
    { ...scope, sourcePath },
  ) as { backgroundAssetRef: string };
  return result.backgroundAssetRef;
}

async function directoryEntriesOrEmpty(dir: string): Promise<readonly string[]> {
  return readdir(dir).catch(() => []);
}

describe('Electron Agent Center scoped custody', () => {
  it('keeps identical avatar refs scoped for validate, preview, and Live2D sidecar writes', async () => {
    await withTempDir('agent-center-scoped-avatar', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerAgentCenterBridge(dataRoot, protocolHost);
      const source = await createValidLive2dSource(root, 'live2d');
      const refA = await importAvatar(ipcMain, protocolHost, SCOPE_A, source);
      const refB = await importAvatar(ipcMain, protocolHost, SCOPE_B, source);
      expect(refB).toBe(refA);
      const secondSource = await createValidLive2dSource(root, 'live2d-second', 'second');
      const secondRefA = await importAvatar(ipcMain, protocolHost, SCOPE_A, secondSource);
      expect(secondRefA).not.toBe(refA);

      for (const command of [
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'],
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview'],
      ]) {
        for (const missingScope of [SCOPE_MISSING, SCOPE_ACCOUNT_A_AGENT_B, SCOPE_ACCOUNT_B_AGENT_A]) {
          await expect(invokeAgentCenter(ipcMain, command, {
            ...missingScope,
            avatarAssetRef: refA,
          })).rejects.toMatchObject({ code: 'not-found' });
        }
        await expect(invokeAgentCenter(ipcMain, command, {
          ...SCOPE_A,
          avatarAssetRef: refA,
        })).resolves.toMatchObject({ validationStatus: 'valid' });
      }

      const sidecar = path.join(root, 'adapter.json');
      await writeFile(sidecar, JSON.stringify({ manifest_kind: 'nimi.avatar.live2d.adapter', schema_version: 1 }));
      await protocolHost.registerReadableFile(sidecar);
      for (const missingScope of [SCOPE_MISSING, SCOPE_ACCOUNT_A_AGENT_B, SCOPE_ACCOUNT_B_AGENT_A]) {
        await expect(invokeAgentCenter(
          ipcMain,
          NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'],
          { ...missingScope, avatarAssetRef: refA, sourcePath: sidecar },
        )).rejects.toMatchObject({ code: 'not-found' });
      }
      await invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'],
        { ...SCOPE_A, avatarAssetRef: refA, sourcePath: sidecar },
      );
      await invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'],
        { ...SCOPE_A, avatarAssetRef: secondRefA, sourcePath: sidecar },
      );

      const adapterDirA = path.join(agentRoot(dataRoot, SCOPE_A), 'modules/avatar_asset/adapter_manifests');
      const adapterDirB = path.join(agentRoot(dataRoot, SCOPE_B), 'modules/avatar_asset/adapter_manifests');
      const manifestRef = `live2d_adapter_${crypto.createHash('sha256').update(await readFile(sidecar)).digest('hex').slice(0, 12)}`;
      const custodyDirA = path.join(adapterDirA, refA, manifestRef);
      const custodyPathA = path.join(custodyDirA, 'custody.json');
      const custodyAJson = await readFile(custodyPathA, 'utf8');
      const custodyA = JSON.parse(custodyAJson) as Record<string, unknown>;
      const custodySecondA = JSON.parse(await readFile(path.join(adapterDirA, secondRefA, manifestRef, 'custody.json'), 'utf8')) as Record<string, unknown>;
      expect(custodyA.local_asset_id).toBe(refA);
      expect(custodySecondA.local_asset_id).toBe(secondRefA);
      await expect(directoryEntriesOrEmpty(adapterDirB)).resolves.toEqual([]);

      const reuse = () => invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'],
        { ...SCOPE_A, avatarAssetRef: refA, sourcePath: sidecar },
      );
      const extraFile = path.join(custodyDirA, 'unexpected.bin');
      await writeFile(extraFile, 'pollution');
      await expect(reuse()).rejects.toMatchObject({ code: 'invalid-payload' });
      await rm(extraFile);

      const extraDirectory = path.join(custodyDirA, 'unexpected');
      await mkdir(extraDirectory);
      await expect(reuse()).rejects.toMatchObject({ code: 'invalid-payload' });
      await rm(extraDirectory, { recursive: true });

      const manifestPathA = path.join(custodyDirA, 'live2d-adapter.json');
      await rm(manifestPathA);
      await symlink(sidecar, manifestPathA);
      await expect(reuse()).rejects.toMatchObject({ code: 'invalid-path' });
      await rm(manifestPathA);
      await writeFile(manifestPathA, await readFile(sidecar));

      await writeFile(custodyPathA, JSON.stringify({ ...custodyA, local_asset_id: secondRefA }));
      await expect(reuse()).rejects.toMatchObject({ code: 'invalid-payload' });
      await writeFile(custodyPathA, custodyAJson);
      await expect(reuse()).resolves.toMatchObject({
        avatarAssetRef: refA,
        live2dAdapterManifestRef: manifestRef,
      });
    });
  });

  it('keeps identical background refs scoped for get, validate, and remove', async () => {
    await withTempDir('agent-center-scoped-background', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerAgentCenterBridge(dataRoot, protocolHost);
      const source = path.join(root, 'background.png');
      await writeFile(source, VALID_PNG);
      const refA = await importBackground(ipcMain, protocolHost, SCOPE_A, source);
      const refB = await importBackground(ipcMain, protocolHost, SCOPE_B, source);
      expect(refB).toBe(refA);
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
        { ...SCOPE_B, backgroundAssetRef: refB },
      )).resolves.toMatchObject({
        backgroundAssetRef: refB,
        url: expect.stringMatching(/^nimi-shell-file:\/\/local\//u),
        mimeType: 'image/png',
      });

      for (const command of [
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'],
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove'],
      ]) {
        for (const missingScope of [SCOPE_MISSING, SCOPE_ACCOUNT_A_AGENT_B, SCOPE_ACCOUNT_B_AGENT_A]) {
          await expect(invokeAgentCenter(ipcMain, command, {
            ...missingScope,
            backgroundAssetRef: refA,
          })).rejects.toMatchObject({ code: 'not-found' });
        }
      }

      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove'],
        { ...SCOPE_A, backgroundAssetRef: refA },
      )).resolves.toMatchObject({ removed: true });
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'],
        { ...SCOPE_B, backgroundAssetRef: refB },
      )).resolves.toMatchObject({ validationStatus: 'valid' });
    });
  });

  it('quarantines only the selected account Agent Center trees and preserves account custody', async () => {
    await withTempDir('agent-center-scoped-account-cleanup', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerAgentCenterBridge(dataRoot, protocolHost);
      const source = path.join(root, 'background.png');
      await writeFile(source, VALID_PNG);
      const refA = await importBackground(ipcMain, protocolHost, SCOPE_A, source);
      const refB = await importBackground(ipcMain, protocolHost, SCOPE_B, source);

      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove'],
        { hostScope: 'account', accountId: SCOPE_A.accountId },
      )).resolves.toEqual({ removed: true });
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'],
        { ...SCOPE_A, backgroundAssetRef: refA },
      )).rejects.toMatchObject({ code: 'not-found' });
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'],
        { ...SCOPE_B, backgroundAssetRef: refB },
      )).resolves.toMatchObject({ validationStatus: 'valid' });

      const accountRootA = path.join(dataRoot, 'agent-center', 'accounts', custodySegment(SCOPE_A.accountId));
      await expect(readdir(path.join(accountRootA, 'quarantine', 'agent_local_resources'))).resolves.toHaveLength(1);
      await expect(readdir(accountRootA)).resolves.toEqual(expect.arrayContaining(['agents', 'quarantine']));
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove'],
        { hostScope: 'account', accountId: SCOPE_A.accountId },
      )).resolves.toEqual({ removed: false });

      const quarantineAccountScope: Scope = {
        ...SCOPE_A,
        accountId: 'quarantine',
        ownerUserId: 'owner_quarantine',
        runtimeSourceRef: 'runtime-source:quarantine',
        localAgentRef: 'local-agent:quarantine',
      };
      const quarantineRef = await importBackground(ipcMain, protocolHost, quarantineAccountScope, source);
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove'],
        { hostScope: 'account', accountId: quarantineAccountScope.accountId },
      )).resolves.toEqual({ removed: true });
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'],
        { ...quarantineAccountScope, backgroundAssetRef: quarantineRef },
      )).rejects.toMatchObject({ code: 'not-found' });
    });
  });

  it('fails backgroundGet closed without the local asset protocol host', async () => {
    await withTempDir('agent-center-background-protocol', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const source = path.join(root, 'background.png');
      await writeFile(source, VALID_PNG);
      const importBridge = registerAgentCenterBridge(dataRoot, protocolHost);
      const ref = await importBackground(importBridge, protocolHost, SCOPE_A, source);
      const bridgeWithoutProtocol = registerAgentCenterBridge(dataRoot);

      await expect(invokeAgentCenter(
        bridgeWithoutProtocol,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
        { ...SCOPE_A, backgroundAssetRef: ref },
      )).rejects.toMatchObject({ code: 'capability-unavailable' });
    });
  });

  it('rejects traversal and symlink escapes in background manifests', async () => {
    await withTempDir('agent-center-background-paths', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerAgentCenterBridge(dataRoot, protocolHost);
      const source = path.join(root, 'background.png');
      await writeFile(source, VALID_PNG);
      const ref = await importBackground(ipcMain, protocolHost, SCOPE_A, source);
      const backgroundRoot = path.join(agentRoot(dataRoot, SCOPE_A), 'modules/appearance/backgrounds', ref);
      const manifestPath = path.join(backgroundRoot, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      await writeFile(manifestPath, JSON.stringify({ ...manifest, image_file: '../escape.png' }));

      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
        { ...SCOPE_A, backgroundAssetRef: ref },
      )).rejects.toMatchObject({ code: 'invalid-path' });

      await writeFile(manifestPath, JSON.stringify({ ...manifest, image_file: path.join(root, 'outside.png') }));
      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
        { ...SCOPE_A, backgroundAssetRef: ref },
      )).rejects.toMatchObject({ code: 'invalid-path' });

      await writeFile(manifestPath, JSON.stringify(manifest));
      const imagePath = path.join(backgroundRoot, String(manifest.image_file));
      await writeFile(path.join(root, 'outside.png'), VALID_PNG);
      await rm(imagePath);
      await symlink(path.join(root, 'outside.png'), imagePath);

      await expect(invokeAgentCenter(
        ipcMain,
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'],
        { ...SCOPE_A, backgroundAssetRef: ref },
      )).rejects.toMatchObject({ code: 'invalid-path' });
    });
  });
});
