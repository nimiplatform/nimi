import { lstatSync, type BigIntStats, type Dirent } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import {
  createDesktopDataRootOperationGate,
  type DesktopDataRootOperationGate,
} from './data-root-operation-gate.js';

const PLAN_COMMAND = 'nimi_data_cleanup_plan' as const;
const EXECUTE_COMMAND = 'nimi_data_cleanup_execute' as const;
const APP_HOST_CACHE_PLAN_COMMAND = 'nimi_app_host_cache_plan' as const;
const APP_HOST_CACHE_EXECUTE_COMMAND = 'nimi_app_host_cache_execute' as const;
const DESTRUCTIVE_CLEANUP_CONFIRMATION = 'CLEAN';
// Regenerable Chromium caches inside a standard App Host's session data. Site
// storage (cookies, Local Storage, IndexedDB, service workers) is never listed.
const APP_HOST_CACHE_DIRECTORIES = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache'] as const;
const APP_HOST_PROFILE_NAME = /^[0-9a-f]{32}$/u;

type CleanupDirectory = {
  readonly directory: string;
  readonly owner: string;
  readonly cleanupClass: 'runtime_managed' | 'owner_managed' | 'confirm_required';
  readonly runtimeOwnerBlocked: boolean;
};

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-006a
// apps and accounts hold Runtime owner stores (registration kernel, installed
// releases, account state). Only their owners may remove content, so Support
// previews them but never deletes them, even with the confirmation token.
const CLEANUP_DIRECTORIES = new Map<string, CleanupDirectory>([
  ['models', {
    directory: 'models',
    owner: 'runtime_model_materializer',
    cleanupClass: 'runtime_managed',
    runtimeOwnerBlocked: true,
  }],
  ['dependencies', {
    directory: 'dependencies',
    owner: 'runtime_dependency_materializer',
    cleanupClass: 'runtime_managed',
    runtimeOwnerBlocked: true,
  }],
  ['environments', {
    directory: 'environments',
    owner: 'runtime_environment_materializer',
    cleanupClass: 'runtime_managed',
    runtimeOwnerBlocked: true,
  }],
  ['apps', {
    directory: 'apps',
    owner: 'app_package_installer',
    cleanupClass: 'owner_managed',
    runtimeOwnerBlocked: true,
  }],
  ['accounts', {
    directory: 'accounts',
    owner: 'account_data_plane_consumers',
    cleanupClass: 'owner_managed',
    runtimeOwnerBlocked: true,
  }],
  ['logs', {
    directory: 'logs',
    owner: 'runtime_product_support',
    cleanupClass: 'confirm_required',
    runtimeOwnerBlocked: false,
  }],
  ['audit', {
    directory: 'audit',
    owner: 'runtime_realm_product_audit',
    cleanupClass: 'confirm_required',
    runtimeOwnerBlocked: false,
  }],
]);

export type DesktopElectronDataCleanupPlan = {
  readonly directory: string;
  readonly owner: string;
  readonly cleanupClass: string;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly requiresConfirmation: true;
  readonly runtimeOwnerBlocked: boolean;
};

export type DesktopElectronDataCleanupOutcome = {
  readonly directory: string;
  readonly removedBytes: number;
  readonly removedFiles: number;
};

export type DesktopElectronAppHostCachePlan = {
  readonly profileCount: number;
  readonly totalBytes: number;
  readonly fileCount: number;
  readonly hostsRunning: boolean;
};

export type DesktopElectronAppHostCacheOutcome = {
  readonly removedBytes: number;
  readonly removedFiles: number;
  readonly failedEntries: number;
  readonly complete: boolean;
};

type CommandContext = {
  readonly payload: Readonly<Record<string, unknown>>;
};

