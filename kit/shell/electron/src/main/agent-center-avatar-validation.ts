import crypto from 'node:crypto';
import path from 'node:path';
import { lstat, readFile, readdir } from 'node:fs/promises';
import {
  MAX_AVATAR_ASSET_BYTES,
  MAX_AVATAR_ASSET_FILE_BYTES,
  MAX_AVATAR_ASSET_FILE_COUNT,
  backendCapabilityProfileRefFor,
  type AgentCenterScope,
  type AvatarBackendKind,
} from './agent-center-contract.js';
import { validateVrmGlb } from './agent-center-content.js';
import {
  assertManagedPath,
  avatarMaterializationRef,
  isSafePackageRelativePath,
  resolveManagedFile,
  sha256,
} from './agent-center-paths.js';

const MAX_AVATAR_ASSET_MANIFEST_BYTES = 262_144;

type ManifestFile = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mime: string;
};

type AvatarManifest = {
  readonly manifest_version: number;
  readonly asset_version: string;
  readonly local_asset_id: string;
  readonly kind: AvatarBackendKind;
  readonly loader_min_version: string;
  readonly display_name: string;
  readonly display_name_i18n: Readonly<Record<string, unknown>>;
  readonly entry_file: string;
  readonly required_files: readonly string[];
  readonly content_digest: string;
  readonly files: readonly ManifestFile[];
  readonly limits: {
    readonly max_manifest_bytes: number;
    readonly max_asset_bytes: number;
    readonly max_file_bytes: number;
    readonly max_file_count: number;
  };
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly import: {
    readonly imported_at: string;
    readonly source_label: string;
    readonly source_fingerprint: string;
  };
};

export type AvatarValidation = {
  readonly validationStatus: 'valid' | 'invalid';
  readonly validationMessage?: string;
};

export async function validateAvatarAssetAt(
  dataRoot: string,
  assetRoot: string,
  scope: AgentCenterScope,
  avatarAssetRef: string,
  kind: AvatarBackendKind,
  command: string,
): Promise<AvatarValidation> {
  const failures: string[] = [];
  const manifest = await readAvatarManifest(dataRoot, assetRoot, command, failures);
  if (!manifest) return invalid(failures);

  validateManifestShape(manifest, scope, avatarAssetRef, kind, failures);
  const seen = new Set<string>();
  const records: ManifestFile[] = [];
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!validateFileRecord(file, kind, failures)) {
      continue;
    }
    if (seen.has(file.path)) {
      failures.push(`Duplicate Avatar manifest file record: ${file.path}`);
      continue;
    }
    seen.add(file.path);
    const target = await resolveManagedFile(dataRoot, assetRoot, file.path, command).catch((error) => {
      if (isInvalidPathError(error)) throw error;
      failures.push(`Avatar manifest file is missing: ${file.path}`);
      return undefined;
    });
    if (!target) continue;
    const bytes = await readFile(target);
    const digest = sha256(bytes);
    if (bytes.byteLength !== file.bytes) failures.push(`Avatar manifest byte count mismatch: ${file.path}`);
    if (digest !== file.sha256) failures.push(`Avatar manifest digest mismatch: ${file.path}`);
    totalBytes += file.bytes;
    records.push(file);
  }
  if (totalBytes === 0 || totalBytes > MAX_AVATAR_ASSET_BYTES) {
    failures.push('Avatar package is outside the fixed aggregate byte cap.');
  }
  const actualFiles = await collectManagedFiles(dataRoot, path.join(assetRoot, 'files'), command).catch((error) => {
    if (isInvalidPathError(error)) throw error;
    failures.push('Avatar files/ custody is missing or unreadable.');
    return [];
  });
  const actualRelative = actualFiles.map((file) => path.relative(assetRoot, file).split(path.sep).join('/')).sort();
  const declaredRelative = [...seen].sort();
  if (!sameStrings(actualRelative, declaredRelative)) {
    failures.push('Avatar manifest file records must exactly match files/ custody.');
  }
  for (const required of manifest.required_files) {
    if (!isSafeAvatarFilePath(required) || !seen.has(required)) {
      failures.push(`Avatar required file is not admitted or declared: ${required}`);
    }
  }
  if (!manifest.required_files.includes(manifest.entry_file)) {
    failures.push('Avatar required_files must include entry_file.');
  }
  const contentDigest = avatarContentDigest(records);
  if (manifest.content_digest !== `sha256:${contentDigest}`) {
    failures.push('Avatar content_digest does not match exact file records.');
  }
  if (manifest.import.source_fingerprint !== `sha256:${contentDigest}`) {
    failures.push('Avatar import.source_fingerprint does not match content_digest.');
  }

  if (records.some((file) => file.path === manifest.entry_file)) {
    if (kind === 'live2d') {
      await validateLive2d(dataRoot, assetRoot, manifest, seen, command, failures);
    } else {
      const entry = await resolveManagedFile(dataRoot, assetRoot, manifest.entry_file, command);
      const vrmFailure = validateVrmGlb(await readFile(entry));
      if (vrmFailure) failures.push(vrmFailure);
    }
  }
  return failures.length === 0 ? { validationStatus: 'valid' } : invalid(failures);
}

