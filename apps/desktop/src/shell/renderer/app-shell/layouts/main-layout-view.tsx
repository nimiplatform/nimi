import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import logoImage from '../../assets/logo.svg';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { AmbientBackground, ScrollArea } from '@nimiplatform/kit/ui';
import { StatusBanner } from '@renderer/ui/feedback/status-banner';
import {
  notificationQueryKeys,
  resolveNotificationIdentityRef,
} from '@renderer/features/notification/notification-query.js';
import type { PostFeedScope } from '@runtime/data-sync';
import { DEFAULT_HOME_FEED_SCOPE } from '@renderer/features/home/home-feed-controls';
import type { ExploreSectionId } from '@renderer/features/explore/explore-section-nav';
import {
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from '@renderer/features/settings/settings-storage';
import {
  isDeveloperModeEnabled,
  subscribeDeveloperMode,
} from '@renderer/features/developer/developer-mode';
import { loadWorldDetailPanelModule, WorldDetailRouteLoading } from '@renderer/features/world/world-detail-route-state';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { DesktopReleaseStrip } from './desktop-release-strip';
import { MainLayoutTopBar } from './main-layout-topbar';
import { MainLayoutSettingsMenu, type SettingsSubmenuItemId } from './main-layout-settings-menu';
import { MainLayoutTitlebarContent } from './main-layout-titlebar-content';
import { SidebarTooltipButton } from './main-layout-sidebar-tooltip-button';
import { OfflineShellStrip } from './offline-shell-strip';
import {
  SHELL_CHROME_INTERACTIVE_RADIUS_CLASS,
} from './shell-chrome-classes';
import {
  getCoreNavItems,
  getQuickNavItems,
  NavLink,
} from './navigation-config';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

const ChatPage = lazy(async () => {
  const mod = await import('@renderer/features/chat/chat-page');
  return { default: mod.ChatPage };
});
const ExplorePanel = lazy(async () => {
  const mod = await import('@renderer/features/explore/explore-panel');
  return { default: mod.ExplorePanel };
});
const AppsPanel = lazy(async () => {
  const mod = await import('@renderer/features/apps/apps-panel');
  return { default: mod.AppsPanel };
});
const SettingsPanelBody = lazy(async () => {
  const mod = await import('@renderer/features/settings/settings-panel-body');
  return { default: mod.SettingsPanelBody };
});
const SupportPanel = lazy(async () => {
  const mod = await import('@renderer/features/support/support-panel');
  return { default: mod.SupportPanel };
});
const RuntimeConfigPanelBody = lazy(async () => {
  const mod = await import('@renderer/features/runtime-config/runtime-config-panel-view');
  return { default: mod.RuntimeConfigPanelBody };
});
const NotificationPanel = lazy(async () => {
  const mod = await import('@renderer/features/notification/notification-panel');
  return { default: mod.NotificationPanel };
});
const GiftInboxPanel = lazy(async () => {
  const mod = await import('@renderer/features/economy/gift-inbox-panel');
  return { default: mod.GiftInboxPanel };
});
const ProfilePanel = lazy(async () => {
  const mod = await import('@renderer/features/profile/profile-panel');
  return { default: mod.ProfilePanel };
});
const AgentDetailPanel = lazy(async () => {
  const mod = await import('@renderer/features/agent-detail/agent-detail-panel');
  return { default: mod.AgentDetailPanel };
});
const WorldDetailPanel = lazy(async () => {
  const mod = await loadWorldDetailPanelModule();
  return { default: mod.WorldDetailActivePanel };
});
const HomePanel = lazy(async () => {
  const mod = await import('@renderer/features/home/home-panel');
  return { default: mod.HomePanel };
});
const DeveloperToolsPanel = lazy(async () => {
  const mod = await import('@renderer/features/developer/developer-tools-panel');
  return { default: mod.DeveloperToolsPanel };
});
const PrivacyPolicyView = lazy(async () => {
  const mod = await import('@renderer/features/legal/privacy-policy-view');
  return { default: mod.PrivacyPolicyView };
});
const TermsOfServiceView = lazy(async () => {
  const mod = await import('@renderer/features/legal/terms-of-service-view');
  return { default: mod.TermsOfServiceView };
});
function parseBalanceValue(input: unknown): number {
  const raw = typeof input === 'string' ? Number(input) : (typeof input === 'number' ? input : 0);
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return raw;
}

/** Track window focus so polling queries can pause when the app is not focused. */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => typeof document !== 'undefined' && document.hasFocus());
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return focused;
}

