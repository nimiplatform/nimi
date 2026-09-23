import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import type { NimiElectronHostCommandPolicy } from '@nimiplatform/kit/shell/electron/main';

// Setup/repair stays usable while a Home profile is bootstrap or awaiting a
// relaunch. This is product availability, not an OS sandbox or new permission.
const REPAIR_COMMANDS: ReadonlySet<string> = new Set([
  'desktop_home_profile_status_get', 'desktop_home_profile_retry',
  'runtime_account_session_status', 'runtime_account_session_events_open',
  'runtime_account_session_events_close', 'runtime_account_begin_login',
  'runtime_account_complete_login', 'runtime_account_logout', 'runtime_account_switch_account',
  'get_system_resource_snapshot', 'desktop_logs_export', 'log_renderer_event',
  'desktop_open_intent_set_ready', 'menu_bar_runtime_health_sync',
  'nimi_data_cleanup_plan',
  NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status'],
  NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.start'],
  NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart'],
  NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get'],
  NIMI_STANDARD_SHELL_COMMANDS['runtime.streamClose'],
  NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe'],
  NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
  NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl'],
  NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode'],
  NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog'],
  NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag'],
  NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow'],
]);
const REPAIR_RUNTIME_METHODS: ReadonlySet<string> = new Set([
  '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
  '/nimi.runtime.v1.RuntimeAuditService/ListDesktopAuditEvents',
  '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents',
]);

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-017a
export function createDesktopHomeCommandPolicy(normalWorkAllowed: () => boolean): NimiElectronHostCommandPolicy {
  return (input) => {
    if (normalWorkAllowed() || input.command.startsWith('product_control_')
      || REPAIR_COMMANDS.has(input.command) || input.runtimeCancellation
      || (input.runtimeMethodId && REPAIR_RUNTIME_METHODS.has(input.runtimeMethodId))
      // Account display needed by login/setup; other Realm work stays closed.
      || (input.command === 'runtime_account_invoke_realm_unary' && input.realmMethodId === 'getMe')) {
      return { allow: true };
    }
    return {
      allow: false,
      reasonCode: 'desktop-home-profile-repair-required',
      actionHint: 'repair_home_profile_then_restart',
    };
  };
}