export type DesktopElectronDataCleanupHost = {
  readonly commandHandlers: Readonly<{
    [PLAN_COMMAND]: (context: CommandContext) => Promise<DesktopElectronDataCleanupPlan>;
    [EXECUTE_COMMAND]: (context: CommandContext) => Promise<DesktopElectronDataCleanupOutcome>;
    [APP_HOST_CACHE_PLAN_COMMAND]: (context: CommandContext) => Promise<DesktopElectronAppHostCachePlan>;
    [APP_HOST_CACHE_EXECUTE_COMMAND]: (context: CommandContext) => Promise<DesktopElectronAppHostCacheOutcome>;
  }>;
};

export function createDesktopElectronDataCleanupHost(input: {
  readonly resolveReadyDataRoot: () => Promise<string>;
  /** Current host-user scope of Host technical profiles (Runtime projection). */
  readonly resolveHostProfileScope?: () => Promise<string>;
  /** Whether any Desktop-managed development or installed App is starting or running. */
  readonly hasActiveManagedApps?: () => Promise<boolean>;
  readonly operationGate?: DesktopDataRootOperationGate;
}): DesktopElectronDataCleanupHost {
  const operationGate = input.operationGate ?? createDesktopDataRootOperationGate();
  const resolveHostProfileScope = input.resolveHostProfileScope
    ?? (async () => { throw new Error('desktop-app-host-cache-scope-unavailable'); });
  const hasActiveManagedApps = input.hasActiveManagedApps ?? (async () => true);

  return {
    commandHandlers: {
      [PLAN_COMMAND]: ({ payload }) => operationGate.runExclusive(async () => {
        const request = exactRecord(payload, ['directory'], 'desktop-data-cleanup-plan-payload-invalid');
        const directory = cleanupDirectory(request.directory);
        const dataRoot = await resolveCanonicalDataRoot(input.resolveReadyDataRoot);
        const usage = await measureCleanupDirectory(cleanupTarget(dataRoot, directory.directory));
        return Object.freeze({
          directory: directory.directory,
          owner: directory.owner,
          cleanupClass: directory.cleanupClass,
          totalBytes: checkedNumber(usage.totalBytes),
          fileCount: checkedNumber(usage.fileCount),
          requiresConfirmation: true,
          runtimeOwnerBlocked: directory.runtimeOwnerBlocked,
        });
      }),
      [EXECUTE_COMMAND]: ({ payload }) => operationGate.runExclusive(async () => {
        const envelope = exactRecord(payload, ['payload'], 'desktop-data-cleanup-execute-payload-invalid');
        const request = exactRecord(
          envelope.payload,
          ['confirmation', 'directory'],
          'desktop-data-cleanup-execute-payload-invalid',
        );
        const directory = cleanupDirectory(request.directory);
        if (directory.runtimeOwnerBlocked) {
          throw new Error('desktop-data-cleanup-runtime-owner-blocked');
        }
        if (request.confirmation !== DESTRUCTIVE_CLEANUP_CONFIRMATION) {
          throw new Error('desktop-data-cleanup-confirmation-required');
        }

        const dataRoot = await resolveCanonicalDataRoot(input.resolveReadyDataRoot);
        const target = cleanupTarget(dataRoot, directory.directory);
        const usage = await measureCleanupDirectory(target);
        const targetStat = await lstat(target).catch((error: unknown) => {
          if (isNotFound(error)) return null;
          throw error;
        });
        if (targetStat) {
          if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
            throw new Error('desktop-data-cleanup-target-invalid');
          }
          await rm(target, { recursive: true, force: false });
        }
        await mkdir(target);
        return Object.freeze({
          directory: directory.directory,
          removedBytes: checkedNumber(usage.totalBytes),
          removedFiles: checkedNumber(usage.fileCount),
        });
      }),
      // @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-006e
      // The stopped-Host check and the deletion share one gate critical section,
      // so no managed launch or root switch can interleave between them.
      [APP_HOST_CACHE_PLAN_COMMAND]: ({ payload }) => operationGate.runExclusive(async () => {
        exactRecord(payload, [], 'desktop-app-host-cache-payload-invalid');
        const hostsRunning = await hasActiveManagedApps();
        const inventory = await appHostCacheInventory(await resolveCacheScope(resolveHostProfileScope));
        let totalBytes = 0n;
        let fileCount = 0n;
        for (const target of inventory.targets) {
          const usage = await measureCacheDirectory(target);
          totalBytes += usage.totalBytes;
          fileCount += usage.fileCount;
        }
        return Object.freeze({
          profileCount: inventory.profileCount,
          totalBytes: checkedNumber(totalBytes),
          fileCount: checkedNumber(fileCount),
          hostsRunning,
        });
      }),
      [APP_HOST_CACHE_EXECUTE_COMMAND]: ({ payload }) => operationGate.runExclusive(async () => {
        exactRecord(payload, [], 'desktop-app-host-cache-payload-invalid');
        if (await hasActiveManagedApps()) {
          throw new Error('desktop-app-host-cache-hosts-running');
        }
        const inventory = await appHostCacheInventory(await resolveCacheScope(resolveHostProfileScope));
        let removedBytes = 0n;
        let removedFiles = 0n;
        let failedEntries = 0;
        for (const target of inventory.targets) {
          const usage = await measureCacheDirectory(target);
          try {
            // Removes link entries themselves and never follows them.
            await rm(target, { recursive: true, force: false });
            removedBytes += usage.totalBytes;
            removedFiles += usage.fileCount;
          } catch {
            failedEntries += 1;
          }
        }
        return Object.freeze({
          removedBytes: checkedNumber(removedBytes),
          removedFiles: checkedNumber(removedFiles),
          failedEntries,
          complete: failedEntries === 0,
        });
      }),
    },
  };
}

