/**
 * `nimi.tester` App admission registry reference (`D-DEV-006`).
 *
 * The `Developer Tools` surface references `nimi.tester` as a developer-only
 * Nimi App. `D-DEV-006` requires that reference to consume the admitted
 * `nimi.tester` row in the Platform App admission registry (`P-NAPP-016`) as
 * the SINGLE admission truth source. It MUST NOT treat a Desktop source
 * folder, a Tauri command name, a workspace fixture cache, a GitHub repo, or
 * an npm package as the admission truth.
 *
 * The registry rows are projected into the desktop runtime as the generated
 * `PLATFORM_NIMI_APP_REGISTRY_ROWS` catalog (the typed projection of
 * `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`). This module
 * resolves the `nimi.tester` row from that projection and fails closed if the
 * row is absent or not admitted — it never synthesizes a fallback row.
 */

import { loadPlatformNimiAppRegistryRows } from '@runtime/platform-catalog/generated';

export const NIMI_TESTER_APP_ID = 'nimi.tester';

/**
 * The admitted `nimi.tester` registry reference, projected from the platform
 * App admission registry. This is the authoritative shape the `Developer
 * Tools` surface renders from.
 */
export type NimiTesterRegistryReference = {
  appId: string;
  displayName: string;
  /** `developer-only` per `P-NAPP-016` — never `ordinary-visible`. */
  ordinaryVisibility: string;
  releaseDescriptorRef: string;
  admissionStatus: string;
  sourceRule: string;
};

/**
 * Resolve the admitted `nimi.tester` registry row. Returns `null` (fail-closed)
 * when the row is missing or its `admissionStatus` is not `admitted` — the
 * surface then renders a typed unavailable state instead of inventing truth.
 */
export function resolveNimiTesterRegistryReference(): NimiTesterRegistryReference | null {
  const rows = loadPlatformNimiAppRegistryRows();
  const row = rows.find((entry) => entry.appId === NIMI_TESTER_APP_ID) ?? null;
  if (!row) {
    return null;
  }
  if (row.admissionStatus !== 'admitted') {
    return null;
  }
  return {
    appId: row.appId,
    displayName: row.displayName,
    ordinaryVisibility: row.ordinaryVisibility,
    releaseDescriptorRef: row.releaseDescriptorRef,
    admissionStatus: row.admissionStatus,
    sourceRule: row.sourceRule,
  };
}

/**
 * `true` when the resolved `nimi.tester` row is admitted AND scoped to
 * `developer-only` visibility — the only state in which Desktop may surface a
 * launch reference for the standalone Tester app inside `Developer Tools`.
 */
export function isNimiTesterDeveloperVisible(
  reference: NimiTesterRegistryReference | null,
): boolean {
  return Boolean(
    reference
      && reference.admissionStatus === 'admitted'
      && reference.ordinaryVisibility === 'developer-only',
  );
}
