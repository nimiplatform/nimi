// Current Desktop Apps projection.
//
// Runtime owns the authorization records. Desktop preserves the typed
// projection for presentation and never derives registry, package, install,
// update, repair, or launch truth.

import type { LocalDevelopmentAuthorization } from '../local-development/local-development-types.js';

export interface DesktopAppsProjectionSource {
  listAuthorizations(): Promise<readonly LocalDevelopmentAuthorization[]>;
}

export interface DesktopAppsEntry {
  readonly authorization: LocalDevelopmentAuthorization;
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
  | { readonly status: 'error'; readonly detail: string };

export async function projectAppsPanel(
  source: DesktopAppsProjectionSource,
): Promise<DesktopAppsPanelProjection> {
  if (!source || typeof source.listAuthorizations !== 'function') {
    return { status: 'error', detail: 'projectAppsPanel: local-development source is required' };
  }

  try {
    const authorizations = await source.listAuthorizations();
    return {
      status: 'loaded',
      entries: [...authorizations]
        .sort((left, right) => {
          const byUpdatedAt = right.updatedAtUnixMs - left.updatedAtUnixMs;
          return byUpdatedAt || left.appId.localeCompare(right.appId);
        })
        .map((authorization) => ({ authorization })),
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
