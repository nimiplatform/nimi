import type { NimiDesktopOpenIntent } from '@nimiplatform/kit/core/desktop-open';
import type { AppStoreState } from '@renderer/app-shell/providers/app-store';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import {
  loadRuntimeConfigStateV11,
  persistRuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-storage-persist';
import {
  dispatchRuntimeConfigActionFocus,
  dispatchRuntimeConfigOpenPage,
} from '@renderer/features/runtime-config/runtime-config-navigation-events';
import { dispatchSettingsOpenSection } from '@renderer/features/settings/settings-storage';

type DesktopOpenIntentStore = Pick<AppStoreState,
  | 'setActiveTab'
  | 'setExploreActiveSection'
  | 'setExploreSearchText'
  | 'setAppsDetailAppId'
>;

export function applyDesktopOpenIntentToAppStore(
  intent: NimiDesktopOpenIntent,
  store: DesktopOpenIntentStore = useAppStore.getState(),
): void {
  switch (intent.kind) {
    case 'open-explore': {
      store.setExploreActiveSection(intent.section);
      store.setExploreSearchText(intent.query ?? '');
      store.setActiveTab('explore');
      return;
    }
    case 'open-runtime-config': {
      const state = loadRuntimeConfigStateV11();
      const actionFocus = runtimeConfigActionFocusForIntent(intent);
      persistRuntimeConfigStateV11({
        ...state,
        activePage: intent.page,
        actionFocus,
      });
      dispatchRuntimeConfigOpenPage(intent.page);
      if (actionFocus) {
        dispatchRuntimeConfigActionFocus(actionFocus);
      }
      store.setActiveTab('runtime');
      return;
    }
    case 'open-agents': {
      store.setActiveTab('agents');
      return;
    }
    case 'open-apps': {
      store.setAppsDetailAppId(intent.appId ?? null);
      store.setActiveTab('apps');
      return;
    }
    case 'open-settings': {
      dispatchSettingsOpenSection(intent.section);
      store.setActiveTab('settings');
      return;
    }
  }
}

function runtimeConfigActionFocusForIntent(
  intent: Extract<NimiDesktopOpenIntent, { kind: 'open-runtime-config' }>,
) {
  if (intent.page === 'cloud' && intent.action === 'add-connector') {
    return {
      page: 'cloud',
      action: 'add-connector',
      focus: 'runtime-config-action-focus.cloud-connector-draft',
    } as const;
  }
  if (intent.page === 'models' && intent.action === 'install-model') {
    return {
      page: 'models',
      action: 'install-model',
      focus: 'runtime-config-action-focus.models-catalog-install',
    } as const;
  }
  return null;
}
