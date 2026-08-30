import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  createElectronShellFileProtocolHost,
  createNimiElectronBundledAvatarAssetHost,
  type NimiElectronBundledAvatarRuntimeAsset,
} from '../src/main/index.js';
import { FakeElectronProtocol } from './fake-electron-protocol.js';
import { withTempDir } from './electron-shell-test-utils.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;
const AVATAR_ASSET_REF = 'vrm_0123456789ab';
const LIVE2D_ASSET_REF = 'live2d_0123456789ab';
const FILE_NAME = 'avatar.vrm';

function avatarReference() {
  return {
    avatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
  } as const;
}

function live2dReference() {
  return {
    avatarAssetRef: LIVE2D_ASSET_REF,
    backendKind: 'live2d',
  } as const;
}

function minimalVrmGlb(): Uint8Array {
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: {
      VRMC_vrm: { specVersion: '1.0' },
    },
  }), 'utf8');
  const paddedJsonLength = Math.ceil(json.byteLength / 4) * 4;
  const bytes = Buffer.alloc(12 + 8 + paddedJsonLength, 0x20);
  bytes.write('glTF', 0, 'ascii');
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.byteLength, 8);
  bytes.writeUInt32LE(paddedJsonLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  json.copy(bytes, 20);
  return Uint8Array.from(bytes);
}

function runtimeAsset(
  content: Uint8Array,
  overrides: Readonly<Record<string, unknown>> = {},
): NimiElectronBundledAvatarRuntimeAsset {
  return {
    assetRef: AVATAR_ASSET_REF,
    role: 'avatar',
    backendKind: 'vrm',
    fileName: FILE_NAME,
    mediaType: 'model/gltf-binary',
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    ...overrides,
  } as NimiElectronBundledAvatarRuntimeAsset;
}

