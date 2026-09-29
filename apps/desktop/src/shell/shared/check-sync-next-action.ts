// Runtime owns the Check & Sync next-action vocabulary
// (runtime/internal/engine CheckSyncNextActions). Home projects exactly this
// closed set; any other value keeps the projection fail-closed.
export const CHECK_SYNC_NEXT_ACTIONS = ['rerun_check_sync', 'run_local_model_offline_conversion'] as const;

export type CheckSyncNextAction = (typeof CHECK_SYNC_NEXT_ACTIONS)[number];

// Only rerun is an executable owner action in Home. Offline model conversion is
// maintenance outside the product for a restricted model domain, never a button
// or a composed command.
export function isExecutableCheckSyncNextAction(action: CheckSyncNextAction): action is 'rerun_check_sync' {
  return action === 'rerun_check_sync';
}
