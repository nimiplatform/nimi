import path from 'node:path';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import type {
  AgentCenterLocalAvatarAssetReference,
  TauriAvatarModelManifest,
} from '@nimiplatform/kit/features/avatar/headless';
import {
  MAX_AVATAR_ASSET_FILE_BYTES,
  backendCapabilityProfileRefFor,
  invalidAsset,
  invalidPath,
  invalidPayload,
  notFound,
  parseAvatarAssetRef,
  parseBackendKind,
  parseLocalAgentScope,
  type AgentCenterScope,
  type AvatarBackendKind,
} from './agent-center-contract.js';
import { validateAvatarAssetAt } from './agent-center-avatar-validation.js';
import {
  assertManagedPath,
  avatarMaterializationRef,
  custodySegment,
  managedPathExists,
  readManifest,
  resolveBoundDataRoot,
  resolveManagedFile,
} from './agent-center-paths.js';
import { isSameOrChildPath } from './paths.js';
import type { NimiElectronShellFileProtocolHost } from './types.js';

export const NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND =
  'nimi_avatar_resolve_agent_center_avatar_asset';

const REFERENCE_KEYS = [
  'accountId',
  'ownerUserId',
  'runtimeSourceRef',
  'localAgentRef',
  'localAvatarAssetRef',
  'backendKind',
  'backendCapabilityProfileRef',
  'materializationRef',
] as const;

type AvatarAssetManifestProjection = {
  readonly entry_file: string;
  readonly files: readonly { readonly path: string }[];
};

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
  readonly resolve: (reference: unknown) => Promise<TauriAvatarModelManifest>;
  readonly readTextFile: (filePath: unknown) => Promise<string>;
  readonly scanNasHandlers: (nimiDir: unknown) => Promise<NimiElectronBundledAvatarNasHandlerManifest>;
  readonly assertAdmittedDirectory: (directoryPath: unknown) => Promise<string>;
  readonly close: () => void;
};

export type CreateNimiElectronBundledAvatarAssetHostInput = {
  /** Runtime-protected product-control projection; never renderer input. */
  readonly resolveSelectedDataRoot: () => Promise<string>;
  readonly localAssetProtocolHost: NimiElectronShellFileProtocolHost;
  /** The same mutable root list supplied to the bundled Avatar standard host. */
  readonly localAssetRoots: string[];
};

/**
 * Desktop-owned adapter for the existing Agent Center Avatar materialization.
 * It admits a root only after the complete Kit manifest validator passes, then
 * registers every declared file with the Electron file protocol. Renderer code
 * cannot select a data root or broaden the admitted filesystem boundary.
 */
