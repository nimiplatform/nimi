import type { ReactNode } from 'react';

export type UiSlotId =
  | 'auth.login.form.footer'
  | 'chat.sidebar.header'
  | 'chat.chat.list.item.trailing'
  | 'chat.turn.input.toolbar'
  | 'settings.panel.section'
  | 'ui-extension.app.sidebar.mods'
  | 'ui-extension.app.content.routes'
  | 'ui-extension.runtime.devtools.panel';

export type UiExtensionStrategy = 'replace' | 'wrap' | 'append' | 'hide';

export type ModLifecycleState =
  | 'active'
  | 'background-throttled'
  | 'frozen'
  | 'discarded';

export type UiExtensionContext = {
  isAuthenticated: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  openModTab: (tabId: `mod:${string}`, modId: string, title: string) => void;
  closeModTab: (tabId: `mod:${string}`) => void;
  isModTabOpen: (tabId: `mod:${string}`) => boolean;
  isModTabInLru: (tabId: `mod:${string}`) => boolean;
  getModLifecycleState: (tabId: `mod:${string}`) => ModLifecycleState;
  markModFused: (modId: string, error: string, reason?: string) => void;
  clearModFuse: (modId: string) => void;
  isModFused: (modId: string) => boolean;
  shellUi?: {
    sidebarCollapsed?: boolean;
  };
  runtimeFields: Record<string, string | number | boolean>;
  setRuntimeFields: (fields: Record<string, string | number | boolean>) => void;
};

export type UiExtensionRenderContext = {
  extensionId: string;
  modId: string;
  slot: UiSlotId;
  context: UiExtensionContext;
  base: ReactNode;
};

export type UiExtensionRegistration = {
  extensionId: string;
  modId: string;
  slot: UiSlotId;
  priority: number;
  strategy: UiExtensionStrategy;
  render: (input: UiExtensionRenderContext) => ReactNode;
};

export type UiSlotResolution = {
  hide: boolean;
  replace: UiExtensionRegistration[];
  wrap: UiExtensionRegistration[];
  append: UiExtensionRegistration[];
  conflicts: Array<{
    strategy: UiExtensionStrategy;
    priority: number;
    extensionIds: string[];
  }>;
};
