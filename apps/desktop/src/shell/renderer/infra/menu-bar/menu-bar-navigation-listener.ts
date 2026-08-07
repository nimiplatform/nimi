import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import {
  hasElectronInvoke,
  listenShell,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import {
  MENU_BAR_OPEN_TAB_EVENT,
  parseMenuBarOpenTabPayload,
} from '../../../shared/menu-bar-types.js';
import {
  loadRuntimeConfigStateV11,
  persistRuntimeConfigStateV11,
} from '../../features/runtime-config/runtime-config-storage-persist';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port';
import type { DesktopRendererRuntimeConfigNavigationPort } from '../../renderer/runtime-config-navigation-port.js';

type MenuBarNavigationPort = Pick<DesktopRendererLifecyclePort, 'setActiveTab'>;

export function connectMenuBarNavigation(
  port: MenuBarNavigationPort,
  runtimeConfigNavigation: DesktopRendererRuntimeConfigNavigationPort,
): () => void {
  const flags = getShellFeatureFlags();
  if (!flags.enableMenuBarShell || !hasElectronInvoke()) {
    return () => {};
  }

  let active = true;
  const unsubscribePromise = Promise.resolve(listenShell(MENU_BAR_OPEN_TAB_EVENT, (event) => {
    if (!active) return;
    try {
      const payload = parseMenuBarOpenTabPayload(event.payload);
      if (payload.tab === 'settings') {
        port.setActiveTab('settings');
        return;
      }
      const state = loadRuntimeConfigStateV11();
      // The menu-bar wire contract still emits the retired single "models"
      // page id (menu item "Local Models"); route it to the Local Models page.
      const page = payload.page === 'models' ? 'localModels' : payload.page;
      persistRuntimeConfigStateV11({
        ...state,
        activePage: page,
      });
      runtimeConfigNavigation.openPage(page);
      port.setActiveTab('runtime');
    } catch {
      logRendererEvent({
        level: 'warn',
        area: 'menu-bar',
        message: 'action:open-tab-payload-rejected',
        details: { event: MENU_BAR_OPEN_TAB_EVENT },
      });
    }
  }));
  void unsubscribePromise.catch(() => {
    if (!active) return;
    logRendererEvent({
      level: 'warn',
      area: 'menu-bar',
      message: 'phase:navigation-listener-unavailable',
      details: { event: MENU_BAR_OPEN_TAB_EVENT },
    });
  });

  return () => {
    active = false;
    void unsubscribePromise.then((unsubscribe) => {
      unsubscribe();
    }, () => undefined);
  };
}
