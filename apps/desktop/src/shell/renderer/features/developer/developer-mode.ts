/**
 * Developer Mode gating resolver (`D-DEV-002`, `D-DEV-007`).
 *
 * Developer Mode is the single discoverable switch that controls every
 * developer / internal surface: the `Developer Tools` tab, the embedded
 * Tester, and the mod UI surfaces. Per `D-DEV-002` it MUST be reachable from a
 * discoverable in-app location (canonically `Settings`) and MUST NOT be
 * reachable only through launch parameters or environment variables.
 *
 * The developer-surface feature flags `enableDeveloperTools` and `enableModUi`
 * are NOT static build flags — their effective runtime value is derived from
 * the admitted Developer Mode preference. `D-DEV-007` requires every developer
 * surface to default to invisible / unreachable; that default is satisfied
 * because Developer Mode defaults to `false` (`settings-storage.ts`).
 *
 * This module is the one place the renderer consults to answer "is this
 * developer surface reachable?". It never invents product truth — it only
 * reads the admitted `developerMode` preference.
 */

import {
  loadStoredPerformancePreferences,
  subscribeStoredPerformancePreferences,
} from '@renderer/features/settings/settings-storage';

/**
 * The admitted Developer Mode state. `true` only when the user has explicitly
 * enabled Developer Mode from the discoverable Settings toggle.
 */
export function isDeveloperModeEnabled(): boolean {
  return loadStoredPerformancePreferences().developerMode === true;
}

/**
 * `enableDeveloperTools` (`D-DEV-001`) — the `Developer Tools` developer-group
 * surface is reachable only behind admitted Developer Mode. There is no
 * separate persisted flag: the surface gate IS Developer Mode.
 */
export function isDeveloperToolsEnabled(): boolean {
  return isDeveloperModeEnabled();
}

/**
 * `enableModUi` (`D-DEV-004`) — mod UI surfaces (`mods` tab, Mod Hub, mod
 * workspace tabs, settings extension area) are reachable only behind admitted
 * Developer Mode. The `feature-flags.yaml` desktop default for `enableModUi`
 * is `false`; Developer Mode is the discoverable switch that flips it on.
 */
export function isModUiEnabled(): boolean {
  return isDeveloperModeEnabled();
}

/**
 * Subscribe to Developer Mode changes. The callback fires whenever the user
 * toggles Developer Mode from the discoverable Settings entry, so gated
 * surfaces can react immediately without a reload.
 */
export function subscribeDeveloperMode(onChange: (enabled: boolean) => void): () => void {
  return subscribeStoredPerformancePreferences((prefs) => {
    onChange(prefs.developerMode === true);
  });
}

/**
 * Persist a Developer Mode change. The actual write goes through the canonical
 * performance-preferences store so a single source of truth is preserved;
 * callers use this from the discoverable toggle.
 */
export { loadStoredPerformancePreferences, persistStoredPerformancePreferences } from '@renderer/features/settings/settings-storage';
