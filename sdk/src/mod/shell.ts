import type {
  ModShellAuthState,
  ModShellBootstrapState,
  ModShellNavigationState,
  ModShellRuntimeFieldsState,
  ModShellStatusBannerInput,
  ModShellStatusBannerState,
} from './internal/host-types.js';
import {
  useModSdkShellAuth,
  useModSdkShellBootstrap,
  useModSdkShellNavigation,
  useModSdkShellRuntimeFields,
  useModSdkShellStatusBanner,
} from './internal/shell-access.js';

export type {
  ModShellAuthState,
  ModShellBootstrapState,
  ModShellNavigationState,
  ModShellRuntimeFieldsState,
  ModShellStatusBannerInput,
  ModShellStatusBannerState,
};

export function useShellAuth(): ModShellAuthState {
  return useModSdkShellAuth();
}

export function useShellBootstrap(): ModShellBootstrapState {
  return useModSdkShellBootstrap();
}

export function useShellNavigation(): ModShellNavigationState {
  return useModSdkShellNavigation();
}

export function useShellRuntimeFields(): ModShellRuntimeFieldsState {
  return useModSdkShellRuntimeFields();
}

export function useShellStatusBanner(): ModShellStatusBannerState {
  return useModSdkShellStatusBanner();
}
