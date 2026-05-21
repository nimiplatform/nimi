/**
 * Recovery copy mapping for the `Support` recovery sub-area (`D-SUP-007`).
 *
 * `D-SUP-007` requires recovery guidance to use the `P-COLD-001` typed
 * fail-closed state semantics with a copy floor — it must NOT show the raw
 * technical `ProductControlState` enum name as the primary user copy. This
 * module maps every typed state to an i18n copy key.
 */

import type { ProductControlState } from '@renderer/bridge';

/**
 * i18n key prefix for each `ProductControlState`. The recovery view renders
 * `${key}.title` and `${key}.body` from these. There is one entry per state —
 * the mapping is total, so a new typed state cannot silently degrade to a raw
 * enum name.
 */
export const RECOVERY_STATE_COPY_KEY: Record<ProductControlState, string> = {
  not_logged_in: 'Support.recoveryStateNotLoggedIn',
  config_missing: 'Support.recoveryStateConfigMissing',
  data_root_missing: 'Support.recoveryStateDataRootMissing',
  data_root_selected: 'Support.recoveryStateDataRootSelected',
  ai_environment_unconfigured: 'Support.recoveryStateAiEnvironmentUnconfigured',
  local_ai_profile_selected_assets_missing: 'Support.recoveryStateLocalAiAssetsMissing',
  local_ai_profile_selected_environment_not_ready: 'Support.recoveryStateLocalAiEnvironmentNotReady',
  local_ai_assets_downloaded_environment_not_ready: 'Support.recoveryStateLocalAiEnvironmentNotReady',
  local_ai_ready: 'Support.recoveryStateLocalAiReady',
  repair_required: 'Support.recoveryStateRepairRequired',
  blocked: 'Support.recoveryStateBlocked',
  ready_for_use: 'Support.recoveryStateReadyForUse',
};

/**
 * The product-control states that indicate a degraded / not-ready product.
 * Recovery routes the user toward repair / setup for these.
 */
const DEGRADED_STATES = new Set<ProductControlState>([
  'config_missing',
  'data_root_missing',
  'data_root_selected',
  'ai_environment_unconfigured',
  'local_ai_profile_selected_assets_missing',
  'local_ai_profile_selected_environment_not_ready',
  'local_ai_assets_downloaded_environment_not_ready',
  'repair_required',
  'blocked',
]);

export function isDegradedProductState(state: ProductControlState): boolean {
  return DEGRADED_STATES.has(state);
}

/** A repair-routed state (`repair_required` / `blocked`) needs the repair flow. */
export function isRepairRoutedState(state: ProductControlState): boolean {
  return state === 'repair_required' || state === 'blocked';
}