async function readAvatarManifest(
  dataRoot: string,
  assetRoot: string,
  command: string,
  failures: string[],
): Promise<AvatarManifest | undefined> {
  let raw: Buffer;
  try {
    const manifestPath = await assertManagedPath(dataRoot, path.join(assetRoot, 'manifest.json'), command);
    raw = await readFile(manifestPath);
  } catch (error) {
    if (isInvalidPathError(error)) throw error;
    failures.push('Avatar manifest is missing.');
    return undefined;
  }
  if (raw.byteLength === 0 || raw.byteLength > MAX_AVATAR_ASSET_MANIFEST_BYTES) {
    failures.push('Avatar manifest is outside the fixed byte cap.');
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    failures.push('Avatar manifest is malformed JSON.');
    return undefined;
  }
  if (!isObject(value) || !hasExactKeys(value, [
    'manifest_version', 'asset_version', 'local_asset_id', 'kind', 'loader_min_version',
    'display_name', 'display_name_i18n', 'entry_file', 'required_files', 'content_digest',
    'files', 'limits', 'capabilities', 'import',
  ]) || !hasAvatarManifestStructure(value)) {
    failures.push('Avatar manifest shape is not admitted.');
    return undefined;
  }
  return value as unknown as AvatarManifest;
}

function validateManifestShape(
  manifest: AvatarManifest,
  scope: AgentCenterScope,
  avatarAssetRef: string,
  kind: AvatarBackendKind,
  failures: string[],
): void {
  if (manifest.manifest_version !== 1 || manifest.asset_version !== '1.0.0' || manifest.loader_min_version !== '1.0.0') {
    failures.push('Avatar manifest versions are not admitted.');
  }
  if (manifest.local_asset_id !== avatarAssetRef || manifest.kind !== kind || !avatarAssetRef.startsWith(`${kind}_`)) {
    failures.push('Avatar manifest identity does not match the requested asset.');
  }
  if (!isDisplayText(manifest.display_name, 80) || !isObject(manifest.display_name_i18n)) {
    failures.push('Avatar display metadata is invalid.');
  }
  if (!isSafeAvatarFilePath(manifest.entry_file)) failures.push('Avatar entry_file is not admitted.');
  if (kind === 'live2d' && !manifest.entry_file.endsWith('.model3.json')) failures.push('Live2D entry_file must end in .model3.json.');
  if (kind === 'vrm' && !manifest.entry_file.endsWith('.vrm')) failures.push('VRM entry_file must end in .vrm.');
  if (!Array.isArray(manifest.required_files) || manifest.required_files.some((entry) => typeof entry !== 'string')) {
    failures.push('Avatar required_files must be a string array.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > MAX_AVATAR_ASSET_FILE_COUNT) {
    failures.push('Avatar files must be non-empty and within the fixed file-count cap.');
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(manifest.content_digest)) failures.push('Avatar content_digest is invalid.');
  if (!isObject(manifest.limits) || !hasExactKeys(manifest.limits, [
    'max_manifest_bytes', 'max_asset_bytes', 'max_file_bytes', 'max_file_count',
  ]) || manifest.limits.max_manifest_bytes !== MAX_AVATAR_ASSET_MANIFEST_BYTES
    || manifest.limits.max_asset_bytes !== MAX_AVATAR_ASSET_BYTES
    || manifest.limits.max_file_bytes !== MAX_AVATAR_ASSET_FILE_BYTES
    || manifest.limits.max_file_count !== MAX_AVATAR_ASSET_FILE_COUNT) {
    failures.push('Avatar manifest limits must match fixed custody caps.');
  }
  if (!isObject(manifest.capabilities)
    || !hasExactKeys(manifest.capabilities, ['backend_kind', 'profile_ref', 'materialization_ref'])
    || manifest.capabilities.backend_kind !== kind
    || manifest.capabilities.profile_ref !== backendCapabilityProfileRefFor(kind, avatarAssetRef)
    || manifest.capabilities.materialization_ref !== avatarMaterializationRef(scope, kind, avatarAssetRef)) {
    failures.push('Avatar capabilities must match the exact backend and scoped materialization authority.');
  }
  if (!isObject(manifest.import) || !hasExactKeys(manifest.import, ['imported_at', 'source_label', 'source_fingerprint'])
    || !isUtcTimestamp(manifest.import.imported_at)
    || !isDisplayText(manifest.import.source_label, 120)
    || path.isAbsolute(manifest.import.source_label)
    || path.win32.isAbsolute(manifest.import.source_label)
    || !/^sha256:[a-f0-9]{64}$/u.test(manifest.import.source_fingerprint)) {
    failures.push('Avatar import metadata is invalid.');
  }
}

function validateFileRecord(file: unknown, kind: AvatarBackendKind, failures: string[]): file is ManifestFile {
  if (!isObject(file) || !hasExactKeys(file, ['path', 'sha256', 'bytes', 'mime'])) {
    failures.push('Avatar manifest file record shape is invalid.');
    return false;
  }
  const filePath = file.path;
  const digest = file.sha256;
  const bytes = file.bytes;
  const mime = file.mime;
  if (!isSafeAvatarFilePath(filePath) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)
    || typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_AVATAR_ASSET_FILE_BYTES
    || typeof mime !== 'string' || mime !== avatarMimeForPath(filePath, kind)) {
    failures.push(`Avatar manifest file record is invalid: ${String(filePath)}`);
    return false;
  }
  return true;
}

