import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { resolveElectronStandardDataRoot } from './data-root-binding.js';
import {
  MAX_BACKGROUND_BYTES,
  MAX_BACKGROUND_PIXELS,
  invalidPath,
  invalidPayload,
  notFound,
  parseBackgroundAssetRef,
  parseLocalAgentScope,
} from './agent-center-contract.js';
import {
  backgroundMimeForPath,
  decodeImageDimensions,
  type ImageMime,
} from './agent-center-content.js';
import {
  agentCenterDir,
  assertManagedPath,
  backgroundDir,
  ensureManagedDirectory,
  isSafePackageRelativePath,
  managedPathExists,
  quarantine,
  readManifest,
  removeManagedPath,
  renameManagedPath,
  resolveBoundDataRoot,
  resolveManagedFile,
  sha256,
  userSelectedSource,
  writeManagedJson,
} from './agent-center-paths.js';
import type { NimiElectronStandardShellHost } from './types.js';

const BACKGROUND_MANIFEST_KEYS = [
  'manifest_version',
  'background_asset_id',
  'display_name',
  'image_file',
  'mime',
  'bytes',
  'pixel_width',
  'pixel_height',
  'limits',
  'sha256',
  'imported_at',
  'source_label',
] as const;

type BackgroundManifest = {
  readonly manifest_version: number;
  readonly background_asset_id: string;
  readonly display_name: string;
  readonly image_file: string;
  readonly mime: ImageMime;
  readonly bytes: number;
  readonly pixel_width: number;
  readonly pixel_height: number;
  readonly limits: {
    readonly max_bytes: number;
    readonly max_pixel_width: number;
    readonly max_pixel_height: number;
  };
  readonly sha256: string;
  readonly imported_at: string;
  readonly source_label: string;
};

type BackgroundValidation = {
  readonly validationStatus: 'valid' | 'invalid';
  readonly validationMessage?: string;
  readonly manifest?: BackgroundManifest;
  readonly imagePath?: string;
};

export async function importBackground(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await boundDataRoot(host, command);
  const scope = parseLocalAgentScope(payload, command);
  const source = await userSelectedSource(host, payload.sourcePath, command);
  const mime = backgroundMimeForPath(source);
  if (!mime) throw invalidPayload(command, 'Background source must be png, jpeg, or webp');
  const sourceBytes = await readFile(source);
  if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > MAX_BACKGROUND_BYTES) {
    throw invalidPayload(command, 'Background image is outside the fixed byte cap');
  }
  const dimensions = await decodeImageDimensions(sourceBytes, mime, MAX_BACKGROUND_PIXELS);
  if (!dimensions) {
    throw invalidPayload(command, 'Background image signature or dimensions are invalid');
  }

  const digest = sha256(sourceBytes);
  const backgroundAssetRef = `bg_${digest.slice(0, 12)}`;
  const finalDir = backgroundDir(dataRoot, scope, backgroundAssetRef);
  if (await managedPathExists(dataRoot, finalDir, command)) {
    const validation = await validateBackgroundAt(dataRoot, finalDir, backgroundAssetRef, command);
    if (validation.validationStatus !== 'valid') {
      throw invalidPayload(command, validation.validationMessage ?? 'Background validation failed');
    }
    return { backgroundAssetRef, validationStatus: 'valid' as const };
  }

  const stagingDir = path.join(
    agentCenterDir(dataRoot, scope),
    'modules',
    'appearance',
    'staging',
    `${backgroundAssetRef}_${Date.now()}`,
  );
  await removeManagedPath(dataRoot, stagingDir, command);
  await ensureManagedDirectory(dataRoot, stagingDir, command);
  let finalized = false;
  try {
    const imageFile = `image${path.extname(source).toLowerCase()}`;
    const imagePath = path.join(stagingDir, imageFile);
    await assertManagedPath(dataRoot, imagePath, command, true);
    await writeFile(imagePath, sourceBytes);
    await writeManagedJson(dataRoot, path.join(stagingDir, 'manifest.json'), {
      manifest_version: 1,
      background_asset_id: backgroundAssetRef,
      display_name: safeDisplayName(path.basename(source)),
      image_file: imageFile,
      mime,
      bytes: sourceBytes.byteLength,
      pixel_width: dimensions.width,
      pixel_height: dimensions.height,
      limits: {
        max_bytes: MAX_BACKGROUND_BYTES,
        max_pixel_width: MAX_BACKGROUND_PIXELS,
        max_pixel_height: MAX_BACKGROUND_PIXELS,
      },
      sha256: digest,
      imported_at: new Date().toISOString(),
      source_label: path.basename(source),
    }, command);
    const staged = await validateBackgroundAt(dataRoot, stagingDir, backgroundAssetRef, command);
    if (staged.validationStatus !== 'valid') {
      throw invalidPayload(command, staged.validationMessage ?? 'Staged background validation failed');
    }
    await renameManagedPath(dataRoot, stagingDir, finalDir, command);
    finalized = true;
    const finalValidation = await validateBackgroundAt(dataRoot, finalDir, backgroundAssetRef, command);
    if (finalValidation.validationStatus !== 'valid') {
      throw invalidPayload(command, finalValidation.validationMessage ?? 'Final background validation failed');
    }
    return { backgroundAssetRef, validationStatus: 'valid' as const };
  } catch (error) {
    await removeManagedPath(dataRoot, stagingDir, command);
    if (finalized) await removeManagedPath(dataRoot, finalDir, command);
    throw error;
  }
}

