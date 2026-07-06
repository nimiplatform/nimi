import path from 'node:path';
import { access, mkdir, realpath } from 'node:fs/promises';
import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError, errorMessage } from './errors.js';

export function normalizeRequiredToken(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `${field} is required`,
      reasonCode: 'electron-shell-required-field-missing',
      actionHint: 'provide_required_electron_shell_host_option',
      details: { field },
    });
  }
  return normalized;
}
export function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
export function asRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message,
      reasonCode: 'electron-runtime-payload-not-object',
      actionHint: 'send_structured_runtime_bridge_payload',
      details: { valueType: typeof value },
    });
  }
  return value as Readonly<Record<string, unknown>>;
}
export function addOptionalField(target: Record<string, unknown>, key: string, value: unknown): void {
  const normalized = normalizeText(value);
  if (normalized) {
    target[key] = normalized;
  }
}
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
export function normalizeStringArray(value: readonly string[], field: string, command: string): string[] {
  if (!Array.isArray(value)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: `${field} must be an array`,
      reasonCode: 'electron-shell-string-array-invalid',
      actionHint: 'provide_string_array',
      details: { command, field },
    });
  }
  return value.map((entry, index) => {
    const normalized = normalizeText(entry);
    if (!normalized) {
      throw new NimiElectronShellHostError({
        code: 'invalid-payload',
        message: `${field}[${index}] must be a non-empty string`,
        reasonCode: 'electron-shell-string-array-entry-invalid',
        actionHint: 'provide_non_empty_string_array_entries',
        details: { command, field, index },
      });
    }
    return normalized;
  });
}
export async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}
export function isSameOrChildPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
async function canonicalElectronPathCandidate(candidate: string): Promise<string> {
  const resolved = path.resolve(candidate);
  const missingSegments: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      const canonical = await realpath(current);
      return missingSegments.length === 0
        ? canonical
        : path.join(canonical, ...missingSegments.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return resolved;
      }
      missingSegments.push(path.basename(current));
      current = parent;
    }
  }
}
export async function resolveElectronStandardDataRootPath(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<string> {
  if (!host?.dataRoot) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const root = await canonicalElectronStandardRoot(host.dataRoot, command, 'dataRoot');
  assertNoRendererStorageRootFields(payload, command);
  const relativePath = normalizeStandardRelativePath(payload.relativePath, command);
  const target = path.resolve(root, relativePath);
  if (!isSameOrChildPath(root, target)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-path',
      message: `Electron standard path escapes data root: ${target}`,
      reasonCode: 'electron-standard-path-escapes-root',
      actionHint: 'use_relative_path_inside_standard_data_root',
      details: { command, root, path: target },
    });
  }
  return target;
}
export async function resolveElectronStandardLocalAssetPath(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<string> {
  const roots = host?.localAssetRoots ?? [];
  if (roots.length === 0) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const rawPath = normalizeRequiredToken(payload.path ?? payload.relativePath, 'path');
  const canonicalRoots = await Promise.all(roots.map((root) => canonicalElectronStandardRoot(root, command, 'localAssetRoots')));
  const candidates = path.isAbsolute(rawPath)
    ? [path.resolve(rawPath)]
    : canonicalRoots.map((root) => path.resolve(root, rawPath));
  for (const rawCandidate of candidates) {
    const candidate = await canonicalElectronPathCandidate(rawCandidate);
    const owningRoot = canonicalRoots.find((root) => isSameOrChildPath(root, candidate));
    if (!owningRoot) {
      continue;
    }
    if (!await fileExists(candidate)) {
      throw new NimiElectronShellHostError({
        code: 'not-found',
        message: `Electron standard local asset was not found: ${candidate}`,
        reasonCode: 'electron-standard-local-asset-not-found',
        actionHint: 'materialize_local_asset_before_resolving_url',
        details: { command, path: candidate, root: owningRoot },
      });
    }
    const canonical = await realpath(candidate);
    if (!isSameOrChildPath(owningRoot, canonical)) {
      throw new NimiElectronShellHostError({
        code: 'invalid-path',
        message: `Electron standard local asset escapes admitted root: ${canonical}`,
        reasonCode: 'electron-standard-local-asset-escapes-root',
        actionHint: 'use_asset_path_inside_admitted_local_asset_root',
        details: { command, path: canonical, root: owningRoot },
      });
    }
    return canonical;
  }
  throw new NimiElectronShellHostError({
    code: 'invalid-path',
    message: `Electron standard local asset path is outside admitted roots: ${rawPath}`,
    reasonCode: 'electron-standard-local-asset-outside-root',
    actionHint: 'provide_local_asset_path_inside_admitted_root',
    details: { command, path: rawPath, roots: canonicalRoots },
  });
}
export async function canonicalElectronStandardRoot(root: string, command: string, field: string): Promise<string> {
  const resolved = path.resolve(normalizeRequiredToken(root, field));
  await mkdir(resolved, { recursive: true });
  return realpath(resolved)
    .catch((error: unknown) => {
      throw new NimiElectronShellHostError({
        code: 'invalid-path',
        message: `Electron standard root is unavailable: ${errorMessage(error)}`,
        reasonCode: 'electron-standard-root-unavailable',
        actionHint: 'provide_existing_or_creatable_standard_shell_root',
        details: { command, field, root: resolved, cause: errorMessage(error) },
      });
    });
}
export function normalizeStandardRelativePath(value: unknown, command: string): string {
  const relativePath = normalizeRequiredToken(value, 'relativePath');
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/u).includes('..')) {
    throw new NimiElectronShellHostError({
      code: 'invalid-path',
      message: `Electron standard relative path is invalid: ${relativePath}`,
      reasonCode: 'electron-standard-path-escapes-root',
      actionHint: 'use_relative_path_inside_standard_data_root',
      details: { command, relativePath },
    });
  }
  return relativePath;
}
function assertNoRendererStorageRootFields(payload: Readonly<Record<string, unknown>>, command: string): void {
  for (const field of ['path', 'root', 'storageRoot', 'absolutePath']) {
    if (field in payload) {
      throw new NimiElectronShellHostError({
        code: 'invalid-payload',
        message: `Electron standard storage renderer field is forbidden: ${field}`,
        reasonCode: 'electron-standard-storage-renderer-field-forbidden',
        actionHint: 'send_relative_path_only_for_standard_storage',
        details: { command, field },
      });
    }
  }
}
export function serializeElectronStandardJsonValue(value: unknown, command: string): string {
  if (value === undefined) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron standard JSON value is required',
      reasonCode: 'electron-standard-json-value-required',
      actionHint: 'provide_json_serializable_value',
      details: { command },
    });
  }
  const body = JSON.stringify(value, null, 2);
  if (body === undefined) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron standard JSON value is not serializable',
      reasonCode: 'electron-standard-json-value-not-serializable',
      actionHint: 'provide_json_serializable_value',
      details: { command, valueType: typeof value },
    });
  }
  return `${body}\n`;
}
export function standardNestedPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Readonly<Record<string, unknown>> {
  if ('payload' in payload && Object.keys(payload).length === 1) {
    return asRecord(payload.payload ?? {}, `Electron standard shell command ${command} nested payload must be an object`);
  }
  return payload;
}
export function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : undefined;
}
