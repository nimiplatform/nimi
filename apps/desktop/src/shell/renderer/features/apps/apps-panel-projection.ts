// Current Desktop Apps projection.
//
// Runtime owns local-development registrations. Desktop preserves the typed
// projection for presentation and never derives registry, package, install,
// update, repair, run, or App Access admission truth from registration
// metadata. Host run state is consumed as its own typed projection.

import type {
  LocalDevelopmentRegistration,
  LocalDevelopmentRun,
} from '../local-development/local-development-types.js';
import { CANONICAL_CAPABILITY_IDS } from '@nimiplatform/kit/core/runtime-capabilities';
import type { NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';

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
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
  listRuns(): Promise<readonly LocalDevelopmentRun[]>;
  readAppAIConfig?(appId: string, options: DesktopAppAIConfigReadOptions): Promise<NimiAIConfigSnapshot>;
}

export interface DesktopAppsEntry {
  readonly registration: LocalDevelopmentRegistration;
  readonly run: LocalDevelopmentRun | null;
  readonly aiConfigSummary: DesktopAppAIConfigSummary | null;
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
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
  if (!source || typeof source.listRegistrations !== 'function' || typeof source.listRuns !== 'function') {
    return { status: 'error', detail: 'projectAppsPanel: local-development source is required' };
  }

  try {
    const [registrations, runs] = await Promise.all([
      source.listRegistrations(),
      source.listRuns(),
    ]);
    const previousEntries = options.previous?.status === 'loaded'
      ? new Map(options.previous.entries.map((entry) => [entry.registration.appId, entry]))
      : new Map<string, DesktopAppsEntry>();
    const registrationsSorted = [...registrations].sort((left, right) => {
      const byUpdatedAt = right.updatedAtUnixMs - left.updatedAtUnixMs;
      return byUpdatedAt || left.appId.localeCompare(right.appId);
    });
    const entries = await projectEntriesBounded(registrationsSorted, async (registration) => ({
      registration,
      run: runs.find((run) => run.appId === registration.appId) ?? null,
      aiConfigSummary: await projectAppAIConfigSummary({
        registration,
        source,
        previous: previousEntries.get(registration.appId)?.aiConfigSummary ?? null,
        refresh: options.refreshAIConfig !== false,
        timeoutMs: options.aiConfigReadTimeoutMs ?? 10_000,
      }),
    }));
    return {
      status: 'loaded',
      entries,
    };
  } catch (error) {
    return {
      status: 'error',
      detail: `local-development list failed: ${errorMessage(error)}`,
    };
  }
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
  readonly registration: LocalDevelopmentRegistration;
  readonly source: DesktopAppsProjectionSource;
  readonly previous: DesktopAppAIConfigSummary | null;
  readonly refresh: boolean;
  readonly timeoutMs: number;
}): Promise<DesktopAppAIConfigSummary | null> {
  if (!input.registration.appAccess.includes('runtime.consume')) return null;
  if (!input.refresh) return input.previous;
  if (!input.source.readAppAIConfig) return unavailableAIConfigSummary();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort('desktop-app-ai-config-summary-timeout');
        reject(new Error('Desktop App AIConfig summary read timed out'));
      }, input.timeoutMs);
    });
    const snapshot = await Promise.race([
      input.source.readAppAIConfig(input.registration.appId, {
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
