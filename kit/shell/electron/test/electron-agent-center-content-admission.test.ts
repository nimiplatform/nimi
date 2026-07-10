import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  createElectronShellFileProtocolHost,
  registerNimiElectronRuntimeBridge,
  type NimiElectronShellFileProtocolHost,
} from '../src/main/index.js';
import { FakeElectronProtocol } from './fake-electron-protocol.js';
import { FakeIpcMain, createInvokeEvent, invokeBridge, withTempDir } from './electron-shell-test-utils.js';

type Scope = {
  readonly hostScope: 'local-agent';
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

const SCOPE: Scope = {
  hostScope: 'local-agent' as const,
  accountId: 'content_account',
  ownerUserId: 'content_owner',
  runtimeSourceRef: 'runtime-source:content',
  localAgentRef: 'local-agent:content',
};

const VALID_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const VALID_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDwGiiimI//2Q==', 'base64');
const VALID_WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v0gUAA=', 'base64');

function registerBridge(dataRoot: string, protocolHost: NimiElectronShellFileProtocolHost): FakeIpcMain {
  const ipcMain = new FakeIpcMain();
  registerNimiElectronRuntimeBridge({
    appId: 'nimi.tester',
    runtimeEndpoint: '127.0.0.1:46371',
    allowedOrigins: ['http://localhost:1430'],
    ipcMain,
    createGrpcClient: async () => { throw new Error('not used'); },
    standardShellHost: {
      allowAllStandardShellCommands: true,
      standardDataRootBinding: {
        source: 'runtime-launch-projection',
        durableDataRoot: dataRoot,
        projectionRef: 'electron-agent-center-content-test',
      },
      localAssetProtocolHost: protocolHost,
    },
  });
  return ipcMain;
}

async function invoke(
  ipcMain: FakeIpcMain,
  command: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return invokeBridge(ipcMain, createInvokeEvent().event, { command, payload });
}

async function admit(protocolHost: NimiElectronShellFileProtocolHost, source: string): Promise<void> {
  await protocolHost.registerReadableFile(source);
}

function createGlb(jsonValue: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(jsonValue), 'utf8');
  const padding = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const bytes = Buffer.alloc(20 + jsonChunk.byteLength);
  bytes.write('glTF', 0, 'ascii');
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.byteLength, 8);
  bytes.writeUInt32LE(jsonChunk.byteLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(bytes, 20);
  return bytes;
}

async function createLive2dFixture(
  root: string,
  name: string,
  model: unknown,
  moc = Buffer.from('MOC3\x01valid'),
): Promise<string> {
  const source = path.join(root, name);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'model.model3.json'), typeof model === 'string' ? model : JSON.stringify(model));
  await writeFile(path.join(source, 'model.moc3'), moc);
  await writeFile(path.join(source, 'texture.png'), VALID_PNG);
  return source;
}

async function importAvatar(
  ipcMain: FakeIpcMain,
  protocolHost: NimiElectronShellFileProtocolHost,
  sourcePath: string,
  backendKind: 'live2d' | 'vrm',
  scope: Scope = SCOPE,
): Promise<unknown> {
  await admit(protocolHost, sourcePath);
  return invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'], {
    ...scope,
    sourcePath,
    backendKind,
  });
}