async function validateLive2d(
  dataRoot: string,
  assetRoot: string,
  manifest: AvatarManifest,
  declaredFiles: ReadonlySet<string>,
  command: string,
  failures: string[],
): Promise<void> {
  const entry = await resolveManagedFile(dataRoot, assetRoot, manifest.entry_file, command);
  let root: unknown;
  try {
    root = JSON.parse(await readFile(entry, 'utf8'));
  } catch {
    failures.push('Live2D model3 JSON is malformed.');
    return;
  }
  if (!isObject(root) || root.Version !== 3 || !isObject(root.FileReferences)) {
    failures.push('Live2D model3 must have Version=3 and FileReferences.');
    return;
  }
  const references = root.FileReferences;
  const moc = typeof references.Moc === 'string' ? references.Moc : '';
  if (!moc) failures.push('Live2D FileReferences.Moc is required.');
  const textures = Array.isArray(references.Textures) ? references.Textures : [];
  if (textures.length === 0 || textures.some((entry) => typeof entry !== 'string')) {
    failures.push('Live2D FileReferences.Textures must contain strings.');
  }
  const refs: Array<{ readonly label: string; readonly value: string; readonly moc?: boolean }> = [];
  if (moc) refs.push({ label: 'Moc', value: moc, moc: true });
  for (const [index, value] of textures.entries()) {
    if (typeof value === 'string') refs.push({ label: `Textures.${index}`, value });
  }
  for (const key of ['Physics', 'Pose', 'UserData', 'DisplayInfo'] as const) {
    const value = references[key];
    if (value !== undefined) {
      if (typeof value !== 'string') failures.push(`Live2D FileReferences.${key} must be a string.`);
      else refs.push({ label: key, value });
    }
  }
  if (references.Expressions !== undefined) {
    if (!Array.isArray(references.Expressions)) failures.push('Live2D Expressions must be an array.');
    else references.Expressions.forEach((entry, index) => {
      const value = typeof entry === 'string' ? entry : isObject(entry) && typeof entry.File === 'string' ? entry.File : '';
      if (!value) failures.push(`Live2D Expressions.${index} must reference File.`);
      else refs.push({ label: `Expressions.${index}`, value });
    });
  }
  if (references.Motions !== undefined) {
    if (!isObject(references.Motions)) failures.push('Live2D Motions must be an object.');
    else for (const [group, entries] of Object.entries(references.Motions)) {
      if (!Array.isArray(entries)) {
        failures.push(`Live2D Motions.${group} must be an array.`);
        continue;
      }
      entries.forEach((entry, index) => {
        const value = isObject(entry) && typeof entry.File === 'string' ? entry.File : '';
        if (!value) failures.push(`Live2D Motions.${group}.${index} must reference File.`);
        else refs.push({ label: `Motions.${group}.${index}`, value });
      });
    }
  }
  for (const reference of refs) {
    const resolved = resolveLive2dReference(manifest.entry_file, reference.value);
    if (!resolved) {
      failures.push(`Live2D ${reference.label} path is not admitted.`);
      continue;
    }
    if (!declaredFiles.has(resolved)) {
      const caseMatch = [...declaredFiles].find((candidate) => candidate.toLowerCase() === resolved.toLowerCase());
      failures.push(caseMatch
        ? `Live2D ${reference.label} differs by case: ${resolved} / ${caseMatch}.`
        : `Live2D ${reference.label} is missing: ${resolved}.`);
      continue;
    }
    if (reference.moc) {
      const mocPath = await resolveManagedFile(dataRoot, assetRoot, resolved, command);
      const header = (await readFile(mocPath)).subarray(0, 4).toString('ascii');
      if (header !== 'MOC3') failures.push('Live2D MOC file must start with MOC3.');
    }
  }
}

