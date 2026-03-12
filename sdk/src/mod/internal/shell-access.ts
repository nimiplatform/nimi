import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import { getModSdkHost } from '../host.js';
import type {
  ModShellAuthState,
  ModShellBootstrapState,
  ModShellNavigationState,
  ModShellRuntimeFieldsState,
  ModShellStatusBannerState,
} from './host-types.js';

function requireShell() {
  const shell = getModSdkHost().shell;
  if (shell) {
    return shell;
  }
  throw createNimiError({
    message: 'mod SDK shell host is not ready',
    reasonCode: ReasonCode.SDK_MOD_HOST_MISSING,
    actionHint: 'ensure_mod_shell_host_initialized',
    source: 'sdk',
  });
}

export function useModSdkShellAuth(): ModShellAuthState {
  return requireShell().useAuth();
}

export function useModSdkShellBootstrap(): ModShellBootstrapState {
  return requireShell().useBootstrap();
}

export function useModSdkShellNavigation(): ModShellNavigationState {
  return requireShell().useNavigation();
}

export function useModSdkShellRuntimeFields(): ModShellRuntimeFieldsState {
  return requireShell().useRuntimeFields();
}

export function useModSdkShellStatusBanner(): ModShellStatusBannerState {
  return requireShell().useStatusBanner();
}