async function resolveCacheScope(resolver: () => Promise<string>): Promise<string> {
  let scope: unknown;
  try {
    scope = await resolver();
  } catch {
    throw new Error('desktop-app-host-cache-scope-unavailable');
  }
  if (typeof scope !== 'string' || scope.trim() !== scope || !path.isAbsolute(scope)
    || path.normalize(scope) !== scope || !APP_HOST_PROFILE_NAME.test(path.basename(scope))) {
    throw new Error('desktop-app-host-cache-scope-unavailable');
  }
  return scope;
}

// Only `<scope>/apps/<32-hex>/session-data/<fixed cache>` directories qualify:
// unknown siblings, the Home `desktop` profile and linked entries are skipped.
async function appHostCacheInventory(scope: string): Promise<{
  readonly profileCount: number;
  readonly targets: readonly string[];
}> {
  const appsDirectory = path.join(scope, 'apps');
  const appsStat = await lstat(appsDirectory).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if (!appsStat) return { profileCount: 0, targets: [] };
  if (!appsStat.isDirectory() || appsStat.isSymbolicLink()) {
    throw new Error('desktop-app-host-cache-target-invalid');
  }
  let profileCount = 0;
  const targets: string[] = [];
  for (const entry of await readdir(appsDirectory, { withFileTypes: true })) {
    if (!APP_HOST_PROFILE_NAME.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const sessionData = path.join(appsDirectory, entry.name, 'session-data');
    const sessionStat = await lstat(sessionData).catch(missingDirectoryOnly);
    if (!sessionStat?.isDirectory() || sessionStat.isSymbolicLink()) continue;
    profileCount += 1;
    for (const cacheName of APP_HOST_CACHE_DIRECTORIES) {
      const target = path.join(sessionData, cacheName);
      const targetStat = await lstat(target).catch(missingDirectoryOnly);
      if (targetStat?.isDirectory() && !targetStat.isSymbolicLink()) targets.push(target);
    }
  }
  return { profileCount, targets };
}

function missingDirectoryOnly(error: unknown): null {
  if (isNotFound(error)) return null;
  throw error;
}

// Logical file sizes only; links are neither followed nor counted.
async function measureCacheDirectory(target: string): Promise<{
  readonly totalBytes: bigint;
  readonly fileCount: bigint;
}> {
  let totalBytes = 0n;
  let fileCount = 0n;
  const entries = await readdir(target, { withFileTypes: true }).catch((error: unknown) => {
    if (isNotFound(error)) return [];
    throw error;
  });
  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const nested = await measureCacheDirectory(entryPath);
      totalBytes += nested.totalBytes;
      fileCount += nested.fileCount;
    } else if (entry.isFile()) {
      const entryStat = await lstat(entryPath, { bigint: true }).catch(missingDirectoryOnly);
      if (!entryStat) continue;
      totalBytes += entryStat.size;
      fileCount += 1n;
    }
  }
  return { totalBytes, fileCount };
}

