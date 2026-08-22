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
import type { NimiCapabilityAIConfig } from '@nimiplatform/kit/core/sdk-contract';

export type DesktopAppAIConfigPosture =
  | 'unconfigured'
  | 'partial-local'
  | 'partial-cloud'
  | 'partial-mixed'
  | 'local'
  | 'cloud'
  | 'mixed'
  | 'unavailable';

export interface DesktopAppAIConfigSummary {
  readonly posture: DesktopAppAIConfigPosture;
  readonly configuredCount: number;
  readonly totalCount: number;
  readonly localCount: number;
  readonly cloudCount: number;
}

export interface DesktopAppsProjectionSource {
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
  listRuns(): Promise<readonly LocalDevelopmentRun[]>;
  readAppAIConfig?(appId: string): Promise<NimiCapabilityAIConfig | null>;
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
    const entries = await Promise.all(registrationsSorted.map(async (registration) => ({
      registration,
      run: runs.find((run) => run.appId === registration.appId) ?? null,
      aiConfigSummary: await projectAppAIConfigSummary({
        registration,
        source,
        previous: previousEntries.get(registration.appId)?.aiConfigSummary ?? null,
        refresh: options.refreshAIConfig !== false,
      }),
    })));
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

async function projectAppAIConfigSummary(input: {
  readonly registration: LocalDevelopmentRegistration;
  readonly source: DesktopAppsProjectionSource;
  readonly previous: DesktopAppAIConfigSummary | null;
  readonly refresh: boolean;
}): Promise<DesktopAppAIConfigSummary | null> {
  if (!input.registration.appAccess.includes('runtime.consume')) return null;
  if (!input.refresh) return input.previous;
  if (!input.source.readAppAIConfig) return unavailableAIConfigSummary();
  try {
    const config = await input.source.readAppAIConfig(input.registration.appId);
    return summarizeAppAIConfig(config);
  } catch {
    return unavailableAIConfigSummary();
  }
}

export function summarizeAppAIConfig(
  config: NimiCapabilityAIConfig | null,
): DesktopAppAIConfigSummary {
  const capabilities = config?.capabilities ?? [];
  const localCount = capabilities.filter((entry) => entry.route.oneofKind === 'local').length;
  const cloudCount = capabilities.filter((entry) => entry.route.oneofKind === 'cloud').length;
  const configuredCount = localCount + cloudCount;
  const totalCount = CANONICAL_CAPABILITY_IDS.length;
  const partial = configuredCount > 0 && configuredCount < totalCount;
  const route = localCount > 0 && cloudCount > 0
    ? 'mixed'
    : cloudCount > 0 ? 'cloud' : 'local';
  const posture: DesktopAppAIConfigPosture = configuredCount === 0
    ? 'unconfigured'
    : partial ? `partial-${route}` : route;
  return { posture, configuredCount, totalCount, localCount, cloudCount };
}

function unavailableAIConfigSummary(): DesktopAppAIConfigSummary {
  return {
    posture: 'unavailable',
    configuredCount: 0,
    totalCount: CANONICAL_CAPABILITY_IDS.length,
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
