import type { NimiDesktopOpenIntent } from '@nimiplatform/kit/core/desktop-open';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { RuntimePageIdV11 } from '../../features/runtime-config/runtime-config-state-types';
import type { DesktopRendererRuntimeConfigNavigationPort } from '../../renderer/runtime-config-navigation-port.js';

export type DesktopOpenIntentStore = HomeNavigation;

// @nimi-authority: rule.nimi.platform.core-protocol.p-dopen-003
export function applyDesktopOpenIntentToAppStore(
  intent: NimiDesktopOpenIntent,
  input: {
    readonly store: DesktopOpenIntentStore;
    readonly runtimeConfigNavigation: DesktopRendererRuntimeConfigNavigationPort;
  },
): void {
  const { runtimeConfigNavigation, store } = input;
  switch (intent.kind) {
    case 'open-explore': {
      void store.push({ id: 'explore', exploreSection: intent.section, search: intent.query ?? '' });
      return;
    }
    case 'open-runtime-config': {
      const actionFocus = runtimeConfigActionFocusForIntent(intent);
      const page = resolveRuntimePageForIntent(intent);
      if (actionFocus) {
        runtimeConfigNavigation.focusAction(actionFocus);
      } else runtimeConfigNavigation.openPage(page);
      return;
    }
    case 'open-apps': {
      void store.push({ id: 'apps', ...(intent.appId ? { appId: intent.appId, appSection: intent.section } : {}) });
      return;
    }
    case 'open-settings': {
      void store.push({ id: 'settings', settingsSection: intent.section });
      return;
    }
    case 'open-integrations': {
      void store.push({ id: 'home', homeSection: 'integrations' });
      return;
    }
  }
}

function resolveRuntimePageForIntent(
  intent: Extract<NimiDesktopOpenIntent, { kind: 'open-runtime-config' }>,
): RuntimePageIdV11 {
  // Model discovery and acquisition live in the Model Library destination.
  if (intent.page === 'models') {
    return 'modelLibrary';
  }
  return 'cloudServices';
}

function runtimeConfigActionFocusForIntent(
  intent: Extract<NimiDesktopOpenIntent, { kind: 'open-runtime-config' }>,
) {
  if (intent.page === 'cloud' && intent.action === 'add-connector') {
    return {
      page: 'cloudServices',
      action: 'add-connector',
      focus: 'runtime-config-action-focus.cloud-connector-draft',
    } as const;
  }
  // The install-model intent focuses the Model Library discovery surface, the
  // single acquisition entry.
  if (intent.page === 'models' && intent.action === 'install-model') {
    return {
      page: 'modelLibrary',
      action: 'install-model',
      focus: 'runtime-config-action-focus.model-library-install',
    } as const;
  }
  return null;
}
