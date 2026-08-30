import path from 'node:path';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { HostAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import {
  MAX_AVATAR_ASSET_FILE_BYTES,
  invalidAsset,
  invalidPath,
  invalidPayload,
  notFound,
  parseAvatarAssetRef,
  parseBackendKind,
  type AvatarBackendKind,
} from './agent-center-contract.js';
import { validateVrmGlb } from './agent-center-content.js';
import { avatarMaterializationRef, sha256 } from './agent-center-paths.js';
import { materializeLive2dZip } from './live2d-zip-materialization.js';
import { isSameOrChildPath } from './paths.js';
import type { NimiElectronShellFileProtocolHost } from './types.js';

export const NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND =
  'nimi_avatar_resolve_agent_center_avatar_asset';

export type NimiElectronBundledAvatarAssetHost = {
  readonly resolveBoundPresentation: (input: {
    readonly avatarAssetRef: unknown;
    readonly backendKind: unknown;
  }, agentHandle: string) => Promise<{
    readonly manifest: HostAvatarModelManifest;
    readonly materializationRef: string;
  }>;
  readonly releaseMaterialization: (materializationRef: string) => Promise<void>;
  readonly readTextFile: (filePath: unknown) => Promise<string>;
  readonly close: () => Promise<void>;
};

type MaterializedAvatarAsset = {
  readonly manifest: HostAvatarModelManifest;
  readonly materializationRef: string;
  readonly assetRoot: string;
  readonly readablePaths: readonly string[];
};

type MaterializationEntry = {
  readonly promise: Promise<MaterializedAvatarAsset>;
  readonly materializationRef: string;
  leases: number;
  disposed: boolean;
};

export type NimiElectronBundledAvatarRuntimeAsset = {
  readonly assetRef: string;
  readonly role: 'avatar';
  readonly backendKind: AvatarBackendKind;
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
};

export type CreateNimiElectronBundledAvatarAssetHostInput = {
  /** Desktop-bound app-private data root; never renderer input. */
  readonly resolveAppPrivateDataRoot: () => Promise<string>;
  /** Exact protected Runtime read for the Desktop-bound Local Agent. */
  readonly resolveRuntimeAsset: (input: {
    readonly agentHandle: string;
    readonly assetRef: string;
  }) => Promise<NimiElectronBundledAvatarRuntimeAsset>;
  readonly localAssetProtocolHost: NimiElectronShellFileProtocolHost;
  /** The same mutable root list supplied to the bundled Avatar standard host. */
  readonly localAssetRoots: string[];
};

/**
 * Desktop-owned adapter for Runtime-custodied Agent presentation assets.
 * Runtime returns only the current committed asset for the Desktop-bound Local
 * Agent. This host revalidates and temporarily materializes that exact content
 * below the Avatar app-private root for renderer-local file loading.
 */
export function createNimiElectronBundledAvatarAssetHost(
  input: CreateNimiElectronBundledAvatarAssetHostInput,
): NimiElectronBundledAvatarAssetHost {
  const admittedAssetRoots = new Set<string>();
  const materializations = new Map<string, MaterializationEntry>();
  const materializationKeysByRef = new Map<string, string>();
  const materializationDisposals = new Map<string, Promise<void>>();
  const sessionId = randomUUID();
  let sessionRoot: string | undefined;
  let closed = false;

  const ensureSessionRoot = async (): Promise<string> => {
    if (sessionRoot) return sessionRoot;
    const rawAppPrivateRoot = requiredAbsolutePath(
      await input.resolveAppPrivateDataRoot(),
      'appPrivateDataRoot',
    );
    await mkdir(rawAppPrivateRoot, { recursive: true });
    const appPrivateRoot = await realpath(rawAppPrivateRoot);
    const appPrivateMetadata = await lstat(appPrivateRoot);
    if (appPrivateMetadata.isSymbolicLink() || !appPrivateMetadata.isDirectory()) {
      throw invalidPath(
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
        'Avatar app-private data root must be a real directory.',
      );
    }
    const candidate = path.join(
      appPrivateRoot,
      'runtime-presentation-materialization',
      sessionId,
    );
    await mkdir(candidate, { recursive: true });
    const canonical = await realpath(candidate);
    if (!isSameOrChildPath(appPrivateRoot, canonical)) {
      throw invalidPath(
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
        'Avatar temporary materialization escaped the app-private data root.',
      );
    }
    sessionRoot = canonical;
    return canonical;
  };

  const assertAdmittedFile = async (value: unknown): Promise<string> => {
    const raw = requiredAbsolutePath(value, 'path');
    const canonical = await realpath(raw).catch(() => {
      throw notFound(NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND, 'Avatar materialized path is unavailable.');
    });
    const admittedRoot = [...admittedAssetRoots].find((root) => isSameOrChildPath(root, canonical));
    if (!admittedRoot) {
      throw invalidPath(
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
        'Avatar materialized path is outside the validated launch asset.',
      );
    }
    const metadata = await lstat(canonical);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw invalidPath(
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
        'Avatar materialized file must be a real file.',
      );
    }
    return canonical;
  };

  const disposeMaterialization = async (
    cacheKey: string,
    entry: MaterializationEntry,
  ): Promise<void> => {
    if (entry.disposed) {
      await materializationDisposals.get(entry.materializationRef);
      return;
    }
    entry.disposed = true;
    materializations.delete(cacheKey);
    if (materializationKeysByRef.get(entry.materializationRef) === cacheKey) {
      materializationKeysByRef.delete(entry.materializationRef);
    }
    const disposal = (async () => {
      const materialized = await entry.promise.catch(() => null);
      if (!materialized) return;
      await Promise.allSettled(materialized.readablePaths.map((readablePath) => (
        input.localAssetProtocolHost.unregisterReadableFile?.(readablePath)
          ?? Promise.resolve()
      )));
      admittedAssetRoots.delete(materialized.assetRoot);
      const rootIndex = input.localAssetRoots.findIndex(
        (candidate) => path.resolve(candidate) === path.resolve(materialized.assetRoot),
      );
      if (rootIndex >= 0) input.localAssetRoots.splice(rootIndex, 1);
      await rm(materialized.assetRoot, { recursive: true, force: true });
    })();
    materializationDisposals.set(entry.materializationRef, disposal);
    try {
      await disposal;
    } finally {
      if (materializationDisposals.get(entry.materializationRef) === disposal) {
        materializationDisposals.delete(entry.materializationRef);
      }
    }
  };

  return {
    resolveBoundPresentation: async (value, agentHandle) => {
      if (closed) {
        throw notFound(
          NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
          'Avatar temporary materialization host is closed.',
        );
      }
      const command = NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND;
      const boundAgentHandle = requiredAgentHandle(agentHandle, command);
      const kind = parseBackendKind(value.backendKind, command);
      const avatarAssetRef = parseAvatarAssetRef(value.avatarAssetRef, command);
      if (!avatarAssetRef.startsWith(`${kind}_`)) {
        throw invalidPayload(command, 'backendKind must match avatarAssetRef.');
      }
      // Revalidate the current session-scoped Agent handle on every resolve.
      // Materialization itself is content-addressed so a technical-session
      // rotation can reuse the already validated exact bytes without racing a
      // second rename into the same asset root.
      const asset = await input.resolveRuntimeAsset({
        agentHandle: boundAgentHandle,
        assetRef: avatarAssetRef,
      });
      if (closed) {
        throw notFound(
          NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
          'Avatar temporary materialization host is closed.',
        );
      }
      validateRuntimeAsset(asset, avatarAssetRef, kind, command);
      const cacheKey = `${kind}\0${avatarAssetRef}\0${asset.sha256}`;
      const materializationRef = avatarMaterializationRef(kind, avatarAssetRef);
      await materializationDisposals.get(materializationRef);
      if (closed) {
        throw notFound(
          NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
          'Avatar temporary materialization host is closed.',
        );
      }
      const existingKey = materializationKeysByRef.get(materializationRef);
      if (existingKey && existingKey !== cacheKey) {
        throw invalidAsset(command, 'Runtime changed bytes for an admitted Avatar materialization reference.');
      }
      let entry = materializations.get(cacheKey);
      if (!entry) {
        const pending = materializeRuntimeAsset({
          command,
          asset,
          materializationRef,
          ensureSessionRoot,
          localAssetProtocolHost: input.localAssetProtocolHost,
          localAssetRoots: input.localAssetRoots,
          admittedAssetRoots,
        }).catch((error) => {
          materializations.delete(cacheKey);
          if (materializationKeysByRef.get(materializationRef) === cacheKey) {
            materializationKeysByRef.delete(materializationRef);
          }
          throw error;
        });
        entry = { promise: pending, materializationRef, leases: 0, disposed: false };
        materializations.set(cacheKey, entry);
        materializationKeysByRef.set(materializationRef, cacheKey);
      }
      const materialized = await entry.promise;
      if (closed || entry.disposed) {
        await disposeMaterialization(cacheKey, entry);
        throw notFound(
          NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
          'Avatar temporary materialization host is closed.',
        );
      }
      entry.leases += 1;
      return {
        manifest: materialized.manifest,
        materializationRef,
      };
    },
    releaseMaterialization: async (materializationRef) => {
      const cacheKey = materializationKeysByRef.get(materializationRef);
      if (!cacheKey) return;
      const entry = materializations.get(cacheKey);
      if (!entry || entry.disposed) return;
      entry.leases = Math.max(0, entry.leases - 1);
      if (entry.leases === 0) {
        await disposeMaterialization(cacheKey, entry);
      }
    },
    readTextFile: async (value) => {
      const filePath = await assertAdmittedFile(value);
      const metadata = await lstat(filePath);
      if (metadata.size <= 0 || metadata.size > MAX_AVATAR_ASSET_FILE_BYTES) {
        throw invalidAsset(
          NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
          'Avatar text file is outside the admitted byte cap.',
        );
      }
      return readFile(filePath, 'utf8');
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled([...materializations.entries()].map(
        ([cacheKey, entry]) => disposeMaterialization(cacheKey, entry),
      ));
      await Promise.allSettled([...materializationDisposals.values()]);
      admittedAssetRoots.clear();
      materializations.clear();
      materializationKeysByRef.clear();
      materializationDisposals.clear();
      if (sessionRoot) {
        await rm(sessionRoot, { recursive: true, force: true });
        sessionRoot = undefined;
      }
    },
  };
}

