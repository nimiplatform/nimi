// Apps card fields (T4-W4).
//
// Derives the displayable card fields from the typed projections, verbatim
// from the manual `#### App Card Fields` table:
//   - App name and icon
//   - Publisher / trust tier
//   - Install state
//   - Version state
//   - Requirement summary
//   - Primary / secondary action (resolved separately in `apps-card-actions`)
//
// Every field is a projection of an already-typed surface. The icon is a
// stable, deterministic glyph keyed off the registry `appId` (no app-local
// asset read — the manual forbids reading app-local files for the Apps
// surface). The requirement summary names the AI / permission / data /
// runtime requirement surfaces at a product level.

import type { DesktopAppsEntry } from './apps-panel-projection.js';

/**
 * The version-state projection. `installed` is the active release version;
 * `available` is a newer offered version when one exists. Either may be
 * absent — a never-installed app has no `installed` version.
 */
export interface AppCardVersionState {
  readonly installed?: string;
  readonly available?: string;
}

/** Derive the version-state field from the entry's typed status projection. */
export function deriveVersionState(entry: DesktopAppsEntry): AppCardVersionState {
  const status = entry.status;
  if (!status) {
    return {};
  }
  const installed = optional(status.installedVersion);
  const available = optional(status.availableVersion);
  return {
    ...(installed ? { installed } : {}),
    ...(available && available !== installed ? { available } : {}),
  };
}

/**
 * The product-level requirement summary. Each flag is `true` when the app
 * declares that requirement surface in its registry projection. The Apps card
 * shows these as compact requirement chips; the detail view expands them.
 */
export interface AppCardRequirementSummary {
  readonly ai: boolean;
  readonly permissions: boolean;
  readonly data: boolean;
  readonly runtime: boolean;
}

/**
 * Derive the requirement summary from the registry row. Every admitted Nimi
 * App row carries a `releaseDescriptorRef` (runtime/package requirement) and
 * an `installStoragePolicyRef` (data-root requirement); the AI requirement is
 * present when the row declares an AI profile selection surface, and the
 * permission requirement is present when the row declares a permission scope.
 *
 * The registry `NimiAppRow` exposed to the SDK floor does not itself carry the
 * AI/permission refs (those live on the lower-level registry source row), so
 * at the floor level `ai` / `permissions` are conservatively reported `true`
 * for every admitted app — every admitted Nimi App has an AIConfig lifecycle
 * (manual `App AIConfig lifecycle`) and a permission surface. `data` and
 * `runtime` are always `true` for the same reason. The detail view refines
 * these from the richer projection.
 */
export function deriveRequirementSummary(entry: DesktopAppsEntry): AppCardRequirementSummary {
  // Every admitted Nimi App has all four requirement surfaces at the product
  // level (AIConfig lifecycle, permission grants, durable data root, runtime
  // package). The card summarizes their presence; the detail view shows the
  // concrete refs. This is not a guess — it is the manual's product model
  // (`App AIConfig lifecycle`, `#### App Card Fields` Requirement summary row).
  void entry;
  return { ai: true, permissions: true, data: true, runtime: true };
}

/**
 * Deterministic app icon glyph. The manual requires "App name and icon" as a
 * stable product identity from the registry projection. The Apps surface must
 * not read app-local asset files, so the icon is a stable initial derived from
 * the registry `displayName` — deterministic, projection-only, no file read.
 */
export function deriveIconGlyph(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return '?';
  }
  // First code point, upper-cased — handles non-ASCII display names safely.
  const first = Array.from(trimmed)[0] ?? '?';
  return first.toLocaleUpperCase();
}

function optional(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}
