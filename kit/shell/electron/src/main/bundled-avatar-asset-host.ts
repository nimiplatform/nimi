import path from 'node:path';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { TauriAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
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

export type NimiElectronBundledAvatarNasHandlerManifest = {
  readonly activity: readonly NimiElectronBundledAvatarNasHandlerEntry[];
  readonly event: readonly NimiElectronBundledAvatarNasHandlerEntry[];
  readonly continuous: readonly NimiElectronBundledAvatarNasHandlerEntry[];
  readonly config_json_path: string | null;
};

export type NimiElectronBundledAvatarNasHandlerEntry = {
  readonly file_stem: string;
  readonly absolute_path: string;
};

export type NimiElectronBundledAvatarAssetHost = {
  readonly resolveBoundPresentation: (input: {
    readonly avatarAssetRef: unknown;
    readonly backendKind: unknown;
  }, agentHandle: string) => Promise<{
    readonly manifest: TauriAvatarModelManifest;
    readonly materializationRef: string;
  }>;
  readonly readTextFile: (filePath: unknown) => Promise<string>;
  readonly scanNasHandlers: (nimiDir: unknown) => Promise<NimiElectronBundledAvatarNasHandlerManifest>;
  readonly assertAdmittedDirectory: (directoryPath: unknown) => Promise<string>;
  readonly detachDataRoot: () => Promise<void>;
  readonly close: () => Promise<void>;
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
  const materializations = new Map<string, Promise<TauriAvatarModelManifest>>();
  const sessionId = randomUUID();
  let sessionRoot: string | undefined;
  let closed = false;

  const closeHost = async (removeSessionRoot: boolean): Promise<void> => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([...materializations.values()]);
    for (const root of admittedAssetRoots) {
      const index = input.localAssetRoots.findIndex((candidate) => path.resolve(candidate) === path.resolve(root));
      if (index >= 0) input.localAssetRoots.splice(index, 1);
    }
    admittedAssetRoots.clear();
    materializations.clear();
    if (sessionRoot && removeSessionRoot) {
      await rm(sessionRoot, { recursive: true, force: true });
    }
    sessionRoot = undefined;
  };

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

  const assertAdmittedPath = async (value: unknown, requireDirectory: boolean): Promise<string> => {
    const raw = requiredAbsolutePath(value, requireDirectory ? 'nimiDir' : 'path');
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
    if (metadata.isSymbolicLink() || (requireDirectory ? !metadata.isDirectory() : !metadata.isFile())) {
      throw invalidPath(
        NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
        requireDirectory
          ? 'Avatar materialized directory must be a real directory.'
          : 'Avatar materialized file must be a real file.',
      );
    }
    return canonical;
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
      const cacheKey = `${boundAgentHandle}\0${avatarAssetRef}`;
      let pending = materializations.get(cacheKey);
      if (!pending) {
        pending = materializeRuntimeAsset({
          command,
          agentHandle: boundAgentHandle,
          assetRef: avatarAssetRef,
          expectedKind: kind,
          ensureSessionRoot,
          resolveRuntimeAsset: input.resolveRuntimeAsset,
          localAssetProtocolHost: input.localAssetProtocolHost,
          localAssetRoots: input.localAssetRoots,
          admittedAssetRoots,
        }).catch((error) => {
          materializations.delete(cacheKey);
          throw error;
        });
        materializations.set(cacheKey, pending);
      }
      return {
        manifest: await pending,
        materializationRef: avatarMaterializationRef(kind, avatarAssetRef),
      };
    },
    readTextFile: async (value) => {
      const filePath = await assertAdmittedPath(value, false);
      const metadata = await lstat(filePath);
      if (metadata.size <= 0 || metadata.size > MAX_AVATAR_ASSET_FILE_BYTES) {
        throw invalidAsset(
          NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
          'Avatar text file is outside the admitted byte cap.',
        );
      }
      return readFile(filePath, 'utf8');
    },
    scanNasHandlers: async (value) => {
      const nimiDir = await assertAdmittedPath(value, true);
      return {
        activity: await scanNasHandlerDirectory(path.join(nimiDir, 'activity'), assertAdmittedPath),
        event: await scanNasHandlerDirectory(path.join(nimiDir, 'event'), assertAdmittedPath),
        continuous: await scanNasHandlerDirectory(path.join(nimiDir, 'continuous'), assertAdmittedPath),
        config_json_path: await optionalAdmittedFile(path.join(nimiDir, 'config.json'), assertAdmittedPath),
      };
    },
    assertAdmittedDirectory: (value) => assertAdmittedPath(value, true),
    detachDataRoot: () => closeHost(false),
    close: () => closeHost(true),
  };
}