async function resolveCanonicalDataRoot(
  resolver: () => Promise<string>,
): Promise<string> {
  const selected = await resolver();
  if (typeof selected !== 'string' || selected.trim() !== selected || !path.isAbsolute(selected)) {
    throw new Error('desktop-data-cleanup-data-root-invalid');
  }
  const selectedStat = await lstat(selected).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if (!selectedStat || !selectedStat.isDirectory() || selectedStat.isSymbolicLink()) {
    throw new Error('desktop-data-cleanup-data-root-invalid');
  }
  return realpath(selected);
}

function cleanupDirectory(value: unknown): CleanupDirectory {
  if (typeof value !== 'string') {
    throw new Error('desktop-data-cleanup-directory-invalid');
  }
  const directory = CLEANUP_DIRECTORIES.get(value);
  if (!directory) {
    throw new Error('desktop-data-cleanup-directory-invalid');
  }
  return directory;
}

function cleanupTarget(dataRoot: string, directory: string): string {
  const target = path.join(dataRoot, directory);
  if (path.dirname(target) !== dataRoot || path.basename(target) !== directory) {
    throw new Error('desktop-data-cleanup-target-invalid');
  }
  return target;
}

async function measureCleanupDirectory(target: string): Promise<{
  readonly totalBytes: bigint;
  readonly fileCount: bigint;
}> {
  const targetStat = await lstat(target, { bigint: true }).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  if (!targetStat) return { totalBytes: 0n, fileCount: 0n };
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error('desktop-data-cleanup-target-invalid');
  }

  let totalBytes = 0n;
  let fileCount = 0n;
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(target, entry.name);
    const entryStat = isArchiveFile(entry)
      ? lstatArchiveFile(entryPath)
      : await lstat(entryPath, { bigint: true });
    if (entryStat.isSymbolicLink()) {
      throw new Error('desktop-data-cleanup-symbolic-link-rejected');
    }
    if (entryStat.isDirectory()) {
      const nested = await measureCleanupDirectory(entryPath);
      totalBytes += nested.totalBytes;
      fileCount += nested.fileCount;
      continue;
    }
    if (!entryStat.isFile()) {
      throw new Error('desktop-data-cleanup-entry-type-invalid');
    }
    totalBytes += entryStat.size;
    fileCount += 1n;
  }
  return { totalBytes, fileCount };
}

// Electron presents `.asar` archives (installed Electron App packages under
// apps/) as directories whose entries ignore `bigint`; the directory listing
// still reports them as files, so measure each as the one file it is on disk.
function isArchiveFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.toLowerCase().endsWith('.asar');
}

function lstatArchiveFile(entryPath: string): BigIntStats {
  const previous = process.noAsar;
  process.noAsar = true;
  try {
    return lstatSync(entryPath, { bigint: true });
  } finally {
    process.noAsar = previous;
  }
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  failureCode: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(failureCode);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(failureCode);
  }
  return record;
}

function checkedNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('desktop-data-cleanup-impact-overflow');
  }
  return Number(value);
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { readonly code?: unknown }).code === 'ENOENT',
  );
}
