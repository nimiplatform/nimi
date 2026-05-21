import React, { Suspense, lazy, useEffect, useState, type MouseEvent, type PropsWithChildren } from 'react';
import { useNavigate } from 'react-router-dom';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { logoutAndClearSession } from '@renderer/features/auth/logout';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  isDeveloperModeEnabled,
  isModUiEnabled,
  subscribeDeveloperMode,
} from '@renderer/features/developer/developer-mode';
import { MainLayoutView } from './main-layout-view';

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

let tabSwitchPending: { fromTab: string; toTab: string; startMs: number } | null = null;

const ChatRealtimeSyncHost = lazy(async () => {
  const mod = await import('@renderer/features/realtime/use-chat-realtime-sync');
  return {
    default: function ChatRealtimeSyncHostModule() {
      mod.useChatRealtimeSync();
      return null;
    },
  };
});

const ScenarioJobStatusHost = lazy(async () => {
  const mod = await import('@renderer/features/turns/scenario-job-status-host');
  return { default: mod.ScenarioJobStatusHost };
});

class NonCriticalStartupBoundary extends React.Component<PropsWithChildren, { hasError: boolean }> {
  constructor(props: PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    logRendererEvent({
      level: 'warn',
      area: 'shell',
      message: 'action:non-critical-startup-module-failed',
      details: {
        error: error.message || String(error),
      },
    });
  }

  override render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export function MainLayout() {
  const flags = getShellFeatureFlags();
  const navigate = useNavigate();
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const authStatus = useAppStore((state) => state.auth.status);
  const user = useAppStore((state) => state.auth.user);
  const context = useUiExtensionContext({
    sidebarCollapsed: true,
  });

  const displayName = String(user?.displayName || user?.handle || 'User');
  const userAvatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl : null;
  const userEmail = typeof user?.email === 'string' ? user.email : null;

  // D-DEV-004 / D-DEV-007: developer / internal surfaces (mods, mod workspace
  // tabs, Developer Tools) are reachable only behind admitted Developer Mode.
  // If the active tab is one of them and Developer Mode is off — or it never
  // turned on — fall back to chat so no developer surface stays reachable.
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(
    () => isDeveloperModeEnabled(),
  );
  useEffect(() => {
    return subscribeDeveloperMode((next) => {
      setDeveloperModeEnabled(next);
    });
  }, []);
  useEffect(() => {
    const modUiReachable = flags.enableModUi && isModUiEnabled() && developerModeEnabled;
    if (!modUiReachable && (activeTab === 'mods' || activeTab.startsWith('mod:'))) {
      setActiveTab('chat');
      return;
    }
    if (!developerModeEnabled && activeTab === 'developer-tools') {
      setActiveTab('chat');
    }
  }, [activeTab, authStatus, developerModeEnabled, flags, setActiveTab]);

  useEffect(() => {
    if (!tabSwitchPending || tabSwitchPending.toTab !== activeTab) return;
    const costMs = Number((performance.now() - tabSwitchPending.startMs).toFixed(2));
    logRendererEvent({
      level: 'info',
      area: 'shell',
      message: 'action:tab-switch:committed',
      costMs,
      details: { fromTab: tabSwitchPending.fromTab, toTab: tabSwitchPending.toTab },
    });
    tabSwitchPending = null;
  }, [activeTab]);

  const onLogout = async () => {
    await logoutAndClearSession({
      clearAuthSession,
    });
  };

  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);

  const onNav = (tabId: string) => {
    tabSwitchPending = { fromTab: activeTab, toTab: tabId, startMs: performance.now() };
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
    <>
      <MainLayoutView
        activeTab={activeTab}
        authStatus={authStatus}
        displayName={displayName}
        userAvatarUrl={userAvatarUrl}
        userEmail={userEmail}
        context={context}
        onNav={onNav}
        onLogout={() => {
          void onLogout();
        }}
        onLogin={() => {
          setActiveTab('chat');
          void navigate('/login', {
            state: { returnToChat: true },
          });
        }}
        onTitlebarMouseDown={onTitlebarMouseDown}
      />
      <NonCriticalStartupBoundary>
        <Suspense fallback={null}>
          <ChatRealtimeSyncHost />
          <ScenarioJobStatusHost />
        </Suspense>
      </NonCriticalStartupBoundary>
    </>
  );
}