async function materializeRuntimeAsset(input: {
  readonly command: string;
  readonly agentHandle: string;
  readonly assetRef: string;
  readonly expectedKind: AvatarBackendKind;
  readonly ensureSessionRoot: () => Promise<string>;
  readonly resolveRuntimeAsset: CreateNimiElectronBundledAvatarAssetHostInput['resolveRuntimeAsset'];
  readonly localAssetProtocolHost: NimiElectronShellFileProtocolHost;
  readonly localAssetRoots: string[];
  readonly admittedAssetRoots: Set<string>;
}): Promise<TauriAvatarModelManifest> {
  const asset = await input.resolveRuntimeAsset({
    agentHandle: input.agentHandle,
    assetRef: input.assetRef,
  });
  validateRuntimeAsset(asset, input.assetRef, input.expectedKind, input.command);

  const root = await input.ensureSessionRoot();
  const stagingRoot = path.join(root, `.${asset.assetRef}.${randomUUID()}.staging`);
  const finalRoot = path.join(root, asset.assetRef);
  if (!isSameOrChildPath(root, stagingRoot) || !isSameOrChildPath(root, finalRoot)) {
    throw invalidPath(input.command, 'Avatar temporary materialization path escaped its session root.');
  }
  await mkdir(stagingRoot, { recursive: false });
  let finalized = false;
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
      await input.localAssetProtocolHost.registerReadableFile(readablePath, 'data-root');
    }
    input.admittedAssetRoots.add(canonicalAssetRoot);
    if (!input.localAssetRoots.some((candidate) => path.resolve(candidate) === path.resolve(canonicalAssetRoot))) {
      input.localAssetRoots.push(canonicalAssetRoot);
    }
    return projectModelManifest(asset.backendKind, canonicalEntryPath, canonicalAssetRoot);
  } catch (error) {
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
): Promise<TauriAvatarModelManifest> {
  const runtimeDir = path.dirname(entryPath);
  const modelId = kind === 'live2d'
    ? path.basename(entryPath).replace(/\.model3\.json$/u, '')
    : path.basename(entryPath, path.extname(entryPath));
  const nimiDir = await optionalDirectory(path.join(runtimeDir, 'nimi'), assetRoot);
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
    nimi_dir: nimiDir,
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

async function scanNasHandlerDirectory(
  directory: string,
  assertAdmittedPath: (value: unknown, requireDirectory: boolean) => Promise<string>,
): Promise<readonly NimiElectronBundledAvatarNasHandlerEntry[]> {
  const metadata = await lstat(directory).catch(() => undefined);
  if (!metadata) return [];
  const canonical = await assertAdmittedPath(directory, true);
  const output: NimiElectronBundledAvatarNasHandlerEntry[] = [];
  for (const entry of await readdir(canonical, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name.startsWith('_')) continue;
    const absolutePath = await assertAdmittedPath(path.join(canonical, entry.name), false);
    output.push({ file_stem: entry.name.slice(0, -3), absolute_path: absolutePath });
  }
  return output.sort((left, right) => left.file_stem.localeCompare(right.file_stem));
}

async function optionalAdmittedFile(
  candidate: string,
  assertAdmittedPath: (value: unknown, requireDirectory: boolean) => Promise<string>,
): Promise<string | null> {
  const metadata = await lstat(candidate).catch(() => undefined);
  if (!metadata) return null;
  return assertAdmittedPath(candidate, false);
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
