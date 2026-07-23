import React, { Suspense, lazy, useEffect, useRef, useState, type MouseEvent, type PropsWithChildren } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, type AppTab } from '../providers/app-store';
import {
  logoutAndClearSession,
  switchAccountAndClearSession,
  useLogoutSessionDependencies,
} from '../../features/auth/logout';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import { MainLayoutView } from './main-layout-view';

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

const ChatRealtimeSyncHost = lazy(async () => {
  const mod = await import('../../features/realtime/use-chat-realtime-sync');
  return {
    default: function ChatRealtimeSyncHostModule() {
      mod.useChatRealtimeSync();
      return null;
    },
  };
});

const ScenarioJobStatusHost = lazy(async () => {
  const mod = await import('../../features/turns/scenario-job-status-host');
  return { default: mod.ScenarioJobStatusHost };
});

class NonCriticalStartupBoundary extends React.Component<PropsWithChildren, { hasError: boolean }> {
  constructor(props: PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  override componentDidCatch(error: Error): void {
    this.setState({ hasError: true });
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
  const navigate = useNavigate();
  const bindings = useDesktopRendererBindings();
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const logoutDependencies = useLogoutSessionDependencies();
  const authStatus = useAppStore((state) => state.auth.status);
  const user = useAppStore((state) => state.auth.user);
  const tabSwitchPending = useRef<{
    fromTab: string;
    toTab: string;
    startMs: number;
  } | null>(null);

  const displayName = String(user?.displayName || user?.handle || 'User');
  const userAvatarUrl = typeof user?.avatarUrl === 'string' ? user.avatarUrl : null;
  const userEmail = typeof user?.email === 'string' ? user.email : null;

  useEffect(() => {
    bindings.surfaceLifecycle.reportReadyCandidate({ contractId: 'desktop.main.usable' });
  }, [bindings]);

  const [developerModeEnabled, setDeveloperModeEnabled] = useState(
    () => bindings.app.projection.developerModeEnabled(),
  );
  useEffect(() => bindings.app.events.connectDesktopOpenIntents(), [bindings]);
  useEffect(() => {
    return bindings.app.events.subscribeDeveloperMode((next) => {
      setDeveloperModeEnabled(next);
    });
  }, [bindings]);
  useEffect(() => {
    if (!developerModeEnabled && activeTab === 'developer-tools') {
      setActiveTab('chat');
    }
  }, [activeTab, authStatus, developerModeEnabled, setActiveTab]);

  useEffect(() => {
    const pending = tabSwitchPending.current;
    if (!pending || pending.toTab !== activeTab) return;
    const costMs = Number((bindings.clock.now() - pending.startMs).toFixed(2));
    logRendererEvent({
      level: 'info',
      area: 'shell',
      message: 'action:tab-switch:committed',
      costMs,
      details: { fromTab: pending.fromTab, toTab: pending.toTab },
    });
    tabSwitchPending.current = null;
  }, [activeTab]);

  const onLogout = async () => {
    await logoutAndClearSession(
      { clearAuthSession, onFeedback: logoutDependencies.feedback },
      logoutDependencies.logout,
    );
  };

  const onSwitchAccount = async () => {
    const switched = await switchAccountAndClearSession(
      { clearAuthSession, onFeedback: logoutDependencies.feedback },
      logoutDependencies.switchAccount,
    );
    if (!switched) {
      return;
    }
    await navigate('/login', {
      state: { returnToChat: true, accountSwitch: true },
    });
  };

  const setSelectedProfileId = useAppStore((state) => state.setSelectedProfileId);

  const onNav = (tabId: string) => {
    tabSwitchPending.current = { fromTab: activeTab, toTab: tabId, startMs: bindings.clock.now() };
    if (tabId === 'profile') {
      setSelectedProfileId(null);
    }
    setActiveTab(tabId as AppTab);
  };

  const onTitlebarMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!bindings.app.projection.titlebarDragEnabled()) return;
    if (event.button !== 0) return;
    if (event.detail > 1) return;
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-titlebar-interactive="true"]')) return;
    void bindings.app.commands.startWindowDrag().catch(() => {
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
        onNav={onNav}
        onSwitchAccount={() => {
          void onSwitchAccount();
        }}
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