describe('Electron Agent Center content admission', () => {
  it('rejects malformed and structurally invalid Live2D imports before finalization', async () => {
    await withTempDir('agent-center-live2d-content', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const cases = [
        ['malformed', '{'],
        ['wrong-version', { Version: 2, FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] } }],
        ['missing-references', { Version: 3 }],
        ['missing-moc', { Version: 3, FileReferences: { Textures: ['texture.png'] } }],
        ['missing-textures', { Version: 3, FileReferences: { Moc: 'model.moc3', Textures: [] } }],
        ['case-mismatch', { Version: 3, FileReferences: { Moc: 'model.moc3', Textures: ['Texture.png'] } }],
      ] as const;
      for (const [name, model] of cases) {
        const source = await createLive2dFixture(root, name, model);
        await expect(importAvatar(ipcMain, protocolHost, source, 'live2d'), name).rejects.toMatchObject({
          code: 'invalid-payload',
          reasonCode: 'electron-agent-center-asset-invalid',
        });
      }
      const invalidMoc = await createLive2dFixture(root, 'invalid-moc', {
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      }, Buffer.from('NOTMOC'));
      await expect(importAvatar(ipcMain, protocolHost, invalidMoc, 'live2d')).rejects.toMatchObject({
        code: 'invalid-payload',
      });

      await expectManagedManifestAbsent(path.join(dataRoot, 'agent-center'));
    });
  });

  it('validates every optional Live2D reference and admits a complete minimal package', async () => {
    await withTempDir('agent-center-live2d-refs', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const invalid = await createLive2dFixture(root, 'optional-missing', {
        Version: 3,
        FileReferences: {
          Moc: 'model.moc3',
          Textures: ['texture.png'],
          Physics: 'missing.physics3.json',
          Pose: 'missing.pose3.json',
          UserData: 'missing.userdata3.json',
          DisplayInfo: 'missing.cdi3.json',
          Expressions: [{ File: 'missing.exp3.json' }],
          Motions: { Idle: [{ File: 'missing.motion3.json' }] },
        },
      });
      await expect(importAvatar(ipcMain, protocolHost, invalid, 'live2d')).rejects.toMatchObject({ code: 'invalid-payload' });

      const valid = await createLive2dFixture(root, 'valid', {
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      });
      await expect(importAvatar(ipcMain, protocolHost, valid, 'live2d')).resolves.toMatchObject({
        backendKind: 'live2d',
        validationStatus: 'valid',
      });
    });
  });

  it('validates the GLB container and admitted VRM extension', async () => {
    await withTempDir('agent-center-vrm-content', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      for (const [name, bytes] of [
        ['fake.vrm', Buffer.from('not glb')],
        ['missing-extension.vrm', createGlb({ asset: { version: '2.0' } })],
        ['missing-asset.vrm', createGlb({
          extensionsUsed: ['VRMC_vrm'],
          extensions: { VRMC_vrm: { specVersion: '1.0' } },
        })],
        ['missing-spec-version.vrm', createGlb({
          asset: { version: '2.0' },
          extensionsUsed: ['VRMC_vrm'],
          extensions: { VRMC_vrm: {} },
        })],
      ] as const) {
        const source = path.join(root, name);
        await writeFile(source, bytes);
        await expect(importAvatar(ipcMain, protocolHost, source, 'vrm'), name).rejects.toMatchObject({ code: 'invalid-payload' });
      }

      const valid = path.join(root, 'valid.vrm');
      await writeFile(valid, createGlb({
        asset: { version: '2.0' },
        extensionsUsed: ['VRMC_vrm'],
        extensions: { VRMC_vrm: { specVersion: '1.0' } },
      }));
      await expect(importAvatar(ipcMain, protocolHost, valid, 'vrm')).resolves.toMatchObject({
        backendKind: 'vrm',
        validationStatus: 'valid',
      });
    });
  });

  it('uses the exact Tauri custody-segment length boundary in materialization refs', async () => {
    await withTempDir('agent-center-materialization-segment', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const scope = { ...SCOPE, accountId: `~${'a'.repeat(128)}` };
      const source = await createLive2dFixture(root, 'long-account-id', {
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      });
      const avatar = await importAvatar(ipcMain, protocolHost, source, 'live2d', scope) as { avatarAssetRef: string };
      const manifestPath = await findManagedFile(dataRoot, avatar.avatarAssetRef, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { capabilities: { materialization_ref: string } };
      expect(manifest.capabilities.materialization_ref).toBe(
        `agent-center-avatar-asset:id_${sha256(scope.accountId).slice(0, 24)}:id_${sha256(scope.localAgentRef).slice(0, 24)}:live2d:${avatar.avatarAssetRef}`,
      );
    });
  });

  it('rejects an oversized Live2D sidecar before creating scoped custody', async () => {
    await withTempDir('agent-center-live2d-sidecar-cap', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const live2d = await createLive2dFixture(root, 'valid-live2d', {
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      });
      const avatar = await importAvatar(ipcMain, protocolHost, live2d, 'live2d') as { avatarAssetRef: string };
      const sidecar = path.join(root, 'oversized-adapter.json');
      await writeFile(sidecar, JSON.stringify({
        manifest_kind: 'nimi.avatar.live2d.adapter',
        schema_version: 1,
        padding: 'x'.repeat(262_144),
      }));
      await admit(protocolHost, sidecar);
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport'], {
        ...SCOPE,
        avatarAssetRef: avatar.avatarAssetRef,
        sourcePath: sidecar,
      })).rejects.toMatchObject({ code: 'invalid-payload' });
      const entries = await readdir(dataRoot, { recursive: true });
      expect(entries.some((entry) => entry === 'live2d-adapter.json')).toBe(false);
    });
  });

  it('rejects fake image bytes for every admitted background extension and leaves no final asset', async () => {
    await withTempDir('agent-center-background-content', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      for (const extension of ['png', 'jpg', 'webp']) {
        const source = path.join(root, `fake.${extension}`);
        await writeFile(source, Buffer.from(`fake-${extension}`));
        await admit(protocolHost, source);
        await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'], {
          ...SCOPE,
          sourcePath: source,
        }), extension).rejects.toMatchObject({ code: 'invalid-payload' });
      }
      for (const [name, bytes] of [
        ['header-only.png', Buffer.from('89504e470d0a1a0a00000000494844520000000100000001', 'hex')],
        ['header-only.jpg', Buffer.from('ffd8ffc00007080001000100', 'hex')],
        ['header-only.webp', forgedWebpHeader()],
        ['truncated.png', VALID_PNG.subarray(0, VALID_PNG.byteLength - 10)],
        ['truncated.jpg', VALID_JPEG.subarray(0, VALID_JPEG.byteLength - 2)],
        ['truncated.webp', VALID_WEBP.subarray(0, VALID_WEBP.byteLength - 4)],
      ] as const) {
        const source = path.join(root, name);
        await writeFile(source, bytes);
        await admit(protocolHost, source);
        await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'], {
          ...SCOPE,
          sourcePath: source,
        }), name).rejects.toMatchObject({ code: 'invalid-payload' });
      }
      await expectManagedManifestAbsent(path.join(dataRoot, 'agent-center'));
    });
  });

  it('admits real PNG, JPEG, and WebP backgrounds with exact MIME projection', async () => {
    await withTempDir('agent-center-background-formats', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      for (const [extension, mimeType, bytes] of [
        ['png', 'image/png', VALID_PNG],
        ['jpg', 'image/jpeg', VALID_JPEG],
        ['webp', 'image/webp', VALID_WEBP],
      ] as const) {
        const source = path.join(root, `valid.${extension}`);
        await writeFile(source, bytes);
        await admit(protocolHost, source);
        const imported = await invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'], {
          ...SCOPE,
          sourcePath: source,
        }) as { backgroundAssetRef: string };
        await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'], {
          ...SCOPE,
          backgroundAssetRef: imported.backgroundAssetRef,
        }), extension).resolves.toMatchObject({ validationStatus: 'valid' });
        await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'], {
          ...SCOPE,
          backgroundAssetRef: imported.backgroundAssetRef,
        }), extension).resolves.toMatchObject({ mimeType });
      }
    });
  });

  it('detects avatar and background manifest size/digest mismatch after import', async () => {
    await withTempDir('agent-center-digest-content', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const live2d = await createLive2dFixture(root, 'valid-live2d', {
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      });
      const avatar = await importAvatar(ipcMain, protocolHost, live2d, 'live2d') as { avatarAssetRef: string };
      const avatarManifest = await findManagedFile(dataRoot, avatar.avatarAssetRef, 'manifest.json');
      const avatarValue = JSON.parse(await readFile(avatarManifest, 'utf8')) as Record<string, unknown>;
      const files = avatarValue.files as Array<Record<string, unknown>>;
      files[0] = { ...files[0], bytes: Number(files[0]?.bytes) + 1 };
      await writeFile(avatarManifest, JSON.stringify(avatarValue));
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'], {
        ...SCOPE,
        avatarAssetRef: avatar.avatarAssetRef,
      })).resolves.toMatchObject({ validationStatus: 'invalid' });
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview'], {
        ...SCOPE,
        avatarAssetRef: avatar.avatarAssetRef,
      })).rejects.toMatchObject({ code: 'invalid-payload' });

      const backgroundSource = path.join(root, 'valid.png');
      await writeFile(backgroundSource, VALID_PNG);
      await admit(protocolHost, backgroundSource);
      const background = await invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'], {
        ...SCOPE,
        sourcePath: backgroundSource,
      }) as { backgroundAssetRef: string };
      const backgroundManifest = await findManagedFile(dataRoot, background.backgroundAssetRef, 'manifest.json');
      const backgroundValue = JSON.parse(await readFile(backgroundManifest, 'utf8')) as Record<string, unknown>;
      await writeFile(backgroundManifest, JSON.stringify({ ...backgroundValue, sha256: '0'.repeat(64) }));
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'], {
        ...SCOPE,
        backgroundAssetRef: background.backgroundAssetRef,
      })).resolves.toMatchObject({ validationStatus: 'invalid' });
    });
  });

  it('projects malformed avatar manifest structures and missing files custody as invalid', async () => {
    await withTempDir('agent-center-avatar-manifest-shape', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const source = await createLive2dFixture(root, 'valid-live2d', {
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      });
      const avatar = await importAvatar(ipcMain, protocolHost, source, 'live2d') as { avatarAssetRef: string };
      const manifestPath = await findManagedFile(dataRoot, avatar.avatarAssetRef, 'manifest.json');
      const originalManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;

      expect(originalManifest.capabilities).toEqual({
        backend_kind: 'live2d',
        profile_ref: `avatar.backend_profile:live2d:${avatar.avatarAssetRef}:import_validated`,
        materialization_ref: `agent-center-avatar-asset:${SCOPE.accountId}:id_${sha256(SCOPE.localAgentRef).slice(0, 24)}:live2d:${avatar.avatarAssetRef}`,
      });

      for (const [field, malformed] of [
        ['files', null],
        ['files', [null, 7]],
        ['required_files', {}],
        ['limits', []],
        ['capabilities', null],
        ['capabilities', {
          backend_kind: 'live2d',
          profile_ref: `avatar.backend_profile:live2d:${avatar.avatarAssetRef}:import_validated`,
          materialization_ref: 'agent-center-materialization:wrong',
        }],
        ['import', 'invalid'],
      ] as const) {
        await writeFile(manifestPath, JSON.stringify({ ...originalManifest, [field]: malformed }));
        await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'], {
          ...SCOPE,
          avatarAssetRef: avatar.avatarAssetRef,
        }), field).resolves.toMatchObject({ validationStatus: 'invalid' });
      }

      await writeFile(manifestPath, JSON.stringify({
        ...originalManifest,
        import: {
          ...(originalManifest.import as Record<string, unknown>),
          source_label: 'C:\\Users\\nimi\\avatar.model3.json',
        },
      }));
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'], {
        ...SCOPE,
        avatarAssetRef: avatar.avatarAssetRef,
      })).resolves.toMatchObject({ validationStatus: 'invalid' });

      await writeFile(manifestPath, JSON.stringify(originalManifest));
      await rename(path.join(path.dirname(manifestPath), 'files'), path.join(path.dirname(manifestPath), 'files-missing'));
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'], {
        ...SCOPE,
        avatarAssetRef: avatar.avatarAssetRef,
      })).resolves.toMatchObject({ validationStatus: 'invalid' });
    });
  });

  it('rejects manifest and parent directory symlinks inside managed custody', async () => {
    await withTempDir('agent-center-managed-symlink', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const source = path.join(root, 'valid.png');
      await writeFile(source, VALID_PNG);
      await admit(protocolHost, source);
      const result = await invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'], {
        ...SCOPE,
        sourcePath: source,
      }) as { backgroundAssetRef: string };
      const manifest = await findManagedFile(dataRoot, result.backgroundAssetRef, 'manifest.json');
      const outside = path.join(root, 'outside-manifest.json');
      await writeFile(outside, await readFile(manifest));
      await rm(manifest);
      await symlink(outside, manifest);
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet'], {
        ...SCOPE,
        backgroundAssetRef: result.backgroundAssetRef,
      })).rejects.toMatchObject({ code: 'invalid-path' });

      await rm(manifest);
      await writeFile(manifest, await readFile(outside));
      const accountRoot = path.join(dataRoot, 'agent-center', 'accounts', SCOPE.accountId);
      const movedAccountRoot = path.join(root, 'moved-account');
      await rename(accountRoot, movedAccountRoot);
      await symlink(movedAccountRoot, accountRoot, 'dir');
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate'], {
        ...SCOPE,
        backgroundAssetRef: result.backgroundAssetRef,
      })).rejects.toMatchObject({ code: 'invalid-path' });
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove'], {
        ...SCOPE,
      })).rejects.toMatchObject({ code: 'invalid-path' });
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove'], {
        hostScope: 'account',
        accountId: SCOPE.accountId,
      })).rejects.toMatchObject({ code: 'invalid-path' });
    });
  });

  it('emits catalogued invalid-path for avatar validate/preview and background remove', async () => {
    await withTempDir('agent-center-invalid-path-occurrence', async (root) => {
      const dataRoot = path.join(root, 'data');
      const protocolHost = createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() });
      const ipcMain = registerBridge(dataRoot, protocolHost);
      const avatarSource = await createLive2dFixture(root, 'valid-live2d', {
        Version: 3,
        FileReferences: { Moc: 'model.moc3', Textures: ['texture.png'] },
      });
      const avatar = await importAvatar(ipcMain, protocolHost, avatarSource, 'live2d') as { avatarAssetRef: string };
      const avatarManifest = await findManagedFile(dataRoot, avatar.avatarAssetRef, 'manifest.json');
      const avatarRoot = path.dirname(avatarManifest);
      const movedAvatarRoot = path.join(root, 'moved-avatar');
      await rename(avatarRoot, movedAvatarRoot);
      await symlink(movedAvatarRoot, avatarRoot, 'dir');
      for (const command of [
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate'],
        NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview'],
      ]) {
        await expect(invoke(ipcMain, command, {
          ...SCOPE,
          avatarAssetRef: avatar.avatarAssetRef,
        })).rejects.toMatchObject({ code: 'invalid-path' });
      }

      const backgroundSource = path.join(root, 'valid.png');
      await writeFile(backgroundSource, VALID_PNG);
      await admit(protocolHost, backgroundSource);
      const background = await invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport'], {
        ...SCOPE,
        sourcePath: backgroundSource,
      }) as { backgroundAssetRef: string };
      const backgroundManifest = await findManagedFile(dataRoot, background.backgroundAssetRef, 'manifest.json');
      const backgroundRoot = path.dirname(backgroundManifest);
      const movedBackgroundRoot = path.join(root, 'moved-background');
      await rename(backgroundRoot, movedBackgroundRoot);
      await symlink(movedBackgroundRoot, backgroundRoot, 'dir');
      await expect(invoke(ipcMain, NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove'], {
        ...SCOPE,
        backgroundAssetRef: background.backgroundAssetRef,
      })).rejects.toMatchObject({ code: 'invalid-path' });
    });
  });
});

async function findManagedFile(dataRoot: string, resourceRef: string, fileName: string): Promise<string> {
  const queue = [dataRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(target);
      if (entry.isFile() && entry.name === fileName && target.includes(resourceRef)) return target;
    }
  }
  throw new Error(`managed file not found: ${resourceRef}/${fileName}`);
}

async function expectManagedManifestAbsent(root: string): Promise<void> {
  const entries = await readdir(root, { recursive: true }).catch(() => []);
  expect(entries.some((entry) => entry === 'manifest.json' || entry.endsWith(`${path.sep}manifest.json`))).toBe(false);
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function forgedWebpHeader(): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'ascii');
  bytes.write('WEBPVP8X', 8, 'ascii');
  return bytes;
}