export function createNimiElectronBundledAvatarAssetHost(
  input: CreateNimiElectronBundledAvatarAssetHostInput,
): NimiElectronBundledAvatarAssetHost {
  const admittedAssetRoots = new Set<string>();

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
    resolve: async (value) => {
      const reference = parseReference(value);
      const command = NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND;
      const dataRoot = await resolveBoundDataRoot(await input.resolveSelectedDataRoot(), command);
      const scope = referenceScope(reference, command);
      if (scope.accountId !== scope.ownerUserId) {
        throw invalidPayload(command, 'Bundled Avatar asset owner must match the current Runtime account.');
      }
      const kind = parseBackendKind(reference.backendKind, command);
      const avatarAssetRef = parseAvatarAssetRef(reference.localAvatarAssetRef, command);
      if (!avatarAssetRef.startsWith(`${kind}_`)) {
        throw invalidPayload(command, 'backendKind must match localAvatarAssetRef.');
      }
      if (reference.backendCapabilityProfileRef !== backendCapabilityProfileRefFor(kind, avatarAssetRef)) {
        throw invalidPayload(command, 'backendCapabilityProfileRef does not match the validated Avatar asset.');
      }
      if (reference.materializationRef !== avatarMaterializationRef(scope, kind, avatarAssetRef)) {
        throw invalidPayload(command, 'materializationRef does not match the validated Avatar asset scope.');
      }

      const assetRoot = selectedDataRootAvatarAssetDir(dataRoot, scope, kind, avatarAssetRef);
      if (!await managedPathExists(dataRoot, assetRoot, command)) {
        throw notFound(command, `Avatar asset is unavailable: ${avatarAssetRef}`);
      }
      const validation = await validateAvatarAssetAt(dataRoot, assetRoot, scope, avatarAssetRef, kind, command);
      if (validation.validationStatus !== 'valid') {
        throw invalidAsset(command, validation.validationMessage ?? 'Avatar asset validation failed.');
      }
      const canonicalAssetRoot = await assertManagedPath(dataRoot, assetRoot, command);
      const manifest = asAvatarAssetManifest(await readManifest(dataRoot, canonicalAssetRoot, command), command);
      const entryPath = await resolveManagedFile(dataRoot, canonicalAssetRoot, manifest.entry_file, command);
      const declaredFiles = await Promise.all(manifest.files.map((file) => (
        resolveManagedFile(dataRoot, canonicalAssetRoot, file.path, command)
      )));
      for (const filePath of declaredFiles) {
        await input.localAssetProtocolHost.registerReadableFile(filePath);
      }
      admittedAssetRoots.add(canonicalAssetRoot);
      if (!input.localAssetRoots.some((root) => path.resolve(root) === path.resolve(canonicalAssetRoot))) {
        input.localAssetRoots.push(canonicalAssetRoot);
      }
      return projectModelManifest(kind, entryPath, canonicalAssetRoot);
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
    close: () => {
      for (const root of admittedAssetRoots) {
        const index = input.localAssetRoots.findIndex((candidate) => path.resolve(candidate) === path.resolve(root));
        if (index >= 0) input.localAssetRoots.splice(index, 1);
      }
      admittedAssetRoots.clear();
    },
  };
}

function parseReference(value: unknown): AgentCenterLocalAvatarAssetReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidPayload(NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND, 'Avatar asset reference must be an object.');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...REFERENCE_KEYS].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw invalidPayload(
      NIMI_ELECTRON_BUNDLED_AVATAR_ASSET_RESOLVE_COMMAND,
      `Avatar asset reference keys must be exactly: ${expectedKeys.join(', ')}.`,
    );
  }
  return record as unknown as AgentCenterLocalAvatarAssetReference;
}

function referenceScope(reference: AgentCenterLocalAvatarAssetReference, command: string): AgentCenterScope {
  return parseLocalAgentScope({
    hostScope: 'local-agent',
    accountId: reference.accountId,
    ownerUserId: reference.ownerUserId,
    runtimeSourceRef: reference.runtimeSourceRef,
    localAgentRef: reference.localAgentRef,
  }, command);
}

function selectedDataRootAvatarAssetDir(
  dataRoot: string,
  scope: AgentCenterScope,
  kind: AvatarBackendKind,
  avatarAssetRef: string,
): string {
  return path.join(
    dataRoot,
    'accounts',
    custodySegment(scope.accountId),
    'agents',
    custodySegment(scope.localAgentRef),
    'agent-center',
    'modules',
    'avatar_asset',
    'packages',
    kind,
    avatarAssetRef,
  );
}

function asAvatarAssetManifest(
  value: Readonly<Record<string, unknown>>,
  command: string,
): AvatarAssetManifestProjection {
  if (typeof value.entry_file !== 'string' || !Array.isArray(value.files)) {
    throw invalidAsset(command, 'Validated Avatar manifest projection is incomplete.');
  }
  const files = value.files.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file) || typeof (file as { path?: unknown }).path !== 'string') {
      throw invalidAsset(command, 'Validated Avatar manifest file projection is incomplete.');
    }
    return { path: (file as { path: string }).path };
  });
  return { entry_file: value.entry_file, files };
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
