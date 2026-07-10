import crypto from 'node:crypto';
import path from 'node:path';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { asRecord, canonicalElectronPathCandidate, isSameOrChildPath, normalizeRequiredToken } from './paths.js';
import { invalidPath, type AgentCenterScope } from './agent-center-contract.js';
import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';

export function agentCenterDir(dataRoot: string, scope: AgentCenterScope): string {
  return path.join(accountDir(dataRoot, scope.accountId), 'agents', custodySegment(scope.localAgentRef), 'agent-center');
}

export function accountDir(dataRoot: string, accountId: string): string {
  return path.join(dataRoot, 'agent-center', 'accounts', custodySegment(accountId));
}

export function avatarAssetDir(
  dataRoot: string,
  scope: AgentCenterScope,
  kind: 'live2d' | 'vrm',
  avatarAssetRef: string,
): string {
  return path.join(agentCenterDir(dataRoot, scope), 'modules', 'avatar_asset', 'packages', kind, avatarAssetRef);
}

export function backgroundDir(dataRoot: string, scope: AgentCenterScope, backgroundAssetRef: string): string {
  return path.join(agentCenterDir(dataRoot, scope), 'modules', 'appearance', 'backgrounds', backgroundAssetRef);
}

export function avatarMaterializationRef(
  scope: AgentCenterScope,
  kind: 'live2d' | 'vrm',
  avatarAssetRef: string,
): string {
  return `agent-center-avatar-asset:${custodySegment(scope.accountId)}:${custodySegment(scope.localAgentRef)}:${kind}:${avatarAssetRef}`;
}

export async function quarantine(
  dataRoot: string,
  scopeRoot: string,
  source: string,
  kind: string,
  resourceId: string,
  command: string,
): Promise<void> {
  const destination = path.join(scopeRoot, 'quarantine', kind, `${custodySegment(resourceId)}_${Date.now()}`);
  await assertManagedPath(dataRoot, source, command);
  await ensureManagedDirectory(dataRoot, path.dirname(destination), command);
  await assertManagedPath(dataRoot, destination, command, true);
  await rename(source, destination);
}

export async function readManifest(
  dataRoot: string,
  dir: string,
  command: string,
): Promise<Readonly<Record<string, unknown>>> {
  const manifestPath = await assertManagedPath(dataRoot, path.join(dir, 'manifest.json'), command);
  return asRecord(JSON.parse(await readFile(manifestPath, 'utf8')), 'Agent Center manifest must be an object');
}

