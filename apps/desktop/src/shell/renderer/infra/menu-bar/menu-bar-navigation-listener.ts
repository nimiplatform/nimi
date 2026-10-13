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
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port';
import type { DesktopRendererRuntimeConfigNavigationPort } from '../../renderer/runtime-config-navigation-port.js';

type MenuBarNavigationPort = Pick<DesktopRendererLifecyclePort, 'navigation'>;

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
      if (payload.tab !== 'runtime') {
        void port.navigation.push({ id: payload.tab });
        return;
      }
      const page = payload.page;
      runtimeConfigNavigation.openPage(page);
    } catch {
      logRendererEvent({
        level: 'warn',
        area: 'menu-bar',
        message: 'action:open-tab-payload-rejected',
        details: { event: MENU_BAR_OPEN_TAB_EVENT },
      });
    }
  }),
  );
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
