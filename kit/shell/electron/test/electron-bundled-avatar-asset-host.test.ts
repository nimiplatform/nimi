import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  createElectronShellFileProtocolHost,
  createNimiElectronBundledAvatarAssetHost,
  type NimiElectronBundledAvatarRuntimeAsset,
} from '../src/main/index.js';
import { backendCapabilityProfileRefFor } from '../src/main/agent-center-contract.js';
import { avatarMaterializationRef } from '../src/main/agent-center-paths.js';
import { FakeElectronProtocol } from './fake-electron-protocol.js';
import { withTempDir } from './electron-shell-test-utils.js';

const ACCOUNT_ID = 'account-avatar-test';
const LOCAL_AGENT_REF = 'local-agent:avatar-test';
const RUNTIME_SOURCE_REF = 'runtime-agent:avatar-test';
const AVATAR_ASSET_REF = 'vrm_0123456789ab';
const FILE_NAME = 'avatar.vrm';

const SCOPE = {
  accountId: ACCOUNT_ID,
  ownerUserId: ACCOUNT_ID,
  runtimeSourceRef: RUNTIME_SOURCE_REF,
  localAgentRef: LOCAL_AGENT_REF,
} as const;

function avatarReference() {
  return {
    ...SCOPE,
    localAvatarAssetRef: AVATAR_ASSET_REF,
    backendKind: 'vrm',
    backendCapabilityProfileRef: backendCapabilityProfileRefFor('vrm', AVATAR_ASSET_REF),
    materializationRef: avatarMaterializationRef(SCOPE, 'vrm', AVATAR_ASSET_REF),
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

      const manifest = await host.resolve(avatarReference(), LOCAL_AGENT_REF);

      expect(resolveRuntimeAsset).toHaveBeenCalledOnce();
      expect(resolveRuntimeAsset).toHaveBeenCalledWith({
        agentId: LOCAL_AGENT_REF,
        assetRef: AVATAR_ASSET_REF,
      });
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

      await host.close();
    });
  });

  it.each([
    {
      name: 'bound Agent mismatch',
      agentId: 'local-agent:other',
      overrides: {},
      reasonCode: 'electron-agent-center-payload-invalid',
      message: 'launch Agent does not match',
      resolverCalls: 0,
    },
    {
      name: 'Runtime asset reference mismatch',
      agentId: LOCAL_AGENT_REF,
      overrides: { assetRef: 'vrm_fedcba987654' },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'does not match the committed reference',
      resolverCalls: 1,
    },
    {
      name: 'Runtime digest mismatch',
      agentId: LOCAL_AGENT_REF,
      overrides: { sha256: '0'.repeat(64) },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'digest does not match',
      resolverCalls: 1,
    },
    {
      name: 'unsafe Runtime filename',
      agentId: LOCAL_AGENT_REF,
      overrides: { fileName: '../avatar.vrm' },
      reasonCode: 'electron-agent-center-path-invalid',
      message: 'file name is unsafe',
      resolverCalls: 1,
    },
    {
      name: 'Runtime role mismatch',
      agentId: LOCAL_AGENT_REF,
      overrides: { role: 'background' },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'does not match the committed reference',
      resolverCalls: 1,
    },
    {
      name: 'Runtime backend mismatch',
      agentId: LOCAL_AGENT_REF,
      overrides: { backendKind: 'live2d' },
      reasonCode: 'electron-agent-center-asset-invalid',
      message: 'does not match the committed reference',
      resolverCalls: 1,
    },
  ])('rejects $name without admitting a local asset root', async ({
    agentId,
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

      await expect(host.resolve(avatarReference(), agentId)).rejects.toMatchObject({
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

      const manifest = await host.resolve(avatarReference(), LOCAL_AGENT_REF);
      const assetRoot = localAssetRoots[0]!;
      const sessionRoot = path.dirname(assetRoot);
      expect(await lstat(sessionRoot)).toMatchObject({});

      await expect(host.close()).resolves.toBeUndefined();

      expect(localAssetRoots).toEqual([]);
      await expect(lstat(assetRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(host.resolve(avatarReference(), LOCAL_AGENT_REF)).rejects.toMatchObject({
        reasonCode: 'electron-agent-center-resource-not-found',
      });
      expect(manifest.vrm_file_path).toBe(path.join(assetRoot, FILE_NAME));
      await expect(host.close()).resolves.toBeUndefined();
    });
  });
});
