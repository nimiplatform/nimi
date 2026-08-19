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

export interface DesktopAppsProjectionSource {
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
  listRuns(): Promise<readonly LocalDevelopmentRun[]>;
}

export interface DesktopAppsEntry {
  readonly registration: LocalDevelopmentRegistration;
  readonly run: LocalDevelopmentRun | null;
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
  | { readonly status: 'error'; readonly detail: string };

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-home-009a
export async function projectAppsPanel(
  source: DesktopAppsProjectionSource,
): Promise<DesktopAppsPanelProjection> {
  if (!source || typeof source.listRegistrations !== 'function' || typeof source.listRuns !== 'function') {
    return { status: 'error', detail: 'projectAppsPanel: local-development source is required' };
  }

  try {
    const [registrations, runs] = await Promise.all([
      source.listRegistrations(),
      source.listRuns(),
    ]);
    return {
      status: 'loaded',
      entries: [...registrations]
        .sort((left, right) => {
          const byUpdatedAt = right.updatedAtUnixMs - left.updatedAtUnixMs;
          return byUpdatedAt || left.appId.localeCompare(right.appId);
        })
        .map((registration) => ({
          registration,
          run: runs.find((run) => run.appId === registration.appId) ?? null,
        })),
    };
  } catch (error) {
    return {
      status: 'error',
      detail: `local-development list failed: ${errorMessage(error)}`,
    };
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  return error.message;
}
