// Runtime owns source-qualified installed/package state; local-development
// registration remains a separate source; Desktop owns supervised run state.
// Public catalog search has no admitted consumer yet and is projected only as
// explicitly unavailable. Presentation may group visually later, but owner
// rows and actions remain keyed by source identity.

import type {
  LocalDevelopmentRegistration,
  LocalDevelopmentRun,
} from '../local-development/local-development-types.js';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import type { NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';
import {
  AppPackageJobPhase,
  AppPackageSourceClass,
  AppPackageTerminalResult,
  type AppPackageJob,
  type CommittedAppRelease,
} from '@nimiplatform/sdk/runtime/wire-types';

export type DesktopAppAIConfigRoutePosture =
  | 'unconfigured'
  | 'partial-local'
  | 'partial-cloud'
  | 'partial-mixed'
  | 'local'
  | 'cloud'
  | 'mixed';

export type DesktopAppAIConfigHealthPosture = 'healthy' | 'blocked' | 'unavailable';

export interface DesktopAppAIConfigSummary {
  readonly routePosture: DesktopAppAIConfigRoutePosture;
  readonly healthPosture: DesktopAppAIConfigHealthPosture;
  readonly intentCount: number;
  readonly total: number;
  readonly blockedCount: number;
  readonly localCount: number;
  readonly cloudCount: number;
}

export interface DesktopAppAIConfigReadOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface DesktopAppsProjectionSource {
  listCommittedReleases(): Promise<readonly CommittedAppRelease[]>;
  listPackageJobs(): Promise<readonly AppPackageJob[]>;
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
  listRuns(): Promise<readonly LocalDevelopmentRun[]>;
  readAppAIConfig?(appId: string, options: DesktopAppAIConfigReadOptions): Promise<NimiAIConfigSnapshot>;
}

export interface DesktopAppsCommonIdentity {
  readonly entryKey: string;
  readonly appId: string;
  readonly sourceClass: DesktopAppSourceClass;
  readonly displayName: string;
  readonly updatedAtUnixMs: number;
}

export type DesktopAppSourceClass = 'local_development' | 'verified' | 'user_imported';

export function desktopAppsEntryKey(appId: string, sourceClass: DesktopAppSourceClass, selector = ''): string {
  return sourceClass === 'local_development'
    ? `${sourceClass}:${appId}:${selector}`
    : `${sourceClass}:${appId}`;
}

export interface DesktopAppsEntry {
  readonly identity: DesktopAppsCommonIdentity;
  readonly localDevelopment: LocalDevelopmentRegistration | null;
  readonly committedRelease: CommittedAppRelease | null;
  readonly packageJob: AppPackageJob | null;
  readonly run: LocalDevelopmentRun | null;
  readonly aiConfigSummary: DesktopAppAIConfigSummary | null;
}

export type DesktopAppsPanelProjection =
  | {
      readonly status: 'loaded';
      readonly entries: readonly DesktopAppsEntry[];
      readonly catalogStatus: 'not-implemented';
      readonly runtimeError: string | null;
    }
  | { readonly status: 'error'; readonly detail: string };

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-home-009a
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-home-009e
// @nimi-authority: rule.nimi.desktop.shell-ui.r102
export async function projectAppsPanel(
  source: DesktopAppsProjectionSource,
  options: {
    readonly previous?: DesktopAppsPanelProjection | null;
    readonly refreshAIConfig?: boolean;
    readonly aiConfigReadTimeoutMs?: number;
  } = {},
): Promise<DesktopAppsPanelProjection> {
  if (
    !source
    || typeof source.listCommittedReleases !== 'function'
    || typeof source.listPackageJobs !== 'function'
    || typeof source.listRegistrations !== 'function'
    || typeof source.listRuns !== 'function'
  ) {
    return { status: 'error', detail: 'projectAppsPanel: Runtime lifecycle and local-development sources are required' };
  }

  try {
    const runtimeRequest = Promise.all([
      source.listCommittedReleases(),
      source.listPackageJobs(),
    ]).then(([releases, jobs]) => ({ ok: true as const, releases, jobs }))
      .catch((error: unknown) => ({ ok: false as const, error }));
    const [registrations, runs, runtimeResult] = await Promise.all([
      source.listRegistrations(),
      source.listRuns(),
      runtimeRequest,
    ]);
    const previousEntries = options.previous?.status === 'loaded'
      ? new Map(options.previous.entries.map((entry) => [entry.identity.entryKey, entry]))
      : new Map<string, DesktopAppsEntry>();
    const entriesByKey = new Map<string, DesktopAppsEntry>();
    const runtimeRows = runtimeResult.ok
      ? indexRuntimeLifecycle(runtimeResult.releases, runtimeResult.jobs)
      : {
          releasesByKey: new Map(options.previous?.status === 'loaded'
            ? options.previous.entries.flatMap((entry) => entry.committedRelease
                ? [[entry.identity.entryKey, entry.committedRelease] as const]
                : [])
            : []),
          jobsByKey: new Map(options.previous?.status === 'loaded'
            ? options.previous.entries.flatMap((entry) => entry.packageJob
                ? [[entry.identity.entryKey, entry.packageJob] as const]
                : [])
            : []),
          conflict: null,
        };
    if (runtimeRows.conflict) {
      return { status: 'error', detail: runtimeRows.conflict };
    }
    for (const registration of registrations) {
      const entryKey = desktopAppsEntryKey(registration.appId, 'local_development', registration.selector);
      entriesByKey.set(entryKey, {
        identity: {
          entryKey,
          appId: registration.appId,
          sourceClass: 'local_development',
          displayName: registration.displayName,
          updatedAtUnixMs: registration.updatedAtUnixMs,
        },
        localDevelopment: registration,
        committedRelease: null,
        packageJob: null,
        run: runs.find((run) => run.selector === registration.selector) ?? null,
        aiConfigSummary: null,
      });
    }
    for (const [entryKey, committedRelease] of runtimeRows.releasesByKey) {
      const sourceClass = runtimeSourceClass(committedRelease.sourceClass);
      const current = entriesByKey.get(entryKey) ?? emptyRuntimeAppsEntry(committedRelease.appId, sourceClass);
      entriesByKey.set(entryKey, {
        ...current,
        identity: {
          ...current.identity,
          updatedAtUnixMs: Math.max(
            current.identity.updatedAtUnixMs,
            timestampUnixMs(committedRelease.committedAt),
          ),
        },
        committedRelease,
      });
    }
    for (const [entryKey, packageJob] of runtimeRows.jobsByKey) {
      const sourceClass = runtimeSourceClass(packageJob.sourceClass);
      const current = entriesByKey.get(entryKey) ?? emptyRuntimeAppsEntry(packageJob.appId, sourceClass);
      entriesByKey.set(entryKey, {
        ...current,
        identity: {
          ...current.identity,
          updatedAtUnixMs: Math.max(
            current.identity.updatedAtUnixMs,
            timestampUnixMs(packageJob.startedAt),
          ),
        },
        packageJob,
      });
    }
    const mergedEntries = [...entriesByKey.values()].sort((left, right) => (
      right.identity.updatedAtUnixMs - left.identity.updatedAtUnixMs
      || left.identity.appId.localeCompare(right.identity.appId)
    ));
    const entries = await projectEntriesBounded(mergedEntries, async (entry) => ({
      ...entry,
      aiConfigSummary: appAccessForAIConfig(entry).includes('runtime.consume')
        ? await projectAppAIConfigSummary({
            appId: entry.identity.appId,
            appAccess: appAccessForAIConfig(entry),
            source,
            previous: previousEntries.get(entry.identity.entryKey)?.aiConfigSummary ?? null,
            refresh: options.refreshAIConfig !== false,
            timeoutMs: options.aiConfigReadTimeoutMs ?? 10_000,
          })
        : null,
    }));
    return {
      status: 'loaded',
      entries,
      catalogStatus: 'not-implemented',
      runtimeError: runtimeResult.ok
        ? null
        : `Runtime Apps lifecycle list failed: ${errorMessage(runtimeResult.error)}`,
    };
  } catch (error) {
    return {
      status: 'error',
      detail: `Apps inventory projection failed: ${errorMessage(error)}`,
    };
  }
}

function emptyRuntimeAppsEntry(appId: string, sourceClass: Exclude<DesktopAppSourceClass, 'local_development'>): DesktopAppsEntry {
  const entryKey = desktopAppsEntryKey(appId, sourceClass);
  return {
    identity: { entryKey, appId, sourceClass, displayName: appId, updatedAtUnixMs: 0 },
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
  };
}

function indexRuntimeLifecycle(
  releases: readonly CommittedAppRelease[],
  jobs: readonly AppPackageJob[],
): {
  readonly releasesByKey: Map<string, CommittedAppRelease>;
  readonly jobsByKey: Map<string, AppPackageJob>;
  readonly conflict: string | null;
} {
  const releasesByKey = new Map<string, CommittedAppRelease>();
  for (const release of releases) {
    const sourceClass = runtimeSourceClass(release.sourceClass);
    const entryKey = desktopAppsEntryKey(release.appId, sourceClass);
    if (releasesByKey.has(entryKey)) {
      return {
        releasesByKey,
        jobsByKey: new Map(),
        conflict: `Runtime Apps lifecycle conflict: multiple committed releases for ${entryKey}`,
      };
    }
    releasesByKey.set(entryKey, release);
  }

  const jobsByOwner = new Map<string, AppPackageJob[]>();
  for (const job of jobs) {
    const entryKey = desktopAppsEntryKey(job.appId, runtimeSourceClass(job.sourceClass));
    const ownerJobs = jobsByOwner.get(entryKey) ?? [];
    ownerJobs.push(job);
    jobsByOwner.set(entryKey, ownerJobs);
  }
  const jobsByKey = new Map<string, AppPackageJob>();
  for (const [entryKey, ownerJobs] of jobsByOwner) {
    const active = ownerJobs.filter((job) => !isTerminalPackageJob(job));
    if (active.length > 1) {
      return {
        releasesByKey,
        jobsByKey,
        conflict: `Runtime Apps lifecycle conflict: multiple active package jobs for ${entryKey}`,
      };
    }
    const latestTerminal = ownerJobs
      .filter(isTerminalPackageJob)
      .sort((left, right) => (
        timestampUnixMs(right.startedAt) - timestampUnixMs(left.startedAt)
        || bytesKey(left.jobId).localeCompare(bytesKey(right.jobId))
      ))[0] ?? null;
    const current = active[0] ?? (latestTerminal && isFailedPackageJob(latestTerminal)
      ? latestTerminal
      : null);
    if (current) jobsByKey.set(entryKey, current);
  }
  return { releasesByKey, jobsByKey, conflict: null };
}

function runtimeSourceClass(sourceClass: AppPackageSourceClass): 'verified' | 'user_imported' {
  if (sourceClass === AppPackageSourceClass.VERIFIED) return 'verified';
  if (sourceClass === AppPackageSourceClass.USER_IMPORTED) return 'user_imported';
  throw new Error(`Unsupported Runtime App package source: ${String(sourceClass)}`);
}

function isTerminalPackageJob(job: AppPackageJob): boolean {
  return job.phase === AppPackageJobPhase.COMPLETED
    || job.phase === AppPackageJobPhase.FAILED
    || job.phase === AppPackageJobPhase.CANCELED;
}

function isFailedPackageJob(job: AppPackageJob): boolean {
  return job.phase === AppPackageJobPhase.FAILED
    || job.terminalResult === AppPackageTerminalResult.FAILED;
}

function bytesKey(value: Uint8Array): string {
  return Array.from(value, (item) => item.toString(16).padStart(2, '0')).join('');
}

function timestampUnixMs(timestamp: { readonly seconds: string; readonly nanos: number } | undefined): number {
  if (!timestamp) return 0;
  const seconds = Number(timestamp.seconds);
  if (!Number.isSafeInteger(seconds) || !Number.isInteger(timestamp.nanos)) return 0;
  return seconds * 1_000 + timestamp.nanos / 1_000_000;
}

function appAccessForAIConfig(entry: DesktopAppsEntry): readonly string[] {
  if (entry.localDevelopment) return entry.localDevelopment.appAccess;
  return [];
}

async function projectEntriesBounded<TInput, TOutput>(
  input: readonly TInput[],
  project: (value: TInput) => Promise<TOutput>,
): Promise<readonly TOutput[]> {
  const output = new Array<TOutput>(input.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < input.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await project(input[index]!);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(4, input.length) },
    () => worker(),
  ));
  return output;
}

