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
const DESTRUCTIVE_CLEANUP_CONFIRMATION = 'CLEAN';

type CleanupDirectory = {
  readonly directory: string;
  readonly owner: string;
  readonly cleanupClass: 'runtime_managed' | 'confirm_required';
  readonly runtimeOwnerBlocked: boolean;
};

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
    cleanupClass: 'confirm_required',
    runtimeOwnerBlocked: false,
  }],
  ['accounts', {
    directory: 'accounts',
    owner: 'account_data_plane_consumers',
    cleanupClass: 'confirm_required',
    runtimeOwnerBlocked: false,
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

type CommandContext = {
  readonly payload: Readonly<Record<string, unknown>>;
};

export type DesktopElectronDataCleanupHost = {
  readonly commandHandlers: Readonly<{
    [PLAN_COMMAND]: (context: CommandContext) => Promise<DesktopElectronDataCleanupPlan>;
    [EXECUTE_COMMAND]: (context: CommandContext) => Promise<DesktopElectronDataCleanupOutcome>;
  }>;
};

export function createDesktopElectronDataCleanupHost(input: {
  readonly resolveReadyDataRoot: () => Promise<string>;
  readonly operationGate?: DesktopDataRootOperationGate;
}): DesktopElectronDataCleanupHost {
  const operationGate = input.operationGate ?? createDesktopDataRootOperationGate();

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
    },
  };
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
  const entries = await readdir(target);
  for (const entry of entries) {
    const entryPath = path.join(target, entry);
    const entryStat = await lstat(entryPath, { bigint: true });
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
