import crypto from 'node:crypto';
import path from 'node:path';
import { copyFile, lstat, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { errorMessage } from './errors.js';
import { canonicalElectronPathCandidate, isSameOrChildPath } from './paths.js';
import { resolveElectronStandardDataRoot } from './data-root-binding.js';
import {
  MAX_AVATAR_ASSET_BYTES,
  MAX_AVATAR_ASSET_FILE_BYTES,
  MAX_AVATAR_ASSET_FILE_COUNT,
  backendCapabilityProfileRefFor,
  invalidAsset,
  invalidPayload,
  kindFromAvatarRef,
  notFound,
  parseAvatarAssetRef,
  parseBackendKind,
  parseLocalAgentScope,
  type AvatarBackendKind,
  type ValidationStatus,
} from './agent-center-contract.js';
import { validateAvatarAssetAt } from './agent-center-avatar-validation.js';
import {
  agentCenterDir,
  assertManagedPath,
  avatarAssetDir,
  avatarMaterializationRef,
  ensureManagedDirectory,
  managedPathExists,
  removeManagedPath,
  renameManagedPath,
  resolveBoundDataRoot,
  sha256,
  userSelectedSource,
  writeManagedJson,
} from './agent-center-paths.js';
import type { NimiElectronStandardShellHost } from './types.js';

type SourceFile = {
  readonly sourcePath: string;
  readonly packagePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mime: string;
};

const MAX_LIVE2D_ADAPTER_MANIFEST_BYTES = 262_144;

export async function importAvatarAsset(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await resolveBoundDataRoot(await resolveElectronStandardDataRoot(host, command), command);
  const scope = parseLocalAgentScope(payload, command);
  const kind = parseBackendKind(payload.backendKind, command);
  const source = await userSelectedSource(host, payload.sourcePath, command);
  const files = await readAvatarSourceFiles(kind, source, command);
  const contentDigest = avatarContentDigest(files.records);
  const avatarAssetRef = `${kind}_${contentDigest.slice(0, 12)}`;
  const finalDir = avatarAssetDir(dataRoot, scope, kind, avatarAssetRef);
  if (await managedPathExists(dataRoot, finalDir, command)) {
    const validation = await validateAvatarAssetAt(dataRoot, finalDir, scope, avatarAssetRef, kind, command);
    if (validation.validationStatus !== 'valid') {
      throw invalidAsset(command, validation.validationMessage ?? 'Avatar asset validation failed');
    }
    return avatarImportResult(avatarAssetRef, kind, validation);
  }
  const stagingDir = path.join(agentCenterDir(dataRoot, scope), 'modules', 'avatar_asset', 'staging', `${avatarAssetRef}_${Date.now()}`);
  await removeManagedPath(dataRoot, stagingDir, command);
  await ensureManagedDirectory(dataRoot, stagingDir, command);
  try {
    for (const file of files.records) {
      const target = path.join(stagingDir, file.packagePath);
      await ensureManagedDirectory(dataRoot, path.dirname(target), command);
      await assertManagedPath(dataRoot, target, command, true);
      await copyFile(file.sourcePath, target);
    }
    const sourceLabel = path.basename(source);
    const capabilityProfileRef = backendCapabilityProfileRefFor(kind, avatarAssetRef);
    await writeManagedJson(dataRoot, path.join(stagingDir, 'manifest.json'), {
      manifest_version: 1,
      asset_version: '1.0.0',
      local_asset_id: avatarAssetRef,
      kind,
      loader_min_version: '1.0.0',
      display_name: safeDisplayName(sourceLabel),
      display_name_i18n: {},
      entry_file: files.entryFile,
      required_files: [files.entryFile],
      content_digest: `sha256:${contentDigest}`,
      files: files.records.map((file) => ({
        path: file.packagePath,
        sha256: file.sha256,
        bytes: file.bytes,
        mime: file.mime,
      })),
      limits: {
        max_manifest_bytes: 262_144,
        max_asset_bytes: MAX_AVATAR_ASSET_BYTES,
        max_file_bytes: MAX_AVATAR_ASSET_FILE_BYTES,
        max_file_count: MAX_AVATAR_ASSET_FILE_COUNT,
      },
      capabilities: {
        backend_kind: kind,
        profile_ref: capabilityProfileRef,
        materialization_ref: avatarMaterializationRef(scope, kind, avatarAssetRef),
      },
      import: {
        imported_at: new Date().toISOString(),
        source_label: sourceLabel,
        source_fingerprint: `sha256:${contentDigest}`,
      },
    }, command);
    const validation = await validateAvatarAssetAt(dataRoot, stagingDir, scope, avatarAssetRef, kind, command);
    if (validation.validationStatus !== 'valid') {
      throw invalidAsset(command, validation.validationMessage ?? 'Avatar asset validation failed');
    }
    await renameManagedPath(dataRoot, stagingDir, finalDir, command);
    const finalValidation = await validateAvatarAssetAt(dataRoot, finalDir, scope, avatarAssetRef, kind, command);
    if (finalValidation.validationStatus !== 'valid') {
      throw invalidAsset(command, finalValidation.validationMessage ?? 'Final avatar asset validation failed');
    }
    return avatarImportResult(avatarAssetRef, kind, finalValidation);
  } catch (error) {
    await removeManagedPath(dataRoot, stagingDir, command);
    if (await managedPathExists(dataRoot, finalDir, command)) {
      const validation = await validateAvatarAssetAt(dataRoot, finalDir, scope, avatarAssetRef, kind, command);
      if (validation.validationStatus !== 'valid') await removeManagedPath(dataRoot, finalDir, command);
    }
    throw error;
  }
}

export async function validateAvatarAsset(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await resolveBoundDataRoot(await resolveElectronStandardDataRoot(host, command), command);
  const scope = parseLocalAgentScope(payload, command);
  const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
  const kind = kindFromAvatarRef(avatarAssetRef);
  const dir = avatarAssetDir(dataRoot, scope, kind, avatarAssetRef);
  if (!await managedPathExists(dataRoot, dir, command)) {
    throw notFound(command, `Avatar asset was not found: ${avatarAssetRef}`);
  }
  const validation = await validateAvatarAssetAt(dataRoot, dir, scope, avatarAssetRef, kind, command);
  return {
    avatarAssetRef,
    backendKind: kind,
    backendCapabilityProfileRef: backendCapabilityProfileRefFor(kind, avatarAssetRef),
    validationIssueRows: validation.validationMessage ? [validation.validationMessage] : [],
    ...validation,
  };
}

export async function resolveAvatarAssetPreview(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const result = await validateAvatarAsset(host, payload, command) as {
    avatarAssetRef: string;
    backendKind: AvatarBackendKind;
    validationStatus: ValidationStatus;
    validationMessage?: string;
  };
  if (result.validationStatus !== 'valid') {
    throw invalidAsset(command, result.validationMessage ?? 'Avatar asset validation failed');
  }
  const scope = parseLocalAgentScope(payload, command);
  return {
    avatarAssetRef: result.avatarAssetRef,
    backendKind: result.backendKind,
    previewMaterialRef: avatarMaterializationRef(scope, result.backendKind, result.avatarAssetRef),
    validationStatus: result.validationStatus,
    warnings: [],
  };
}

export async function importLive2dAdapterManifest(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await resolveBoundDataRoot(await resolveElectronStandardDataRoot(host, command), command);
  const scope = parseLocalAgentScope(payload, command);
  const avatarAssetRef = parseAvatarAssetRef(payload.avatarAssetRef, command);
  const avatarDir = avatarAssetDir(dataRoot, scope, 'live2d', avatarAssetRef);
  if (!await managedPathExists(dataRoot, avatarDir, command)) {
    throw notFound(command, `Avatar asset was not found: ${avatarAssetRef}`);
  }
  const validation = await validateAvatarAssetAt(dataRoot, avatarDir, scope, avatarAssetRef, 'live2d', command);
  if (validation.validationStatus !== 'valid') {
    throw invalidAsset(command, validation.validationMessage ?? 'Avatar asset validation failed');
  }
  const source = await userSelectedSource(host, payload.sourcePath, command);
  if (path.extname(source).toLowerCase() !== '.json') {
    throw invalidPayload(command, 'Live2D adapter manifest source must be JSON');
  }
  const raw = await readFile(source);
  if (raw.byteLength === 0 || raw.byteLength > MAX_LIVE2D_ADAPTER_MANIFEST_BYTES) {
    throw invalidPayload(command, 'Live2D adapter manifest is outside the fixed byte cap');
  }
  let parsed: Readonly<Record<string, unknown>>;
  try {
    const value = JSON.parse(raw.toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    parsed = value as Readonly<Record<string, unknown>>;
  } catch (error) {
    throw invalidPayload(command, `Live2D adapter manifest must be valid JSON: ${errorMessage(error)}`);
  }
  if (parsed.manifest_kind !== 'nimi.avatar.live2d.adapter' || parsed.schema_version !== 1) {
    throw invalidPayload(command, 'Live2D adapter manifest_kind/schema_version is not admitted');
  }
  const manifestRef = `live2d_adapter_${sha256(raw).slice(0, 12)}`;
  const adapterRoot = path.join(agentCenterDir(dataRoot, scope), 'modules', 'avatar_asset', 'adapter_manifests');
  const finalDir = path.join(adapterRoot, avatarAssetRef, manifestRef);
  const custody = {
    custody_version: 1,
    manifest_ref: manifestRef,
    local_asset_id: avatarAssetRef,
    manifest_kind: 'nimi.avatar.live2d.adapter',
    schema_version: 1,
    sha256: sha256(raw),
    bytes: raw.byteLength,
    imported_at: new Date().toISOString(),
    source_label: path.basename(source),
  } as const;
  if (await managedPathExists(dataRoot, finalDir, command)) {
    await validateLive2dAdapterCustody(dataRoot, finalDir, raw, custody, command);
  } else {
    const stagingDir = path.join(adapterRoot, 'staging', `${avatarAssetRef}_${manifestRef}_${Date.now()}`);
    await removeManagedPath(dataRoot, stagingDir, command);
    await ensureManagedDirectory(dataRoot, stagingDir, command);
    let finalized = false;
    try {
      const manifestPath = path.join(stagingDir, 'live2d-adapter.json');
      await assertManagedPath(dataRoot, manifestPath, command, true);
      await writeFile(manifestPath, raw);
      await writeManagedJson(dataRoot, path.join(stagingDir, 'custody.json'), custody, command);
      await validateLive2dAdapterCustody(dataRoot, stagingDir, raw, custody, command);
      await renameManagedPath(dataRoot, stagingDir, finalDir, command);
      finalized = true;
      await validateLive2dAdapterCustody(dataRoot, finalDir, raw, custody, command);
    } catch (error) {
      await removeManagedPath(dataRoot, stagingDir, command);
      if (finalized) await removeManagedPath(dataRoot, finalDir, command);
      throw error;
    }
  }
  return {
    avatarAssetRef,
    live2dAdapterManifestRef: manifestRef,
    live2dAdapterManifestSource: 'external_sidecar_manifest',
  };
}

async function validateLive2dAdapterCustody(
  dataRoot: string,
  dir: string,
  sourceBytes: Buffer,
  expected: Readonly<Record<string, unknown>>,
  command: string,
): Promise<void> {
  try {
    const entries = (await readdir(dir)).sort();
    if (entries.length !== 2
      || entries[0] !== 'custody.json'
      || entries[1] !== 'live2d-adapter.json') {
      throw new Error('adapter custody must contain exactly the manifest and custody record');
    }
    const manifestPath = await assertManagedPath(dataRoot, path.join(dir, 'live2d-adapter.json'), command);
    const custodyPath = await assertManagedPath(dataRoot, path.join(dir, 'custody.json'), command);
    for (const file of [manifestPath, custodyPath]) {
      const metadata = await lstat(file);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error('adapter custody entries must be real files');
      }
    }
    const manifestBytes = await readFile(manifestPath);
    const custody = JSON.parse(await readFile(custodyPath, 'utf8')) as unknown;
    if (!custody || typeof custody !== 'object' || Array.isArray(custody)) throw new Error('custody must be an object');
    const record = custody as Readonly<Record<string, unknown>>;
    const exactKeys = Object.keys(record).sort().join(',') === Object.keys(expected).sort().join(',');
    const exactAuthority = Object.entries(expected).every(([key, value]) => (
      key === 'imported_at' || key === 'source_label' || record[key] === value
    ));
    const validTimestamp = typeof record.imported_at === 'string'
      && record.imported_at.endsWith('Z')
      && Number.isFinite(Date.parse(record.imported_at));
    const validLabel = typeof record.source_label === 'string'
      && record.source_label.trim().length > 0
      && record.source_label.length <= 120
      && !path.isAbsolute(record.source_label)
      && !path.win32.isAbsolute(record.source_label);
    if (!manifestBytes.equals(sourceBytes) || !exactKeys || !exactAuthority || !validTimestamp || !validLabel) {
      throw new Error('adapter custody does not match exact content and asset scope');
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'invalid-path') throw error;
    throw invalidAsset(command, `Live2D adapter custody validation failed: ${errorMessage(error)}`);
  }
}

async function readAvatarSourceFiles(kind: AvatarBackendKind, source: string, command: string): Promise<{
  readonly records: readonly SourceFile[];
  readonly entryFile: string;
}> {
  const sourceStat = await stat(source);
  if (kind === 'vrm') {
    if (!sourceStat.isFile() || path.extname(source).toLowerCase() !== '.vrm') {
      throw invalidPayload(command, 'VRM source must be a .vrm file');
    }
    const record = await sourceFileRecord(source, `files/${path.basename(source)}`, 'model/vrm', command);
    return { records: [record], entryFile: record.packagePath };
  }
  if (!sourceStat.isDirectory()) {
    throw invalidPayload(command, 'Live2D source must be a directory');
  }
  const allFiles = await collectFiles(source, source, command);
  const modelEntries = allFiles.filter((file) => file.endsWith('.model3.json')).sort();
  if (modelEntries.length !== 1) {
    throw invalidPayload(command, 'Live2D source folder must contain exactly one .model3.json file');
  }
  const records = await Promise.all(allFiles.map(async (file) => {
    const relative = path.relative(source, file).split(path.sep).join('/');
    return sourceFileRecord(file, `files/${relative}`, avatarMime(file, kind), command);
  }));
  if (records.length > MAX_AVATAR_ASSET_FILE_COUNT) {
    throw invalidPayload(command, 'Avatar source contains too many files');
  }
  const total = records.reduce((sum, file) => sum + file.bytes, 0);
  if (total === 0 || total > MAX_AVATAR_ASSET_BYTES) {
    throw invalidPayload(command, 'Avatar source package is outside the fixed byte cap');
  }
  const entryFile = `files/${path.relative(source, modelEntries[0] ?? '').split(path.sep).join('/')}`;
  return { records: records.sort((a, b) => a.packagePath.localeCompare(b.packagePath)), entryFile };
}

async function collectFiles(root: string, current: string, command: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw invalidPayload(command, 'Agent Center import sources must not contain symlinks');
    }
    if (entry.isDirectory()) {
      out.push(...await collectFiles(root, target, command));
    } else if (entry.isFile()) {
      const canonical = await canonicalElectronPathCandidate(target);
      if (!isSameOrChildPath(root, canonical)) {
        throw invalidPayload(command, 'Agent Center import source escaped its root');
      }
      out.push(canonical);
    }
  }
  return out;
}

