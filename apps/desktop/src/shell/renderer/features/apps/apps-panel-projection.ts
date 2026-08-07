// Current Desktop Apps projection.
//
// Runtime owns local-development registrations. Desktop preserves the typed
// projection for presentation and never derives registry, package, install,
// update, repair, launch, or App Access admission truth.

import type { LocalDevelopmentRegistration } from '../local-development/local-development-types.js';

export interface DesktopAppsProjectionSource {
  listRegistrations(): Promise<readonly LocalDevelopmentRegistration[]>;
}

export interface DesktopAppsEntry {
  readonly registration: LocalDevelopmentRegistration;
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
  | { readonly status: 'error'; readonly detail: string };

export async function projectAppsPanel(
  source: DesktopAppsProjectionSource,
): Promise<DesktopAppsPanelProjection> {
  if (!source || typeof source.listRegistrations !== 'function') {
    return { status: 'error', detail: 'projectAppsPanel: local-development source is required' };
  }

  try {
    const registrations = await source.listRegistrations();
    return {
      status: 'loaded',
      entries: [...registrations]
        .sort((left, right) => {
          const byUpdatedAt = right.updatedAtUnixMs - left.updatedAtUnixMs;
          return byUpdatedAt || left.appId.localeCompare(right.appId);
        })
        .map((registration) => ({ registration })),
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