export async function writeManagedJson(
  dataRoot: string,
  filePath: string,
  value: unknown,
  command: string,
): Promise<void> {
  await ensureManagedDirectory(dataRoot, path.dirname(filePath), command);
  await assertManagedPath(dataRoot, filePath, command, true);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function managedPathExists(dataRoot: string, filePath: string, command: string): Promise<boolean> {
  return assertManagedPath(dataRoot, filePath, command).then(() => true, (error: unknown) => {
    if (isMissingManagedPathError(error)) return false;
    throw error;
  });
}

export function sha256(bytes: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function custodySegment(value: string): string {
  const body = value.startsWith('~') ? value.slice(1) : value;
  if (value.length <= 128 && /^[a-z0-9][a-z0-9_-]*$/u.test(body)) {
    return value;
  }
  return `id_${sha256(value).slice(0, 24)}`;
}

export function isSafePackageRelativePath(value: string): boolean {
  if (!value || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\')) {
    return false;
  }
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export async function resolveBoundDataRoot(dataRoot: string, command: string): Promise<string> {
  await mkdir(dataRoot, { recursive: true });
  const canonicalRoot = await realpath(dataRoot).catch((error) => {
    throw invalidPath(command, `Managed data root cannot be resolved: ${String(error)}`);
  });
  const metadata = await lstat(canonicalRoot).catch(() => undefined);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw invalidPath(command, 'Managed data root must resolve to a real directory');
  }
  return canonicalRoot;
}

export async function resolveManagedFile(
  dataRoot: string,
  root: string,
  relativePath: string,
  command: string,
): Promise<string> {
  if (!isSafePackageRelativePath(relativePath)) {
    throw invalidPath(command, 'Managed resource path must be a safe relative path');
  }
  await assertManagedPath(dataRoot, root, command);
  return assertManagedPath(dataRoot, path.join(root, ...relativePath.split('/')), command);
}

export async function ensureManagedDirectory(dataRoot: string, target: string, command: string): Promise<string> {
  const { anchor, segments } = managedSegments(dataRoot, target, command);
  let current = anchor;
  for (const segment of segments) {
    current = path.join(current, segment);
    const metadata = await lstat(current).catch(() => undefined);
    if (!metadata) {
      await mkdir(current);
      continue;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw invalidPath(command, `Managed directory path contains a symlink or non-directory: ${target}`);
    }
  }
  return assertManagedPath(dataRoot, target, command);
}

export async function removeManagedPath(dataRoot: string, target: string, command: string): Promise<void> {
  try {
    await assertManagedPath(dataRoot, target, command);
  } catch (error) {
    if (isMissingManagedPathError(error)) return;
    throw error;
  }
  await rm(target, { recursive: true, force: true });
}

export async function renameManagedPath(dataRoot: string, source: string, destination: string, command: string): Promise<void> {
  await assertManagedPath(dataRoot, source, command);
  await ensureManagedDirectory(dataRoot, path.dirname(destination), command);
  await assertManagedPath(dataRoot, destination, command, true);
  await rename(source, destination);
}

export async function assertManagedPath(
  dataRoot: string,
  target: string,
  command: string,
  allowMissingLeaf = false,
): Promise<string> {
  const { anchor, segments } = managedSegments(dataRoot, target, command);
  let current = anchor;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index] ?? '');
    const metadata = await lstat(current).catch(() => undefined);
    if (!metadata) {
      if (allowMissingLeaf && index === segments.length - 1) return current;
      throw missingManagedPath(target);
    }
    if (metadata.isSymbolicLink()) {
      throw invalidPath(command, `Managed path contains a symlink: ${target}`);
    }
  }
  const canonical = await realpath(current).catch((error) => {
    throw invalidPath(command, `Managed path cannot be resolved: ${String(error)}`);
  });
  if (!isSameOrChildPath(anchor, canonical)) {
    throw invalidPath(command, `Managed path escaped its custody root: ${target}`);
  }
  return canonical;
}

export async function userSelectedSource(
  host: NimiElectronStandardShellHost | undefined,
  value: unknown,
  command: string,
): Promise<string> {
  const raw = path.resolve(normalizeRequiredToken(value, 'sourcePath'));
  const metadata = await lstat(raw).catch(() => undefined);
  if (!metadata || metadata.isSymbolicLink()) {
    throw invalidPath(command, 'Agent Center source path is missing or is a symlink');
  }
  const source = await canonicalElectronPathCandidate(raw);
  const protocolHost = host?.localAssetProtocolHost;
  if (!protocolHost) {
    throw createElectronCapabilityUnavailableError(command);
  }
  if (!await protocolHost.hasReadableFile(source)) {
    throw new NimiElectronShellHostError({
      code: 'forbidden-renderer-access',
      message: `Agent Center source path was not selected through the standard file dialog: ${source}`,
      reasonCode: 'electron-agent-center-source-not-from-file-dialog',
      actionHint: 'select_agent_center_import_source_with_standard_file_dialog',
      details: { command, source },
    });
  }
  return source;
}

function managedSegments(dataRoot: string, target: string, command: string): {
  readonly anchor: string;
  readonly segments: readonly string[];
} {
  const anchor = path.resolve(dataRoot);
  const relative = path.relative(anchor, path.resolve(target));
  if (!relative || relative === '.') return { anchor, segments: [] };
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw invalidPath(command, `Managed path escaped its data root: ${target}`);
  }
  return { anchor, segments: relative.split(path.sep).filter(Boolean) };
}

function missingManagedPath(target: string): Error {
  const error = new Error(`Managed path is missing: ${target}`);
  Object.defineProperty(error, 'code', { value: 'ENOENT' });
  return error;
}

function isMissingManagedPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