export async function getBackground(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await boundDataRoot(host, command);
  const protocolHost = host?.localAssetProtocolHost;
  if (!protocolHost) throw createElectronCapabilityUnavailableError(command);
  const scope = parseLocalAgentScope(payload, command);
  const backgroundAssetRef = parseBackgroundAssetRef(payload.backgroundAssetRef, command);
  const dir = backgroundDir(dataRoot, scope, backgroundAssetRef);
  if (!await managedPathExists(dataRoot, dir, command)) {
    throw notFound(command, `Background asset was not found: ${backgroundAssetRef}`);
  }
  const validation = await validateBackgroundAt(dataRoot, dir, backgroundAssetRef, command);
  if (validation.validationStatus !== 'valid' || !validation.manifest || !validation.imagePath) {
    throw invalidPayload(command, validation.validationMessage ?? 'Background validation failed');
  }
  await protocolHost.registerReadableFile(validation.imagePath);
  const url = protocolHost.resolveLocalAssetUrl(validation.imagePath);
  if (!url.startsWith('nimi-shell-file://local/')) {
    throw createElectronCapabilityUnavailableError(command);
  }
  return {
    backgroundAssetRef,
    url,
    mimeType: validation.manifest.mime,
  };
}

export async function validateBackground(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await boundDataRoot(host, command);
  const scope = parseLocalAgentScope(payload, command);
  const backgroundAssetRef = parseBackgroundAssetRef(payload.backgroundAssetRef, command);
  const dir = backgroundDir(dataRoot, scope, backgroundAssetRef);
  if (!await managedPathExists(dataRoot, dir, command)) {
    throw notFound(command, `Background asset was not found: ${backgroundAssetRef}`);
  }
  const validation = await validateBackgroundAt(dataRoot, dir, backgroundAssetRef, command);
  return {
    backgroundAssetRef,
    validationStatus: validation.validationStatus,
    ...(validation.validationMessage ? { validationMessage: validation.validationMessage } : {}),
  };
}

export async function removeBackground(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await boundDataRoot(host, command);
  const scope = parseLocalAgentScope(payload, command);
  const backgroundAssetRef = parseBackgroundAssetRef(payload.backgroundAssetRef, command);
  const dir = backgroundDir(dataRoot, scope, backgroundAssetRef);
  if (!await managedPathExists(dataRoot, dir, command)) {
    throw notFound(command, `Background asset was not found: ${backgroundAssetRef}`);
  }
  await quarantine(dataRoot, agentCenterDir(dataRoot, scope), dir, 'background', backgroundAssetRef, command);
  return { removed: true, backgroundAssetRef };
}