async function collectManagedFiles(dataRoot: string, root: string, command: string): Promise<string[]> {
  await assertManagedPath(dataRoot, root, command);
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) {
      await assertManagedPath(dataRoot, target, command);
    } else if (metadata.isDirectory()) {
      output.push(...await collectManagedFiles(dataRoot, target, command));
    } else if (metadata.isFile()) {
      output.push(await assertManagedPath(dataRoot, target, command));
    } else {
      failuresNever(`Avatar package contains unsupported entry: ${target}`);
    }
  }
  return output.sort();
}

function resolveLive2dReference(entryFile: string, reference: string): string | undefined {
  const trimmed = reference.trim().replaceAll('\\', '/');
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('://')) return undefined;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entryFile), trimmed));
  return isSafeAvatarFilePath(resolved) ? resolved : undefined;
}

function isSafeAvatarFilePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('files/') && isSafePackageRelativePath(value);
}

function avatarMimeForPath(filePath: string, kind: AvatarBackendKind): string {
  const extension = path.posix.extname(filePath).toLowerCase();
  if (kind === 'vrm' && extension === '.vrm') return 'model/vrm';
  if (extension === '.json') return 'application/json';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function avatarContentDigest(files: readonly ManifestFile[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(String(file.bytes));
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function invalid(failures: readonly string[]): AvatarValidation {
  return { validationStatus: 'invalid', validationMessage: failures.join(' ') || 'Avatar validation failed.' };
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return sameStrings(Object.keys(value).sort(), [...keys].sort());
}

function hasAvatarManifestStructure(value: Readonly<Record<string, unknown>>): boolean {
  return typeof value.manifest_version === 'number'
    && typeof value.asset_version === 'string'
    && typeof value.local_asset_id === 'string'
    && typeof value.kind === 'string'
    && typeof value.loader_min_version === 'string'
    && typeof value.display_name === 'string'
    && isObject(value.display_name_i18n)
    && typeof value.entry_file === 'string'
    && Array.isArray(value.required_files)
    && value.required_files.every((entry) => typeof entry === 'string')
    && typeof value.content_digest === 'string'
    && Array.isArray(value.files)
    && isObject(value.limits)
    && isObject(value.capabilities)
    && isObject(value.import)
    && typeof value.import.imported_at === 'string'
    && typeof value.import.source_label === 'string'
    && typeof value.import.source_fingerprint === 'string';
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isDisplayText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));
}

function isInvalidPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'invalid-path');
}

function failuresNever(message: string): never {
  throw new Error(message);
}