async function projectAppAIConfigSummary(input: {
  readonly appId: string;
  readonly appAccess: readonly string[];
  readonly source: DesktopAppsProjectionSource;
  readonly previous: DesktopAppAIConfigSummary | null;
  readonly refresh: boolean;
  readonly timeoutMs: number;
}): Promise<DesktopAppAIConfigSummary | null> {
  if (!input.appAccess.includes('runtime.consume')) return null;
  if (!input.refresh) return input.previous;
  if (!input.source.readAppAIConfig) return unavailableAIConfigSummary();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort('desktop-app-ai-config-summary-timeout');
        reject(new Error('Nimi App AIConfig summary read timed out'));
      }, input.timeoutMs);
    });
    const snapshot = await Promise.race([
      input.source.readAppAIConfig(input.appId, {
        timeoutMs: input.timeoutMs,
        signal: controller.signal,
      }),
      timedOut,
    ]);
    return summarizeAppAIConfig(snapshot);
  } catch {
    return unavailableAIConfigSummary(input.previous);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function summarizeAppAIConfig(
  snapshot: NimiAIConfigSnapshot,
): DesktopAppAIConfigSummary {
  const config = snapshot.config;
  const capabilities = config?.capabilities ?? [];
  const localCount = capabilities.filter((entry) => entry.route.oneofKind === 'local').length;
  const cloudCount = capabilities.filter((entry) => entry.route.oneofKind === 'cloud').length;
  const intentCount = localCount + cloudCount;
  const total = CANONICAL_CAPABILITY_IDS.length;
  const partial = intentCount > 0 && intentCount < total;
  const route = localCount > 0 && cloudCount > 0
    ? 'mixed'
    : cloudCount > 0 ? 'cloud' : 'local';
  const routePosture: DesktopAppAIConfigRoutePosture = intentCount === 0
    ? 'unconfigured'
    : partial ? `partial-${route}` : route;
  const effectiveByCapability = new Map(
    snapshot.effectiveSelections.map((selection) => [selection.capabilityContract, selection]),
  );
  const blockedCount = capabilities.filter((capability) => {
    const state = effectiveByCapability.get(capability.capabilityContract)?.state;
    return state === 'missing' || state === 'blocked';
  }).length;
  const effectiveUnavailable = capabilities.some((capability) => {
    const state = effectiveByCapability.get(capability.capabilityContract)?.state;
    return state === undefined || state === 'unavailable';
  });
  const healthPosture: DesktopAppAIConfigHealthPosture = effectiveUnavailable
    ? 'unavailable'
    : blockedCount > 0 ? 'blocked' : 'healthy';
  return { routePosture, healthPosture, intentCount, total, blockedCount, localCount, cloudCount };
}

function unavailableAIConfigSummary(
  previous: DesktopAppAIConfigSummary | null = null,
): DesktopAppAIConfigSummary {
  if (previous) return { ...previous, healthPosture: 'unavailable' };
  return {
    routePosture: 'unconfigured',
    healthPosture: 'unavailable',
    intentCount: 0,
    total: CANONICAL_CAPABILITY_IDS.length,
    blockedCount: 0,
    localCount: 0,
    cloudCount: 0,
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  return error.message;
}
