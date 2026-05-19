// Library Surface Projection — view-model for the Library tab.
//
// Pure function over an injected NimiAppClient (Wave 2 SDK). Fetches the
// admitted Nimi App registry, augments rows with their current launch
// readiness, and projects a typed list suitable for React rendering.
// Fail-closed: client errors map to an `error` projection; never silently
// shows an empty registry as if it succeeded.

import type {
  NimiAppClient,
  NimiAppRow,
  NimiAppStatus,
  AppLaunchReadiness,
} from '@nimiplatform/sdk/app';

export interface LibraryEntry {
  readonly app: NimiAppRow;
  readonly status?: NimiAppStatus;
  readonly fetchError?: string;
}

export type LibraryProjection =
  | { readonly status: 'loaded'; readonly entries: readonly LibraryEntry[] }
  | { readonly status: 'error'; readonly detail: string };

const CANONICAL_LAUNCH_READINESS_SET: ReadonlySet<AppLaunchReadiness> = new Set([
  'ready',
  'install-required',
  'update-required',
  'repair-required',
  'permission-required',
  'blocked-by-master-gate',
  'unsupported',
]);

/**
 * Build the typed Library projection. Lists admitted Nimi App registry
 * rows and best-effort fetches per-app status. Per-app status errors are
 * captured per entry; top-level registry fetch errors collapse to the
 * `error` projection (the surface cannot pretend success when the
 * registry itself is unreachable).
 */
export async function projectLibrary(client: NimiAppClient): Promise<LibraryProjection> {
  if (!client) {
    return { status: 'error', detail: 'projectLibrary: nimiAppClient is required' };
  }
  let registry: readonly NimiAppRow[];
  try {
    registry = await client.list();
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return { status: 'error', detail: `list failed: ${detail}` };
  }
  const entries: LibraryEntry[] = [];
  for (const app of registry) {
    try {
      const status = await client.status(app.appId);
      if (!CANONICAL_LAUNCH_READINESS_SET.has(status.launchReadiness)) {
        entries.push({ app, fetchError: `non-canonical launchReadiness "${String(status.launchReadiness)}"` });
        continue;
      }
      entries.push({ app, status });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      entries.push({ app, fetchError: `status failed: ${detail}` });
    }
  }
  return { status: 'loaded', entries };
}
