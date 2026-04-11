import type { UiExtensionContext } from '@desktop-public/mod-ui-types';

type UseUiExtensionContextOptions = {
  sidebarCollapsed?: boolean;
};

const noopSetActiveTab: UiExtensionContext['setActiveTab'] = () => {
  // no-op in web shell
};
const noopOpenModTab: UiExtensionContext['openModTab'] = () => {
  // no-op in web shell
};
const noopCloseModTab: UiExtensionContext['closeModTab'] = () => {
  // no-op in web shell
};
const noopIsModTabOpen: UiExtensionContext['isModTabOpen'] = () => false;
const noopIsModTabRetained: UiExtensionContext['isModTabRetained'] = () => false;
const noopGetModLifecycleState: UiExtensionContext['getModLifecycleState'] = () => 'active';
const noopMarkModFused: UiExtensionContext['markModFused'] = () => {
  // no-op in web shell
};
const noopClearModFuse: UiExtensionContext['clearModFuse'] = () => {
  // no-op in web shell
};
const noopSetRuntimeFields: UiExtensionContext['setRuntimeFields'] = () => {
  // no-op in web shell
};

const WEB_EXTENSION_CONTEXT: UiExtensionContext = {
  isAuthenticated: false,
  activeTab: 'chat',
  setActiveTab: noopSetActiveTab,
  openModTab: noopOpenModTab,
  closeModTab: noopCloseModTab,
  isModTabOpen: noopIsModTabOpen,
  isModTabRetained: noopIsModTabRetained,
  getModLifecycleState: noopGetModLifecycleState,
  markModFused: noopMarkModFused,
  clearModFuse: noopClearModFuse,
  isModFused: () => false,
  shellUi: {
    sidebarCollapsed: false,
  },
  runtimeFields: {},
  setRuntimeFields: noopSetRuntimeFields,
};

export function useUiExtensionContext(
  options: UseUiExtensionContextOptions = {},
): UiExtensionContext {
  if (options.sidebarCollapsed === undefined) {
    return WEB_EXTENSION_CONTEXT;
  }

  return {
    ...WEB_EXTENSION_CONTEXT,
    shellUi: {
      ...WEB_EXTENSION_CONTEXT.shellUi,
      sidebarCollapsed: Boolean(options.sidebarCollapsed),
    },
  };
}