async function sourceFileRecord(sourcePath: string, packagePath: string, mime: string, command: string): Promise<SourceFile> {
  const bytes = await readFile(sourcePath);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AVATAR_ASSET_FILE_BYTES) {
    throw invalidPayload(command, 'Avatar source file is outside the fixed byte cap');
  }
  return { sourcePath, packagePath, bytes: bytes.byteLength, sha256: sha256(bytes), mime };
}

function avatarImportResult(
  avatarAssetRef: string,
  backendKind: AvatarBackendKind,
  validation: { readonly validationStatus: ValidationStatus; readonly validationMessage?: string },
) {
  return {
    avatarAssetRef,
    backendKind,
    backendCapabilityProfileRef: backendCapabilityProfileRefFor(backendKind, avatarAssetRef),
    ...validation,
  };
}

function avatarContentDigest(files: readonly SourceFile[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.packagePath);
    hash.update('\0');
    hash.update(String(file.bytes));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function avatarMime(filePath: string, kind: AvatarBackendKind): string {
  const ext = path.extname(filePath).toLowerCase();
  if (kind === 'vrm' && ext === '.vrm') return 'model/vrm';
  if (ext === '.json') return 'application/json';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function safeDisplayName(sourceLabel: string): string {
  const extension = path.extname(sourceLabel);
  const withoutExtension = extension ? sourceLabel.slice(0, -extension.length) : sourceLabel;
  const normalized = withoutExtension.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return (normalized || 'Imported avatar').slice(0, 80);
}
