import type {
  ModShellAuthState,
  ModShellBootstrapState,
  ModShellNavigationState,
  ModShellRuntimeFieldsState,
  ModShellStatusBannerInput,
  ModShellStatusBannerState,
} from './internal/host-types.js';
import { createNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';
import { getModSdkHost } from './host.js';

export type {
  ModShellAuthState,
  ModShellBootstrapState,
  ModShellNavigationState,
  ModShellRuntimeFieldsState,
  ModShellStatusBannerInput,
  ModShellStatusBannerState,
};

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

export function useShellAuth(): ModShellAuthState {
  return requireShell().useAuth();
}

export function useShellBootstrap(): ModShellBootstrapState {
  return requireShell().useBootstrap();
}

export function useShellNavigation(): ModShellNavigationState {
  return requireShell().useNavigation();
}

export function useShellRuntimeFields(): ModShellRuntimeFieldsState {
  return requireShell().useRuntimeFields();
}

export function useShellStatusBanner(): ModShellStatusBannerState {
  return requireShell().useStatusBanner();
}