function storedZip(entries: readonly { readonly name: string; readonly content: Uint8Array }[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.byteLength, 18);
    local.writeUInt32LE(content.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.byteLength, 20);
    central.writeUInt32LE(content.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + content.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Uint8Array.from(Buffer.concat([...localParts, centralDirectory, eocd]));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe('bundled Avatar Runtime asset materialization', () => {
  it('atomically materializes validated Runtime VRM bytes below app-private data and admits the result', async () => {
    await withTempDir('bundled-avatar-runtime-asset', async (root) => {
      const appPrivateRoot = path.join(root, 'avatar-private');
      const content = minimalVrmGlb();
      const localAssetRoots: string[] = [];
      const protocolHost = createElectronShellFileProtocolHost({
        protocol: new FakeElectronProtocol(),
      });
      const resolveRuntimeAsset = vi.fn(async () => runtimeAsset(content));
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => appPrivateRoot,
        resolveRuntimeAsset,
        localAssetProtocolHost: protocolHost,
        localAssetRoots,
      });

      const resolved = await host.resolveBoundPresentation(avatarReference(), AGENT_HANDLE);
      const { manifest } = resolved;

      expect(resolveRuntimeAsset).toHaveBeenCalledOnce();
      expect(resolveRuntimeAsset).toHaveBeenCalledWith({
        agentHandle: AGENT_HANDLE,
        assetRef: AVATAR_ASSET_REF,
      });
      expect(resolved.materializationRef).toBe(`avatar-materialization:vrm:${AVATAR_ASSET_REF}`);
      expect(manifest).toEqual({
        kind: 'vrm',
        runtime_dir: localAssetRoots[0],
        model_id: 'avatar',
        model3_json_path: null,
        vrm_file_path: path.join(localAssetRoots[0]!, FILE_NAME),
        nimi_dir: null,
        motion_presets_dir: null,
        adapter_manifest_path: null,
        live2d_calibration_ref: null,
      });

      const canonicalAppPrivateRoot = await realpath(appPrivateRoot);
      const assetRoot = localAssetRoots[0]!;
      const sessionRoot = path.dirname(assetRoot);
      const relativeAssetRoot = path.relative(canonicalAppPrivateRoot, assetRoot);
      expect(relativeAssetRoot).not.toBe('');
      expect(relativeAssetRoot).not.toMatch(/^\.\.(?:[\\/]|$)/u);
      expect(path.isAbsolute(relativeAssetRoot)).toBe(false);
      expect(path.basename(assetRoot)).toBe(AVATAR_ASSET_REF);
      expect(path.basename(path.dirname(sessionRoot))).toBe('runtime-presentation-materialization');
      expect((await readdir(sessionRoot)).sort()).toEqual([AVATAR_ASSET_REF]);
      expect(await readdir(assetRoot)).toEqual([FILE_NAME]);
      expect(Buffer.from(await readFile(manifest.vrm_file_path!))).toEqual(Buffer.from(content));
      expect(await protocolHost.hasReadableFile(manifest.vrm_file_path!)).toBe(true);
      await protocolHost.quiesceDataRootReadableGrants();
      expect(await protocolHost.hasReadableFile(manifest.vrm_file_path!)).toBe(false);
      protocolHost.resumeDataRootReadableGrants();
      expect(await protocolHost.hasReadableFile(manifest.vrm_file_path!)).toBe(true);

      await host.close();
    });
  });

  it('materializes a validated Runtime Live2D ZIP and admits every extracted file', async () => {
    await withTempDir('bundled-avatar-runtime-live2d', async (root) => {
      const model = Buffer.from(JSON.stringify({
        Version: 3,
        FileReferences: { Moc: 'ren.moc3' },
      }), 'utf8');
      const moc = Uint8Array.from([0x4d, 0x4f, 0x43, 0x33]);
      const content = storedZip([
        { name: 'runtime/ren.model3.json', content: model },
        { name: 'runtime/ren.moc3', content: moc },
      ]);
      const localAssetRoots: string[] = [];
      const protocolHost = createElectronShellFileProtocolHost({
        protocol: new FakeElectronProtocol(),
      });
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => path.join(root, 'avatar-private'),
        resolveRuntimeAsset: async () => runtimeAsset(content, {
          assetRef: LIVE2D_ASSET_REF,
          backendKind: 'live2d',
          fileName: 'ren.zip',
          mediaType: 'application/zip',
        }),
        localAssetProtocolHost: protocolHost,
        localAssetRoots,
      });

      const { manifest } = await host.resolveBoundPresentation(live2dReference(), AGENT_HANDLE);
      const assetRoot = localAssetRoots[0]!;
      const modelPath = path.join(assetRoot, 'runtime', 'ren.model3.json');
      const mocPath = path.join(assetRoot, 'runtime', 'ren.moc3');
      expect(manifest).toEqual({
        kind: 'live2d',
        runtime_dir: path.join(assetRoot, 'runtime'),
        model_id: 'ren',
        model3_json_path: modelPath,
        vrm_file_path: null,
        nimi_dir: null,
        motion_presets_dir: null,
        adapter_manifest_path: null,
        live2d_calibration_ref: null,
      });
      expect(Buffer.from(await readFile(modelPath))).toEqual(model);
      expect(Buffer.from(await readFile(mocPath))).toEqual(Buffer.from(moc));
      expect(await protocolHost.hasReadableFile(modelPath)).toBe(true);
      expect(await protocolHost.hasReadableFile(mocPath)).toBe(true);

      await host.close();
    });
  });

  it('rejects a Runtime Live2D ZIP entry that escapes the materialization root', async () => {
    await withTempDir('bundled-avatar-runtime-live2d-reject', async (root) => {
      const content = storedZip([{
        name: '../ren.model3.json',
        content: Buffer.from('{"Version":3}', 'utf8'),
      }]);
      const localAssetRoots: string[] = [];
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => path.join(root, 'avatar-private'),
        resolveRuntimeAsset: async () => runtimeAsset(content, {
          assetRef: LIVE2D_ASSET_REF,
          backendKind: 'live2d',
          fileName: 'unsafe.zip',
          mediaType: 'application/zip',
        }),
        localAssetProtocolHost: createElectronShellFileProtocolHost({
          protocol: new FakeElectronProtocol(),
        }),
        localAssetRoots,
      });

      await expect(host.resolveBoundPresentation(live2dReference(), AGENT_HANDLE)).rejects.toMatchObject({
        reasonCode: 'electron-agent-center-path-invalid',
        message: expect.stringContaining('entry path is unsafe'),
      });
      expect(localAssetRoots).toEqual([]);

      await host.close();
    });
  });

  it.each([
    ['alternate data stream', 'runtime/ren.moc3:payload'],
    ['reserved device name', 'runtime/NUL.moc3'],
    ['trailing dot', 'runtime/ren.moc3.'],
    ['trailing space', 'runtime/ren.moc3 '],
  ])('rejects a Runtime Live2D ZIP entry with a Win32 %s path', async (_case, unsafeEntry) => {
    await withTempDir('bundled-avatar-runtime-live2d-win32-path', async (root) => {
      const content = storedZip([
        {
          name: 'runtime/ren.model3.json',
          content: Buffer.from('{"Version":3}', 'utf8'),
        },
        {
          name: unsafeEntry,
          content: Uint8Array.from([0x4d, 0x4f, 0x43, 0x33]),
        },
      ]);
      const localAssetRoots: string[] = [];
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => path.join(root, 'avatar-private'),
        resolveRuntimeAsset: async () => runtimeAsset(content, {
          assetRef: LIVE2D_ASSET_REF,
          backendKind: 'live2d',
          fileName: 'unsafe-win32.zip',
          mediaType: 'application/zip',
        }),
        localAssetProtocolHost: createElectronShellFileProtocolHost({
          protocol: new FakeElectronProtocol(),
        }),
        localAssetRoots,
      });

      await expect(host.resolveBoundPresentation(live2dReference(), AGENT_HANDLE)).rejects.toMatchObject({
        reasonCode: 'electron-agent-center-path-invalid',
        message: expect.stringContaining('entry path is unsafe'),
      });
      expect(localAssetRoots).toEqual([]);

      await host.close();
    });
  });

  it('rejects Runtime Live2D ZIP entries whose paths collide under Win32 case folding', async () => {
    await withTempDir('bundled-avatar-runtime-live2d-win32-collision', async (root) => {
      const content = storedZip([
        {
          name: 'runtime/ren.model3.json',
          content: Buffer.from('{"Version":3}', 'utf8'),
        },
        { name: 'runtime/Texture.png', content: Uint8Array.from([0x01]) },
        { name: 'runtime/texture.png', content: Uint8Array.from([0x02]) },
      ]);
      const localAssetRoots: string[] = [];
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => path.join(root, 'avatar-private'),
        resolveRuntimeAsset: async () => runtimeAsset(content, {
          assetRef: LIVE2D_ASSET_REF,
          backendKind: 'live2d',
          fileName: 'unsafe-collision.zip',
          mediaType: 'application/zip',
        }),
        localAssetProtocolHost: createElectronShellFileProtocolHost({
          protocol: new FakeElectronProtocol(),
        }),
        localAssetRoots,
      });

      await expect(host.resolveBoundPresentation(live2dReference(), AGENT_HANDLE)).rejects.toMatchObject({
        reasonCode: 'electron-agent-center-path-invalid',
        message: expect.stringContaining('duplicate materialization paths'),
      });
      expect(localAssetRoots).toEqual([]);

      await host.close();
    });
  });

  it.each([
    {
      name: 'invalid Agent handle',
      agentHandle: 'local-agent:other',
      overrides: {},
      reasonCode: 'electron-agent-center-payload-invalid',
      message: 'requires a canonical Agent handle',
      resolverCalls: 0,
    },
    {
      name: 'Runtime asset reference mismatch',
      agentHandle: AGENT_HANDLE,
      overrides: { assetRef: 'vrm_fedcba987654' },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'does not match the committed reference',
      resolverCalls: 1,
    },
    {
      name: 'Runtime digest mismatch',
      agentHandle: AGENT_HANDLE,
      overrides: { sha256: '0'.repeat(64) },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'digest does not match',
      resolverCalls: 1,
    },
    {
      name: 'unsafe Runtime filename',
      agentHandle: AGENT_HANDLE,
      overrides: { fileName: '../avatar.vrm' },
      reasonCode: 'electron-agent-center-path-invalid',
      message: 'file name is unsafe',
      resolverCalls: 1,
    },
    {
      name: 'Runtime role mismatch',
      agentHandle: AGENT_HANDLE,
      overrides: { role: 'background' },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'does not match the committed reference',
      resolverCalls: 1,
    },
    {
      name: 'Runtime backend mismatch',
      agentHandle: AGENT_HANDLE,
      overrides: { backendKind: 'live2d' },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'does not match the committed reference',
      resolverCalls: 1,
    },
  ])('rejects $name without admitting a local asset root', async ({
    agentHandle,
    overrides,
    reasonCode,
    message,
    resolverCalls,
  }) => {
    await withTempDir('bundled-avatar-runtime-reject', async (root) => {
      const content = minimalVrmGlb();
      const localAssetRoots: string[] = [];
      const resolveRuntimeAsset = vi.fn(async () => runtimeAsset(content, overrides));
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => path.join(root, 'avatar-private'),
        resolveRuntimeAsset,
        localAssetProtocolHost: createElectronShellFileProtocolHost({
          protocol: new FakeElectronProtocol(),
        }),
        localAssetRoots,
      });

      await expect(host.resolveBoundPresentation(avatarReference(), agentHandle)).rejects.toMatchObject({
        reasonCode,
        message: expect.stringContaining(message),
      });
      expect(resolveRuntimeAsset).toHaveBeenCalledTimes(resolverCalls);
      expect(localAssetRoots).toEqual([]);

      await host.close();
    });
  });

  it('removes the temporary session root and admitted local root on async close', async () => {
    await withTempDir('bundled-avatar-runtime-close', async (root) => {
      const content = minimalVrmGlb();
      const localAssetRoots: string[] = [];
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => path.join(root, 'avatar-private'),
        resolveRuntimeAsset: async () => runtimeAsset(content),
        localAssetProtocolHost: createElectronShellFileProtocolHost({
          protocol: new FakeElectronProtocol(),
        }),
        localAssetRoots,
      });

      const { manifest } = await host.resolveBoundPresentation(avatarReference(), AGENT_HANDLE);
      const assetRoot = localAssetRoots[0]!;
      const sessionRoot = path.dirname(assetRoot);
      expect(await lstat(sessionRoot)).toMatchObject({});

      await expect(host.close()).resolves.toBeUndefined();

      expect(localAssetRoots).toEqual([]);
      await expect(lstat(assetRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(host.resolveBoundPresentation(avatarReference(), AGENT_HANDLE)).rejects.toMatchObject({
        reasonCode: 'electron-agent-center-resource-not-found',
      });
      expect(manifest.vrm_file_path).toBe(path.join(assetRoot, FILE_NAME));
      await expect(host.close()).resolves.toBeUndefined();
    });
  });

  it('detaches a replacement root without cleaning former-root temporary bytes', async () => {
    await withTempDir('bundled-avatar-runtime-detach', async (root) => {
      const localAssetRoots: string[] = [];
      const host = createNimiElectronBundledAvatarAssetHost({
        resolveAppPrivateDataRoot: async () => path.join(root, 'avatar-private'),
        resolveRuntimeAsset: async () => runtimeAsset(minimalVrmGlb()),
        localAssetProtocolHost: createElectronShellFileProtocolHost({ protocol: new FakeElectronProtocol() }),
        localAssetRoots,
      });
      await host.resolveBoundPresentation(avatarReference(), AGENT_HANDLE);
      const assetRoot = localAssetRoots[0]!;
      await host.detachDataRoot();
      expect(localAssetRoots).toEqual([]);
      expect(await lstat(assetRoot)).toMatchObject({});
      await expect(host.resolveBoundPresentation(avatarReference(), AGENT_HANDLE)).rejects.toMatchObject({
        reasonCode: 'electron-agent-center-resource-not-found',
      });
    });
  });
});
