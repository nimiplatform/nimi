import { useEffect, type MouseEvent } from 'react';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { logoutAndClearSession } from '@renderer/features/auth/logout';
import { useChatRealtimeSync } from '@renderer/features/realtime/use-chat-realtime-sync';
import { MainLayoutView } from './main-layout-view';

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

export function MainLayout() {
  const flags = getShellFeatureFlags();
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const user = useAppStore((state) => state.auth.user);
  const context = useUiExtensionContext({
    sidebarCollapsed: true,
  });
  useChatRealtimeSync();

  const displayName = String(user?.displayName || user?.handle || 'User');
  const userAvatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl : null;

  useEffect(() => {
    if (!flags.enableRuntimeTab && activeTab === 'runtime') {
      setActiveTab('chat');
      return;
    }
    if (!flags.enableMarketplaceTab && activeTab === 'marketplace') {
      setActiveTab('chat');
      return;
    }
    if (!flags.enableModUi && activeTab === 'mods') {
      setActiveTab('chat');
      return;
    }
    if (!flags.enableModUi && activeTab.startsWith('mod:')) {
      setActiveTab('chat');
    }
  }, [activeTab, flags, setActiveTab]);

  const onLogout = async () => {
    await logoutAndClearSession({
      clearAuthSession,
      setStatusBanner,
    });
  };

  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);

  const onNav = (tabId: string) => {
    if (tabId === 'profile') {
      setSelectedProfileId(null);
    }
    setActiveTab(tabId as AppTab);
  };

  const onTitlebarMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!flags.enableTitlebarDrag) return;
    if (event.button !== 0) return;
    if (event.detail > 1) return;
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-mod-tab-interactive="true"]')) return;
    void desktopBridge.startWindowDrag().catch(() => {
      // no-op
    });
  };

  return (
    <MainLayoutView
      activeTab={activeTab}
      displayName={displayName}
      userAvatarUrl={userAvatarUrl}
      context={context}
      onNav={onNav}
      onLogout={() => {
        void onLogout();
      }}
      onTitlebarMouseDown={onTitlebarMouseDown}
    />
  );
}