function parseUnreadCount(input: unknown): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.max(0, Math.floor(input));
  }
  if (input && typeof input === 'object') {
    const payload = input as Record<string, unknown>;
    const candidates = [
      payload.unreadCount,
      payload.count,
      payload.total,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return Math.max(0, Math.floor(candidate));
      }
      if (typeof candidate === 'string' && candidate.trim()) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return Math.max(0, Math.floor(parsed));
        }
      }
    }
  }
  return 0;
}

type MainLayoutViewProps = {
  activeTab: AppTab;
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  displayName: string;
  userAvatarUrl: string | null;
  userEmail?: string | null;
  onNav: (tabId: string) => void;
  onLogout: () => void;
  onLogin: () => void;
  onTitlebarMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

export function MainLayoutView(props: MainLayoutViewProps) {
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const profileDetailOverlayOpen = useAppStore((state) => state.profileDetailOverlayOpen);
  const authUser = useAppStore((state) => state.auth.user);
  const isAnonymousShell = props.authStatus !== 'authenticated';
  const notificationIdentityRef = useMemo(
    () => resolveNotificationIdentityRef(props.authStatus, authUser),
    [props.authStatus, authUser],
  );
  const notificationQueryIdentityRef = notificationIdentityRef ?? 'missing-auth-identity';
  const coreNavItems = getCoreNavItems();
  const quickNavItems = getQuickNavItems();
  const primaryCoreNavItems = coreNavItems.filter((item) => item.id !== 'home');
  // D-DEV-002 / D-DEV-007: Developer Mode is the single discoverable switch
  // for developer / internal surfaces. It is tracked reactively so the gated
  // surfaces appear / disappear immediately when the user flips it from
  // Settings.
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(
    () => isDeveloperModeEnabled(),
  );
  useEffect(() => {
    return subscribeDeveloperMode((next) => {
      setDeveloperModeEnabled(next);
    });
  }, []);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [collapsedSettingsMenuPosition, setCollapsedSettingsMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const settingsTriggerRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const sidebarWidthClass = 'w-[60px]';
  const titlebarLeftInsetClass = flags.enableTitlebarDrag ? 'pl-[92px]' : 'pl-3';
  const [exploreActiveSection, setExploreActiveSection] = useState<ExploreSectionId>('worlds');
  const [exploreSearchText, setExploreSearchText] = useState('');
  const [homeFeedScope, setHomeFeedScope] = useState(DEFAULT_HOME_FEED_SCOPE);
  const [homeCreatePostRequestKey, setHomeCreatePostRequestKey] = useState(0);

  // Keep-alive: once the runtime tab is visited, keep the component mounted (display:none
  // when inactive) so that subsequent visits are instant — no re-init, no re-hydration.
  const runtimeActive = props.activeTab === 'runtime';
  const runtimeEverMountedRef = useRef(false);
  if (runtimeActive) runtimeEverMountedRef.current = true;
  const runtimeEverMounted = runtimeEverMountedRef.current;

  const immersiveRoute = props.activeTab === 'agent-detail'
    || props.activeTab === 'gift-inbox';
  const hidePrimaryRail = immersiveRoute
    || (props.activeTab === 'profile' && Boolean(selectedProfileId))
    || profileDetailOverlayOpen;
  const windowFocused = useWindowFocused();
  const balancesQuery = useQuery({
    queryKey: ['topbar-currency-balances'],
    queryFn: async () => {
      const { dataSync } = await import('@runtime/data-sync');
      return dataSync.loadCurrencyBalances() as Promise<Record<string, unknown>>;
    },
    enabled: props.authStatus === 'authenticated',
    staleTime: 30_000,
    refetchInterval: windowFocused ? 60_000 : false,
  });
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.topbarUnreadCount(notificationQueryIdentityRef),
    queryFn: async () => {
      const { dataSync } = await import('@runtime/data-sync');
      return dataSync.loadNotificationUnreadCount();
    },
    enabled: props.authStatus === 'authenticated' && Boolean(notificationIdentityRef),
    staleTime: 15_000,
    refetchInterval: windowFocused ? 30_000 : false,
  });

  const sparkBalance = parseBalanceValue((balancesQuery.data as Record<string, unknown> | undefined)?.sparkBalance);
  const gemBalance = parseBalanceValue((balancesQuery.data as Record<string, unknown> | undefined)?.gemBalance);
  const unreadCount = parseUnreadCount(unreadCountQuery.data);

  useEffect(() => {
    if (!settingsMenuOpen) {
      return;
    }
    const onMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (settingsTriggerRef.current?.contains(target)) {
        return;
      }
      if (settingsMenuRef.current?.contains(target)) {
        return;
      }
      setSettingsMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsMenuOpen]);

  useEffect(() => {
    setSettingsMenuOpen(false);
  }, [props.activeTab]);

  useEffect(() => {
    if (!settingsMenuOpen) {
      return;
    }
    const updatePosition = () => {
      const rect = settingsTriggerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const menuWidth = 256; // w-64 = 16rem = 256px
      const menuMaxHeight = Math.min(480, window.innerHeight - 100);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      // Horizontal positioning
      const clampedLeft = Math.min(
        Math.max(12, rect.right - menuWidth),
        Math.max(12, viewportWidth - menuWidth - 12),
      );
      // Vertical positioning - check if there's enough space below
      const spaceBelow = viewportHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;

      let top: number;
      if (spaceBelow >= menuMaxHeight || spaceBelow >= spaceAbove) {
        // Show below if there's enough space or more space than above
        top = Math.max(12, Math.min(rect.bottom + 6, viewportHeight - menuMaxHeight - 12));
      } else {
        // Show above when there's not enough space below
        top = Math.max(12, rect.top - menuMaxHeight - 6);
      }
      setCollapsedSettingsMenuPosition({
        top,
        left: clampedLeft,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [settingsMenuOpen]);

  const avatarNode = (
    <EntityAvatar
      imageUrl={props.userAvatarUrl}
      name={props.displayName}
      kind="human"
      sizeClassName="h-9 w-9"
      className="shrink-0"
      textClassName="text-xs"
    />
  );
  const nimiHomeNode = (
    <img
      src={logoImage}
      alt="Nimi"
      className="h-9 w-9 shrink-0 object-cover"
      style={{ mixBlendMode: 'multiply' }}
    />
  );
  const currentSettingsSelection = props.activeTab === 'settings'
    ? loadStoredSettingsSelected('profile')
    : '';

  const isSettingsMenuItemActive = (itemId: SettingsSubmenuItemId): boolean => {
    if (itemId === 'profile') {
      return props.activeTab === 'profile';
    }
    if (itemId === 'wallet') {
      return props.activeTab === 'settings' && currentSettingsSelection === 'wallet';
    }
    if (itemId === 'settings') {
      return props.activeTab === 'settings' && currentSettingsSelection !== 'wallet';
    }
    return false;
  };

  const openSettingsSubmenuItem = (itemId: SettingsSubmenuItemId) => {
    if (itemId === 'profile') {
      props.onNav('profile');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'wallet') {
      persistStoredSettingsSelected('wallet');
      props.onNav('settings');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'settings') {
      persistStoredSettingsSelected('profile');
      props.onNav('settings');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'support') {
      props.onNav('support');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'developer-tools') {
      // D-DEV-001: reachable only behind admitted Developer Mode. The menu
      // item is not rendered at all when Developer Mode is off, but guard the
      // navigation too so a stale click can never reach the surface.
      if (developerModeEnabled) {
        props.onNav('developer-tools');
      }
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'terms-of-service') {
      props.onNav('terms-of-service');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'privacy-policy') {
      props.onNav('privacy-policy');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'logout') {
      props.onLogout();
      setSettingsMenuOpen(false);
    }
  };

  const openWalletFromTitlebar = () => {
    persistStoredSettingsSelected('wallet');
    props.onNav('settings');
  };

  const openNotificationsFromTitlebar = () => {
    props.onNav('notification');
  };
  const toggleSettingsMenuFromTitlebar = () => {
    setSettingsMenuOpen((value) => !value);
  };

  return (
    <AmbientBackground
      data-testid={E2E_IDS.mainShell}
      variant="mesh"
      className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--nimi-surface-canvas)]"
    >
      <MainLayoutTopBar
        authStatus={props.authStatus}
        titlebarLeftInsetClass={titlebarLeftInsetClass}
        titlebarContent={(
          <MainLayoutTitlebarContent
            activeTab={props.activeTab}
            homeFeedScope={homeFeedScope}
            onHomeFeedScopeChange={(scope: PostFeedScope) => setHomeFeedScope(scope)}
            onCreatePostRequest={() => setHomeCreatePostRequestKey((current) => current + 1)}
            exploreActiveSection={exploreActiveSection}
            onExploreSectionChange={setExploreActiveSection}
            exploreSearchText={exploreSearchText}
            onExploreSearchTextChange={setExploreSearchText}
          />
        )}
        sparkBalance={sparkBalance}
        gemBalance={gemBalance}
        balancesPending={balancesQuery.isPending}
        unreadCount={unreadCount}
        avatarNode={avatarNode}
        settingsMenuOpen={settingsMenuOpen}
        settingsTriggerRef={settingsTriggerRef}
        onOpenWallet={openWalletFromTitlebar}
        onOpenNotifications={openNotificationsFromTitlebar}
        onToggleSettingsMenu={toggleSettingsMenuFromTitlebar}
        activeTab={props.activeTab}
        onLogin={props.onLogin}
        onOpenChat={() => props.onNav('chat')}
        onOpenRuntimeConfig={() => props.onNav('runtime')}
        onMouseDown={props.onTitlebarMouseDown}
      />

      <div className="relative z-10 flex min-h-0 flex-1 gap-3 px-3 pb-3 pt-14">
        {hidePrimaryRail || isAnonymousShell ? null : (
          <aside
            data-testid={E2E_IDS.shellSidebarRail}
            className={`flex h-full shrink-0 flex-col transition-[width] duration-200 ${sidebarWidthClass}`}
          >
            <div className="flex h-16 shrink-0 items-center justify-center">
              <SidebarTooltipButton
                label={t('Navigation.home', { defaultValue: 'Home' })}
                dataTestId={E2E_IDS.navTab('home')}
                className={`flex h-11 w-11 items-center justify-center transition-transform duration-150 hover:-translate-y-0.5 ${SHELL_CHROME_INTERACTIVE_RADIUS_CLASS}`}
                onClick={() => {
                  setSettingsMenuOpen(false);
                  props.onNav('home');
                }}
              >
                {nimiHomeNode}
              </SidebarTooltipButton>
            </div>
            <nav className="flex-1">
              <ScrollArea className="flex-1" viewportClassName="pt-2">
                <div className="flex flex-col gap-1">
                  {primaryCoreNavItems.map((item) => (
                    <NavLink
                      key={item.id}
                      item={item}
                      active={props.activeTab === item.id}
                      collapsed
                      onClick={() => props.onNav(item.id)}
                    />
                  ))}
                  {quickNavItems.map((item) => (
                    <NavLink
                      key={item.id}
                      item={item}
                      active={props.activeTab === item.id}
                      collapsed
                      onClick={() => props.onNav(item.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </nav>
          </aside>
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <OfflineShellStrip />
          <DesktopReleaseStrip />
          <StatusBanner />

          {/* Runtime panel — keep-alive: mounted once, then toggled via CSS.
              Own Suspense so other lazy tabs never tear it down. */}
          {runtimeEverMounted ? (
            <Suspense fallback={<div className="flex min-h-0 flex-1" />}>
              <div
                data-testid={E2E_IDS.panel('runtime')}
                className="flex min-h-0 flex-1 flex-col"
                style={{ display: runtimeActive ? undefined : 'none' }}
              >
                <RuntimeConfigPanelBody />
              </div>
            </Suspense>
          ) : null}

          <Suspense fallback={props.activeTab === 'world-detail' ? <WorldDetailRouteLoading /> : <div className="flex min-h-0 flex-1" />}>
            {props.activeTab === 'home' ? (
              <div data-testid={E2E_IDS.panel('home')} className="flex min-h-0 flex-1 flex-col">
                <HomePanel
                  createPostRequestKey={homeCreatePostRequestKey}
                  feedScope={homeFeedScope}
                />
              </div>
            ) : null}

            {props.activeTab === 'chat' ? (
              <div data-testid={E2E_IDS.panel('chat')} className="flex min-h-0 flex-1">
                <ChatPage />
              </div>
            ) : null}

            {props.activeTab === 'explore' ? (
              <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col">
                <ExplorePanel
                  activeSection={exploreActiveSection}
                  searchText={exploreSearchText}
                />
              </div>
            ) : null}

            {props.activeTab === 'apps' ? (
              <div data-testid={E2E_IDS.panel('apps')} className="flex min-h-0 flex-1 flex-col">
                <AppsPanel />
              </div>
            ) : null}

            {props.activeTab === 'notification' ? (
              <div data-testid={E2E_IDS.panel('notification')} className="flex min-h-0 flex-1 flex-col">
                <NotificationPanel />
              </div>
            ) : null}

            {props.activeTab === 'gift-inbox' ? (
              <div data-testid={E2E_IDS.panel('gift-inbox')} className="flex min-h-0 flex-1 flex-col">
                <GiftInboxPanel />
              </div>
            ) : null}

            {props.activeTab === 'settings' ? (
              <div data-testid={E2E_IDS.panel('settings')} className="flex min-h-0 flex-1 flex-col">
                <SettingsPanelBody />
              </div>
            ) : null}

            {props.activeTab === 'support' ? (
              <div data-testid={E2E_IDS.panel('support')} className="flex min-h-0 flex-1 flex-col">
                <SupportPanel />
              </div>
            ) : null}

            {props.activeTab === 'profile' ? (
              <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 flex-col">
                <ProfilePanel />
              </div>
            ) : null}

            {props.activeTab === 'agent-detail' ? (
              <div data-testid={E2E_IDS.panel('agent-detail')} className="flex min-h-0 flex-1 flex-col">
                <AgentDetailPanel />
              </div>
            ) : null}

            {props.activeTab === 'world-detail' ? (
              <div data-testid={E2E_IDS.panel('world-detail')} className="flex min-h-0 flex-1 flex-col">
                <WorldDetailPanel />
              </div>
            ) : null}

            {/* D-DEV-001 / D-DEV-007: the Developer Tools surface is mounted
                only when admitted Developer Mode is on. It is default-invisible
                and never an ordinary primary nav tab. */}
            {props.activeTab === 'developer-tools' && developerModeEnabled ? (
              <div data-testid={E2E_IDS.panel('developer-tools')} className="flex min-h-0 flex-1 flex-col">
                <DeveloperToolsPanel />
              </div>
            ) : null}

            {props.activeTab === 'privacy-policy' ? (
              <div data-testid={E2E_IDS.panel('privacy-policy')} className="flex min-h-0 flex-1 flex-col">
                <PrivacyPolicyView />
              </div>
            ) : null}

            {props.activeTab === 'terms-of-service' ? (
              <div data-testid={E2E_IDS.panel('terms-of-service')} className="flex min-h-0 flex-1 flex-col">
                <TermsOfServiceView />
              </div>
            ) : null}
          </Suspense>

        </div>
      </div>

      {settingsMenuOpen ? (
        <div ref={settingsMenuRef}>
          <MainLayoutSettingsMenu
            top={collapsedSettingsMenuPosition?.top ?? 76}
            left={collapsedSettingsMenuPosition?.left ?? 81}
            userAvatarUrl={props.userAvatarUrl}
            displayName={props.displayName}
            userEmail={props.userEmail}
            developerModeEnabled={developerModeEnabled}
            isItemActive={isSettingsMenuItemActive}
            onOpenItem={openSettingsSubmenuItem}
            onEditProfile={() => {
              persistStoredSettingsSelected('profile');
              props.onNav('settings');
              setSettingsMenuOpen(false);
            }}
            onLogout={() => {
              props.onLogout();
              setSettingsMenuOpen(false);
            }}
          />
        </div>
      ) : null}
    </AmbientBackground>
  );
}