async function validateBackgroundAt(
  dataRoot: string,
  dir: string,
  backgroundAssetRef: string,
  command: string,
): Promise<BackgroundValidation> {
  const failures: string[] = [];
  let raw: Readonly<Record<string, unknown>>;
  try {
    raw = await readManifest(dataRoot, dir, command);
  } catch (error) {
    if (isInvalidPathError(error)) throw error;
    return invalidBackground(`Background manifest is missing or malformed: ${errorMessage(error)}`);
  }
  const manifest = parseBackgroundManifest(raw);
  if (!manifest) return invalidBackground('Background manifest shape is not admitted.');

  if (manifest.manifest_version !== 1 || manifest.background_asset_id !== backgroundAssetRef) {
    failures.push('Background manifest identity/version does not match the requested asset.');
  }
  if (!isDisplayText(manifest.display_name, 80) || !isDisplayText(manifest.source_label, 120)
    || path.isAbsolute(manifest.source_label) || path.win32.isAbsolute(manifest.source_label)) {
    failures.push('Background display/import metadata is invalid.');
  }
  if (!isUtcTimestamp(manifest.imported_at)) failures.push('Background imported_at must be a UTC timestamp.');
  if (!isSafePackageRelativePath(manifest.image_file)) {
    throw invalidPath(command, 'Background image_file must be a safe background-relative path');
  }
  const pathMime = backgroundMimeForPath(manifest.image_file);
  if (!pathMime || pathMime !== manifest.mime) failures.push('Background MIME and extension do not match.');
  if (!Number.isInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > MAX_BACKGROUND_BYTES) {
    failures.push('Background image is outside the fixed byte cap.');
  }
  if (!Number.isInteger(manifest.pixel_width) || !Number.isInteger(manifest.pixel_height)
    || manifest.pixel_width <= 0 || manifest.pixel_height <= 0
    || manifest.pixel_width > MAX_BACKGROUND_PIXELS || manifest.pixel_height > MAX_BACKGROUND_PIXELS) {
    failures.push('Background image dimensions are outside the fixed pixel cap.');
  }
  if (!hasExactKeys(manifest.limits, ['max_bytes', 'max_pixel_width', 'max_pixel_height'])
    || manifest.limits.max_bytes !== MAX_BACKGROUND_BYTES
    || manifest.limits.max_pixel_width !== MAX_BACKGROUND_PIXELS
    || manifest.limits.max_pixel_height !== MAX_BACKGROUND_PIXELS) {
    failures.push('Background limits must match fixed custody caps.');
  }
  if (!/^[a-f0-9]{64}$/u.test(manifest.sha256)) failures.push('Background sha256 is invalid.');

  let imagePath: string | undefined;
  try {
    imagePath = await resolveManagedFile(dataRoot, dir, manifest.image_file, command);
  } catch (error) {
    if (isInvalidPathError(error)) throw error;
    failures.push('Background image is missing.');
  }
  if (imagePath) {
    const bytes = await readFile(imagePath);
    if (bytes.byteLength !== manifest.bytes) failures.push('Background image byte count differs from manifest.');
    if (sha256(bytes) !== manifest.sha256) failures.push('Background image digest differs from manifest.');
    const dimensions = pathMime ? await decodeImageDimensions(bytes, pathMime, MAX_BACKGROUND_PIXELS) : undefined;
    if (!dimensions || dimensions.width !== manifest.pixel_width || dimensions.height !== manifest.pixel_height) {
      failures.push('Background image signature or dimensions differ from manifest.');
    }
  }
  return failures.length === 0
    ? { validationStatus: 'valid', manifest, imagePath }
    : invalidBackground(failures.join(' '));
}

function parseBackgroundManifest(value: Readonly<Record<string, unknown>>): BackgroundManifest | undefined {
  if (!hasExactKeys(value, BACKGROUND_MANIFEST_KEYS)
    || typeof value.manifest_version !== 'number'
    || typeof value.background_asset_id !== 'string'
    || typeof value.display_name !== 'string'
    || typeof value.image_file !== 'string'
    || !isImageMime(value.mime)
    || typeof value.bytes !== 'number'
    || typeof value.pixel_width !== 'number'
    || typeof value.pixel_height !== 'number'
    || !isObject(value.limits)
    || typeof value.limits.max_bytes !== 'number'
    || typeof value.limits.max_pixel_width !== 'number'
    || typeof value.limits.max_pixel_height !== 'number'
    || typeof value.sha256 !== 'string'
    || typeof value.imported_at !== 'string'
    || typeof value.source_label !== 'string') {
    return undefined;
  }
  return value as unknown as BackgroundManifest;
}

async function boundDataRoot(host: NimiElectronStandardShellHost | undefined, command: string): Promise<string> {
  return resolveBoundDataRoot(await resolveElectronStandardDataRoot(host, command), command);
}

function safeDisplayName(sourceLabel: string): string {
  const extension = path.extname(sourceLabel);
  const withoutExtension = extension ? sourceLabel.slice(0, -extension.length) : sourceLabel;
  const normalized = withoutExtension.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return (normalized || 'Imported background').slice(0, 80);
}

function invalidBackground(message: string): BackgroundValidation {
  return { validationStatus: 'invalid', validationMessage: message };
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isImageMime(value: unknown): value is ImageMime {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp';
}

function isDisplayText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.trim().length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isUtcTimestamp(value: string): boolean {
  return value.endsWith('Z') && Number.isFinite(Date.parse(value));
}

function isInvalidPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'invalid-path');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
