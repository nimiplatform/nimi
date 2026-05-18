// Discovery Surface Projection — view-model for the Discovery tab.
//
// Wave 1 redesign rule: Discovery lists installable admitted first-party
// apps first; later verified-partner / community apps when ecosystem
// closes (Wave 6+). For now we surface admitted Nimi Apps whose status
// is install-required (or repair-required) — pure projection over the
// already-typed Wave 2 NimiAppClient + Library projection. Fail-closed.

import type { NimiAppClient } from '@nimiplatform/sdk/app';
import type { LibraryEntry } from './library-projection.js';
import { projectLibrary } from './library-projection.js';

export type DiscoveryProjection =
  | { readonly status: 'loaded'; readonly entries: readonly LibraryEntry[] }
  | { readonly status: 'error'; readonly detail: string };

/**
 * Build the Discovery projection: filters the Library projection to
 * apps whose current launchReadiness is install-required, update-required,
 * or repair-required. When the underlying Library projection errors,
 * Discovery projects the same error — never silently shows an empty
 * discovery list.
 */
export async function projectDiscovery(client: NimiAppClient): Promise<DiscoveryProjection> {
  const library = await projectLibrary(client);
  if (library.status === 'error') {
    return { status: 'error', detail: library.detail };
  }
  const filtered = library.entries.filter((entry) => {
    const readiness = entry.status?.launchReadiness;
    return readiness === 'install-required' || readiness === 'update-required' || readiness === 'repair-required';
  });
  return { status: 'loaded', entries: filtered };
}
