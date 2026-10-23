import { useHomeNavigation, useHomeDestination } from '../providers/app-store.js';
import { GlobalDownloadsProvider } from '../../features/runtime-config/global-downloads-context.js';
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, useAppStoreApi, type AppTab } from '../providers/app-store';
import {
  logoutAndClearSession,
  switchAccountAndClearSession,
  useLogoutSessionDependencies,
} from '../../features/auth/logout';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import { MainLayoutView } from './main-layout-view';
import { AppsDownloadsProvider } from '../../features/apps/apps-downloads-context.js';
import { SystemEntryProvider } from '../../features/system-entry/system-entry-provider.js';
import { useHomeExecutionNotificationControls } from '../../features/home/execution-notices.js';

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
  const navigation = useHomeNavigation();
  const notifications = useHomeExecutionNotificationControls();
  const [homeVisible, setHomeVisible] = useState(true);
  const reading = useMemo(() => {
    const open = async (homeSection: 'usage' | 'work'): Promise<void> => {
      const result = await navigation.push({ id: 'home', homeSection });
      if (result.status !== 'committed' && result.status !== 'unchanged') throw new Error('system-entry-navigation-rejected');
    };
    return { openUsage: () => open('usage'), openCurrentWork: () => open('work') };
  }, [navigation]);
  const navigate = useNavigate();
  const bindings = useDesktopRendererBindings();
  const appStore = useAppStoreApi();
  const activeTab = useHomeDestination().id;

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
    bindings.surfaceLifecycle.reportReadyCandidate();
  }, [bindings]);

  useEffect(
    () => bindings.app.events.connectDesktopOpenIntents(appStore.navigation),
    [appStore, bindings],
  );

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

  const onNav = (tabId: string) => {
    tabSwitchPending.current = { fromTab: activeTab, toTab: tabId, startMs: bindings.clock.now() };
    navigation.push({ id: tabId as AppTab });
  };

  return (
    <AppsDownloadsProvider nativeVisible={homeVisible}>
      <GlobalDownloadsProvider nativeVisible={homeVisible}>
        <SystemEntryProvider notifications={notifications} reading={reading} onHomeVisibility={setHomeVisible}>
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
          navigation.push({ id: 'chat' });
          void navigate('/login', {
            state: { returnToChat: true },
          });
        }}
      />
      <NonCriticalStartupBoundary>
        <Suspense fallback={null}>
          <ChatRealtimeSyncHost />
          <ScenarioJobStatusHost />
        </Suspense>
      </NonCriticalStartupBoundary>
      </SystemEntryProvider>
    </GlobalDownloadsProvider>
    </AppsDownloadsProvider>
  );
}
