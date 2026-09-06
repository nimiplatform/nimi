// Runtime owns source-qualified installed/package state; local-development
// registration remains a separate source; Desktop owns supervised run state.
// Public Catalog facts are accepted only through the Runtime SDK projection.
// The production Apps consumer supplies the sole Runtime Catalog port.
// Rows and actions remain keyed by source identity.

import type {
  LocalDevelopmentRegistration,
  LocalDevelopmentRun,
} from '../local-development/local-development-types.js';
import type { InstalledAppRun } from '../../../shared/installed-app-types.js';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import type { NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';
import {
  AppPackageJobPhase,
  AppPackageSourceClass,
  AppPackageTerminalResult,
  type ApprovedAppCatalogTarget,
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

export interface DesktopAppsCatalogProjection {
  readonly status: 'loading' | 'not-implemented' | 'loaded' | 'unavailable';
  readonly targets: readonly ApprovedAppCatalogTarget[];
  readonly error?: unknown;
}

export interface DesktopAppsProjectionSource {
  listApprovedCatalogTargets?(): Promise<readonly ApprovedAppCatalogTarget[]>;
  listCommittedReleases(): Promise<readonly CommittedAppRelease[]>;
  listPackageJobs(): Promise<readonly AppPackageJob[]>;
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
  listRuns(): Promise<readonly LocalDevelopmentRun[]>;
  listInstalledRuns?(): Promise<readonly InstalledAppRun[]>;
  readAppAIConfig?(appId: string, options: DesktopAppAIConfigReadOptions): Promise<NimiAIConfigSnapshot>;
  readAppIcon?(selector: string): Promise<string | null>;
  readProjectReadme?(selector: string): Promise<{ readonly content: string | null }>;
}

export interface DesktopAppsCommonIdentity {
  readonly entryKey: string;
  readonly appId: string;
  readonly sourceClass: DesktopAppSourceClass;
  readonly displayName: string;
  readonly updatedAtUnixMs: number;
}

export type DesktopAppSourceClass = 'local_development' | 'user_imported' | 'verified';

export function desktopAppsEntryKey(appId: string, sourceClass: DesktopAppSourceClass, selector = ''): string {
  return sourceClass === 'local_development'
    ? `${sourceClass}:${appId}:${selector}`
    : `${sourceClass}:${appId}`;
}

export interface DesktopAppsEntry {
  readonly identity: DesktopAppsCommonIdentity;
  readonly catalogTarget: ApprovedAppCatalogTarget | null;
  readonly localDevelopment: LocalDevelopmentRegistration | null;
  readonly committedRelease: CommittedAppRelease | null;
  readonly packageJob: AppPackageJob | null;
  readonly run: LocalDevelopmentRun | InstalledAppRun | null;
  readonly aiConfigSummary: DesktopAppAIConfigSummary | null;
  /**
   * Host-read project icon (PNG data URL) for identity visuals, or null when
   * the project has no conventional icon. Presentation content only, exactly
   * like the project README; never runnable truth.
   */
  readonly iconUrl: string | null;
  /**
   * Short intro excerpt derived from the host-read project README, or null
   * when the project has no README prose. Presentation content only; the
   * formal catalog owns release descriptions for installed Apps.
   */
  readonly summary: string | null;
}

export type DesktopAppsPanelProjection =
  | {
      readonly status: 'loaded';
      readonly entries: readonly DesktopAppsEntry[];
      readonly catalogStatus: DesktopAppsCatalogProjection['status'];
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
    readonly catalog?: DesktopAppsCatalogProjection;
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
    const catalogResult: DesktopAppsCatalogProjection = options.catalog ?? {
      status: source.listApprovedCatalogTargets ? 'loading' : 'not-implemented', targets: [],
    };
    const [registrations, runs, runtimeResult, installedRuns] = await Promise.all([
      source.listRegistrations(),
      source.listRuns(),
      runtimeRequest,
      source.listInstalledRuns?.() ?? Promise.resolve([] as readonly InstalledAppRun[]),
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
    const catalogRows = indexRuntimeCatalog(catalogResult.targets);
    if (catalogRows.conflict) {
      return { status: 'error', detail: catalogRows.conflict };
    }
    for (const [entryKey, catalogTarget] of catalogRows.targetsByKey) {
      entriesByKey.set(entryKey, {
        identity: {
          entryKey,
          appId: catalogTarget.appId,
          sourceClass: 'verified',
          displayName: catalogTarget.displayName,
          updatedAtUnixMs: 0,
        },
        catalogTarget,
        localDevelopment: null,
        committedRelease: null,
        packageJob: null,
        run: null,
        aiConfigSummary: null,
        iconUrl: null,
        summary: null,
      });
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
        catalogTarget: null,
        localDevelopment: registration,
        committedRelease: null,
        packageJob: null,
        run: runs.find((run) => run.selector === registration.selector) ?? null,
        aiConfigSummary: null,
        iconUrl: null,
        summary: null,
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
        run: installedRuns.find((run) => run.launchSelector.length === committedRelease.launchSelector.length
          && run.launchSelector.every((byte, index) => byte === committedRelease.launchSelector[index])) ?? null,
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
      iconUrl: await projectAppIconUrl({
        entry,
        source,
        previous: previousIconUrl(previousEntries.get(entry.identity.entryKey) ?? null, entry),
      }),
      summary: await projectAppSummary({
        entry,
        source,
        previous: previousSummary(previousEntries.get(entry.identity.entryKey) ?? null, entry),
      }),
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
      catalogStatus: catalogResult.status,
      runtimeError: [
        runtimeResult.ok ? null : `Runtime Apps lifecycle list failed: ${errorMessage(runtimeResult.error)}`,
        catalogResult.status === 'unavailable' ? `Runtime Apps Catalog list failed: ${errorMessage(catalogResult.error)}` : null,
      ].filter((message): message is string => message !== null).join('; ') || null,
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
    catalogTarget: null,
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
  };
}

function indexRuntimeCatalog(targets: readonly ApprovedAppCatalogTarget[]): {
  readonly targetsByKey: Map<string, ApprovedAppCatalogTarget>;
  readonly conflict: string | null;
} {
  const targetsByKey = new Map<string, ApprovedAppCatalogTarget>();
  for (const target of targets) {
    const entryKey = desktopAppsEntryKey(target.appId, 'verified');
    if (targetsByKey.has(entryKey)) {
      return { targetsByKey, conflict: `Runtime Apps Catalog conflict: multiple targets for ${entryKey}` };
    }
    targetsByKey.set(entryKey, cloneApprovedAppCatalogTarget(target));
  }
  return { targetsByKey, conflict: null };
}

function cloneApprovedAppCatalogTarget(target: ApprovedAppCatalogTarget): ApprovedAppCatalogTarget {
  return {
    ...target,
    approvedTargetSelector: target.approvedTargetSelector.slice(),
    appAccess: [...target.appAccess],
    capabilityContractRefs: [...target.capabilityContractRefs],
    requiredStandardizedFeatureRefs: [...target.requiredStandardizedFeatureRefs],
    osStorageDisclosures: target.osStorageDisclosures.map((disclosure) => ({ ...disclosure })),
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
  if (sourceClass === AppPackageSourceClass.USER_IMPORTED) return 'user_imported';
  if (sourceClass === AppPackageSourceClass.VERIFIED) return 'verified';
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

/**
 * Icon reads repeat only when the registration itself changed; an unchanged
 * registration reuses the previous projection, including a previous null.
 */
function previousIconUrl(
  previousEntry: DesktopAppsEntry | null,
  entry: DesktopAppsEntry,
): string | null | undefined {
  if (!previousEntry) return undefined;
  return previousEntry.identity.updatedAtUnixMs === entry.identity.updatedAtUnixMs
    ? previousEntry.iconUrl
    : undefined;
}

async function projectAppIconUrl(input: {
  readonly entry: DesktopAppsEntry;
  readonly source: DesktopAppsProjectionSource;
  readonly previous: string | null | undefined;
}): Promise<string | null> {
  if (!input.entry.localDevelopment) return null;
  if (input.previous !== undefined) return input.previous;
  if (!input.source.readAppIcon) return null;
  try {
    return await input.source.readAppIcon(input.entry.localDevelopment.selector);
  } catch {
    return null;
  }
}

/**
 * Summary reads repeat only when the registration itself changed, exactly
 * like icon reads; an unchanged registration reuses the previous projection.
 */
function previousSummary(
  previousEntry: DesktopAppsEntry | null,
  entry: DesktopAppsEntry,
): string | null | undefined {
  if (!previousEntry) return undefined;
  return previousEntry.identity.updatedAtUnixMs === entry.identity.updatedAtUnixMs
    ? previousEntry.summary
    : undefined;
}

async function projectAppSummary(input: {
  readonly entry: DesktopAppsEntry;
  readonly source: DesktopAppsProjectionSource;
  readonly previous: string | null | undefined;
}): Promise<string | null> {
  if (!input.entry.localDevelopment) return null;
  if (input.previous !== undefined) return input.previous;
  if (!input.source.readProjectReadme) return null;
  try {
    const readme = await input.source.readProjectReadme(input.entry.localDevelopment.selector);
    return deriveAppSummary(readme.content);
  } catch {
    return null;
  }
}

const APP_SUMMARY_MAX_LENGTH = 160;

/**
 * Card intro derived from the host-read project README: the first prose
 * paragraph after skipping headings, badge/link rows, images, HTML blocks,
 * lists, quotes, tables, and fenced code. Presentation content only.
 */
export function deriveAppSummary(readmeContent: string | null): string | null {
  if (!readmeContent) return null;
  const paragraph: string[] = [];
  let inFence = false;
  for (const rawLine of readmeContent.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      if (paragraph.length > 0) break;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (line === '') {
      if (paragraph.length > 0) break;
      continue;
    }
    if (paragraph.length === 0 && isNonProseReadmeLine(line)) continue;
    if (paragraph.length > 0 && line.startsWith('#')) break;
    paragraph.push(line);
  }
  const text = paragraph
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/[*_~`]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (text === '') return null;
  return text.length > APP_SUMMARY_MAX_LENGTH
    ? `${text.slice(0, APP_SUMMARY_MAX_LENGTH)}…`
    : text;
}

function isNonProseReadmeLine(line: string): boolean {
  return line.startsWith('#')
    || line.startsWith('!')
    || line.startsWith('<')
    || line.startsWith('[')
    || line.startsWith('>')
    || line.startsWith('|')
    || /^[-*+]\s/u.test(line)
    || /^\d+[.)]\s/u.test(line)
    || /^(-{3,}|={3,}|\*{3,}|_{3,})$/u.test(line);
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