async function materializeRuntimeAsset(input: {
  readonly command: string;
  readonly asset: NimiElectronBundledAvatarRuntimeAsset;
  readonly materializationRef: string;
  readonly ensureSessionRoot: () => Promise<string>;
  readonly localAssetProtocolHost: NimiElectronShellFileProtocolHost;
  readonly localAssetRoots: string[];
  readonly admittedAssetRoots: Set<string>;
}): Promise<MaterializedAvatarAsset> {
  const { asset } = input;

  const root = await input.ensureSessionRoot();
  const stagingRoot = path.join(root, `.${asset.assetRef}.${randomUUID()}.staging`);
  const finalRoot = path.join(root, asset.assetRef);
  if (!isSameOrChildPath(root, stagingRoot) || !isSameOrChildPath(root, finalRoot)) {
    throw invalidPath(input.command, 'Avatar temporary materialization path escaped its session root.');
  }
  await mkdir(stagingRoot, { recursive: false });
  let finalized = false;
  let admittedRoot: string | null = null;
  const registeredReadablePaths: string[] = [];
  try {
    const materialized = asset.backendKind === 'live2d'
      ? await materializeLive2dZip(asset.content, stagingRoot, input.command)
      : await materializeVrm(asset, stagingRoot, input.command);
    await rename(stagingRoot, finalRoot);
    finalized = true;
    const canonicalAssetRoot = await realpath(finalRoot);
    const canonicalEntryPath = await realpath(path.join(
      finalRoot,
      ...materialized.entryRelativePath.split('/'),
    ));
    if (!isSameOrChildPath(root, canonicalAssetRoot)
      || !isSameOrChildPath(canonicalAssetRoot, canonicalEntryPath)) {
      throw invalidPath(input.command, 'Avatar temporary materialization escaped its admitted root.');
    }
    for (const relativePath of materialized.fileRelativePaths) {
      const readablePath = await realpath(path.join(finalRoot, ...relativePath.split('/')));
      if (!isSameOrChildPath(canonicalAssetRoot, readablePath)) {
        throw invalidPath(input.command, 'Avatar materialized file escaped its admitted root.');
      }
      await input.localAssetProtocolHost.registerReadableFile(readablePath);
      registeredReadablePaths.push(readablePath);
    }
    input.admittedAssetRoots.add(canonicalAssetRoot);
    admittedRoot = canonicalAssetRoot;
    if (!input.localAssetRoots.some((candidate) => path.resolve(candidate) === path.resolve(canonicalAssetRoot))) {
      input.localAssetRoots.push(canonicalAssetRoot);
    }
    const manifest = await projectModelManifest(asset.backendKind, canonicalEntryPath, canonicalAssetRoot);
    return {
      manifest,
      materializationRef: input.materializationRef,
      assetRoot: canonicalAssetRoot,
      readablePaths: registeredReadablePaths,
    };
  } catch (error) {
    await Promise.allSettled(registeredReadablePaths.map((readablePath) => (
      input.localAssetProtocolHost.unregisterReadableFile?.(readablePath)
        ?? Promise.resolve()
    )));
    if (admittedRoot) {
      input.admittedAssetRoots.delete(admittedRoot);
      const rootIndex = input.localAssetRoots.findIndex(
        (candidate) => path.resolve(candidate) === path.resolve(admittedRoot!),
      );
      if (rootIndex >= 0) input.localAssetRoots.splice(rootIndex, 1);
    }
    if (finalized) await rm(finalRoot, { recursive: true, force: true });
    throw error;
  } finally {
    if (!finalized) await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function materializeVrm(
  asset: NimiElectronBundledAvatarRuntimeAsset,
  stagingRoot: string,
  command: string,
): Promise<{ readonly entryRelativePath: string; readonly fileRelativePaths: readonly string[] }> {
  const entryPath = path.join(stagingRoot, asset.fileName);
  await writeFile(entryPath, asset.content, { flag: 'wx' });
  const metadata = await lstat(entryPath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size !== asset.content.byteLength) {
    throw invalidAsset(command, 'Avatar temporary materialization did not preserve exact Runtime bytes.');
  }
  return { entryRelativePath: asset.fileName, fileRelativePaths: [asset.fileName] };
}

function validateRuntimeAsset(
  asset: NimiElectronBundledAvatarRuntimeAsset,
  expectedRef: string,
  expectedKind: AvatarBackendKind,
  command: string,
): void {
  if (!asset || typeof asset !== 'object') {
    throw invalidAsset(command, 'Runtime returned an invalid Avatar presentation asset.');
  }
  if (asset.assetRef !== expectedRef
    || asset.role !== 'avatar'
    || asset.backendKind !== expectedKind
    || !asset.assetRef.startsWith(`${asset.backendKind}_`)) {
    throw invalidAsset(command, 'Runtime Avatar presentation asset does not match the committed reference.');
  }
  if (!(asset.content instanceof Uint8Array)
    || asset.content.byteLength <= 0
    || asset.content.byteLength > MAX_AVATAR_ASSET_FILE_BYTES) {
    throw invalidAsset(command, 'Runtime Avatar presentation bytes are outside the admitted byte cap.');
  }
  if (!/^[a-f0-9]{64}$/u.test(asset.sha256) || sha256(asset.content) !== asset.sha256) {
    throw invalidAsset(command, 'Runtime Avatar presentation digest does not match its content.');
  }
  const fileName = safeRuntimeFileName(asset.fileName, command);
  if (asset.backendKind === 'vrm') {
    if (path.extname(fileName).toLowerCase() !== '.vrm'
      || asset.mediaType !== 'model/gltf-binary') {
      throw invalidAsset(command, 'Runtime VRM presentation metadata is invalid.');
    }
    const validationError = validateVrmGlb(asset.content);
    if (validationError) throw invalidAsset(command, validationError);
    return;
  }
  if (path.extname(fileName).toLowerCase() !== '.zip' || asset.mediaType !== 'application/zip') {
    throw invalidAsset(command, 'Runtime Live2D presentation metadata is invalid.');
  }
}

function safeRuntimeFileName(value: unknown, command: string): string {
  const fileName = typeof value === 'string' ? value : '';
  if (!fileName
    || fileName.trim() !== fileName
    || fileName.length > 255
    || fileName !== path.basename(fileName)
    || fileName !== path.win32.basename(fileName)
    || path.isAbsolute(fileName)
    || path.win32.isAbsolute(fileName)
    || /[\u0000-\u001f\u007f]/u.test(fileName)) {
    throw invalidPath(command, 'Runtime Avatar presentation file name is unsafe.');
  }
  return fileName;
}

async function projectModelManifest(
  kind: AvatarBackendKind,
  entryPath: string,
  assetRoot: string,
): Promise<HostAvatarModelManifest> {
  const runtimeDir = path.dirname(entryPath);
  const modelId = kind === 'live2d'
    ? path.basename(entryPath).replace(/\.model3\.json$/u, '')
    : path.basename(entryPath, path.extname(entryPath));
  const adapterManifestPath = kind === 'live2d'
    ? await optionalFile(path.join(runtimeDir, 'nimi', 'live2d-adapter.json'), assetRoot)
    : null;
  const motionPresetsDir = kind === 'vrm'
    ? await optionalDirectory(path.join(runtimeDir, 'vrm-motion-presets'), assetRoot)
    : null;
  return {
    kind,
    runtime_dir: runtimeDir,
    model_id: modelId,
    model3_json_path: kind === 'live2d' ? entryPath : null,
    vrm_file_path: kind === 'vrm' ? entryPath : null,
    // Committed presentation assets may carry the validated adapter manifest,
    // but ordinary P0 materialization never enables creator NAS execution.
    nimi_dir: null,
    motion_presets_dir: motionPresetsDir,
    adapter_manifest_path: adapterManifestPath,
    live2d_calibration_ref: null,
  };
}

async function optionalDirectory(candidate: string, assetRoot: string): Promise<string | null> {
  const metadata = await lstat(candidate).catch(() => undefined);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw invalidPath(NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND, 'Avatar optional directory is invalid.');
  }
  const canonical = await realpath(candidate);
  if (!isSameOrChildPath(assetRoot, canonical)) {
    throw invalidPath(NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND, 'Avatar optional directory escaped the asset root.');
  }
  return canonical;
}

async function optionalFile(candidate: string, assetRoot: string): Promise<string | null> {
  const metadata = await lstat(candidate).catch(() => undefined);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw invalidPath(NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND, 'Avatar optional file is invalid.');
  }
  const canonical = await realpath(candidate);
  if (!isSameOrChildPath(assetRoot, canonical)) {
    throw invalidPath(NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND, 'Avatar optional file escaped the asset root.');
  }
  return canonical;
}

function requiredAbsolutePath(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !path.isAbsolute(normalized)) {
    throw invalidPath(
      NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
      `Avatar materialized ${field} must be an absolute host-resolved path.`,
    );
  }
  return path.resolve(normalized);
}

function requiredAgentHandle(value: unknown, command: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(normalized)) {
    throw invalidPayload(command, 'Bundled Avatar launch requires a canonical Agent handle.');
  }
  return normalized;
}
