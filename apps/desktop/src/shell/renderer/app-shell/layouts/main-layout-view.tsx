import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import logoImage from '../../assets/logo.svg';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { AmbientBackground, ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import type { UiExtensionContext } from '@renderer/mod-ui/contracts';
import { resolveRouteTabExtension } from '@renderer/mod-ui/lifecycle/sync-runtime-extensions';
import { StatusBanner } from '@renderer/ui/feedback/status-banner';
import { notificationQueryKeys } from '@renderer/features/notification/notification-query.js';
import {
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from '@renderer/features/settings/settings-storage';
import { loadWorldDetailPanelModule, WorldDetailRouteLoading } from '@renderer/features/world/world-detail-route-state';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { DesktopReleaseStrip } from './desktop-release-strip';
import { MainLayoutTopBar } from './main-layout-topbar';
import { SidebarTooltipButton } from './main-layout-sidebar-tooltip-button';
import { OfflineShellStrip } from './offline-shell-strip';
import { ScenarioJobStatusHost } from '@renderer/features/turns/scenario-job-status-host';
import {
  SHELL_CHROME_INTERACTIVE_RADIUS_CLASS,
  SHELL_CHROME_MENU_ITEM_BASE_CLASS,
  SHELL_CHROME_OVERLAY_CLASS,
} from './shell-chrome-classes';
import {
  getCoreNavItems,
  getQuickNavItems,
  NavLink,
  type NavItem,
  renderShellNavIcon,
} from './navigation-config';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

const ChatPage = lazy(async () => {
  const mod = await import('@renderer/features/chat/chat-page');
  return { default: mod.ChatPage };
});
const ContactsPanel = lazy(async () => {
  const mod = await import('@renderer/features/contacts/contacts-panel');
  return { default: mod.ContactsPanel };
});
const ExplorePanel = lazy(async () => {
  const mod = await import('@renderer/features/explore/explore-panel');
  return { default: mod.ExplorePanel };
});
const SettingsPanelBody = lazy(async () => {
  const mod = await import('@renderer/features/settings/settings-panel-body');
  return { default: mod.SettingsPanelBody };
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
const WorldList = lazy(async () => {
  const mod = await import('@renderer/features/world/world-list');
  return { default: mod.WorldList };
});
const HomePanel = lazy(async () => {
  const mod = await import('@renderer/features/home/home-panel');
  return { default: mod.HomePanel };
});
const ModsPanel = lazy(async () => {
  const mod = await import('@renderer/features/mods/mods-panel');
  return { default: mod.ModsPanel };
});
const PrivacyPolicyView = lazy(async () => {
  const mod = await import('@renderer/features/legal/privacy-policy-view');
  return { default: mod.PrivacyPolicyView };
});
const TermsOfServiceView = lazy(async () => {
  const mod = await import('@renderer/features/legal/terms-of-service-view');
  return { default: mod.TermsOfServiceView };
});
const TesterPage = lazy(async () => {
  const mod = await import('@renderer/features/tester/tester-page');
  return { default: mod.TesterPage };
});
const SlotHost = lazy(async () => {
  const mod = await import('@renderer/mod-ui/host/slot-host');
  return { default: mod.SlotHost };
});
type SettingsSubmenuItemId =
  | 'profile'
  | 'wallet'
  | 'settings'
  | 'terms-of-service'
  | 'privacy-policy'
  | 'logout';
type SettingsSubmenuItem = {
  id: SettingsSubmenuItemId;
  label: string;
  icon: string;
};
const SETTINGS_SUBMENU_ITEMS: SettingsSubmenuItem[] = [
  { id: 'profile', label: 'Profile', icon: 'profile' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'terms-of-service', label: 'Terms of Service', icon: 'terms-of-service' },
  { id: 'privacy-policy', label: 'Privacy Policy', icon: 'privacy-policy' },
  { id: 'logout', label: 'Logout', icon: 'logout' },
];
const SETTINGS_SUBMENU_I18N_KEYS: Record<SettingsSubmenuItemId, string> = {
  profile: 'Menu.profile',
  wallet: 'Menu.wallet',
  settings: 'Menu.settings',
  'terms-of-service': 'Menu.termsOfService',
  'privacy-policy': 'Menu.privacyPolicy',
  logout: 'Menu.logout',
};

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
  context: UiExtensionContext;
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
  const runtimeModFailures = useAppStore((state) => state.runtimeModFailures);
  const fusedRuntimeMods = useAppStore((state) => state.fusedRuntimeMods);
  const isAnonymousShell = props.authStatus !== 'authenticated';
  const coreNavItems = getCoreNavItems();
  const quickNavItems = getQuickNavItems();
  const primaryCoreNavItems = coreNavItems.filter((item) => item.id !== 'settings' && item.id !== 'home');
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [createPostRequestKey] = useState(0);
  const [collapsedSettingsMenuPosition, setCollapsedSettingsMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const settingsTriggerRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const modsNavItem: NavItem = {
    id: 'mods',
    label: t('Navigation.mods'),
    icon: renderShellNavIcon('puzzle'),
  };
  const modsHasIssues = runtimeModFailures.length > 0 || Object.keys(fusedRuntimeMods).length > 0;
  const sidebarWidthClass = 'w-[60px]';
  const titlebarLeftInsetClass = flags.enableTitlebarDrag ? 'pl-[92px]' : 'pl-3';

  // Keep-alive: once the runtime tab is visited, keep the component mounted (display:none
  // when inactive) so that subsequent visits are instant — no re-init, no re-hydration.
  const runtimeActive = props.activeTab === 'runtime' && flags.enableRuntimeTab;
  const runtimeEverMountedRef = useRef(false);
  if (runtimeActive) runtimeEverMountedRef.current = true;
  const runtimeEverMounted = runtimeEverMountedRef.current;

  const activeModTab = props.activeTab.startsWith('mod:');
  const activeRouteExtension = useMemo(
    () => (activeModTab ? resolveRouteTabExtension(props.activeTab) : null),
    [activeModTab, props.activeTab],
  );
  const immersiveRoute = String(activeRouteExtension?.extension.shellMode || '').trim().toLowerCase() === 'immersive';
  const hidePrimaryRail = immersiveRoute
    || props.activeTab === 'agent-detail'
    || props.activeTab === 'gift-inbox'
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
    queryKey: notificationQueryKeys.topbarUnreadCount,
    queryFn: async () => {
      const { dataSync } = await import('@runtime/data-sync');
      return dataSync.loadNotificationUnreadCount();
    },
    enabled: props.authStatus === 'authenticated',
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
      sizeClassName="h-10 w-10"
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
        enableModWorkspaceTabs={flags.enableModWorkspaceTabs}
        titlebarLeftInsetClass={titlebarLeftInsetClass}
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
                  {flags.enableModUi ? (
                    <NavLink
                      item={modsNavItem}
                      active={props.activeTab === 'mods' || activeModTab}
                      collapsed
                      badge={modsHasIssues ? <span className="inline-flex h-2 w-2 rounded-full bg-[var(--nimi-status-warning)]" /> : null}
                      onClick={() => props.onNav('mods')}
                    />
                  ) : null}
                </div>
              </ScrollArea>
            </nav>
          </aside>
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <OfflineShellStrip />
          <DesktopReleaseStrip />
          <StatusBanner />
          <ScenarioJobStatusHost />

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
                <HomePanel createPostRequestKey={createPostRequestKey} />
              </div>
            ) : null}

            {props.activeTab === 'chat' ? (
              <div data-testid={E2E_IDS.panel('chat')} className="flex min-h-0 flex-1">
                <ChatPage />
              </div>
            ) : null}

            {props.activeTab === 'contacts' ? (
              <div data-testid={E2E_IDS.panel('contacts')} className="flex min-h-0 flex-1 flex-col">
                <ContactsPanel />
              </div>
            ) : null}

            {props.activeTab === 'explore' ? (
              <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col">
                <ExplorePanel />
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

            {props.activeTab === 'world' ? (
              <div data-testid={E2E_IDS.panel('world')} className="flex min-h-0 flex-1 flex-col">
                <WorldList />
              </div>
            ) : null}
            {props.activeTab === 'world-detail' ? (
              <div data-testid={E2E_IDS.panel('world-detail')} className="flex min-h-0 flex-1 flex-col">
                <WorldDetailPanel />
              </div>
            ) : null}

            {props.activeTab === 'mods' && flags.enableModUi ? (
              <div data-testid={E2E_IDS.panel('mods')} className="flex min-h-0 flex-1 flex-col">
                <ModsPanel />
              </div>
            ) : null}

            {props.activeTab === 'tester' && flags.enableRuntimeTab ? (
              <div data-testid={E2E_IDS.panel('tester')} className="flex min-h-0 flex-1 flex-col">
                <TesterPage />
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

          {flags.enableModUi ? (
            <Suspense fallback={null}>
              <SlotHost slot="ui-extension.app.content.routes" base={null} context={props.context} />
            </Suspense>
          ) : null}
        </div>
      </div>

      {settingsMenuOpen ? (
        <div
          ref={settingsMenuRef}
          className="fixed z-[11010]"
          style={{
            top: `${collapsedSettingsMenuPosition?.top ?? 76}px`,
            left: `${collapsedSettingsMenuPosition?.left ?? 81}px`,
          }}
        >
          <Surface
            tone="overlay"
            material="glass-thick"
            padding="none"
            className={`flex max-h-[calc(100vh-100px)] w-64 flex-col overflow-hidden py-2 ${SHELL_CHROME_OVERLAY_CLASS}`}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <EntityAvatar
                imageUrl={props.userAvatarUrl}
                name={props.displayName}
                kind="human"
                sizeClassName="h-10 w-10"
                textClassName="text-sm font-semibold"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{props.displayName}</p>
                <p className="truncate text-xs text-[var(--nimi-text-secondary)]">{props.userEmail || props.displayName.toLowerCase().replace(/\s+/g, '.') + '@nimi.app'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  persistStoredSettingsSelected('profile');
                  props.onNav('settings');
                  setSettingsMenuOpen(false);
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--nimi-text-secondary)] transition hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-action-primary-bg)]"
                title={t('Layout.editProfile', { defaultValue: 'Edit Profile' })}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </div>

            <div className="mx-4 my-2 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,white)] to-transparent" />

            <ScrollArea className="flex-1">
              <div className="px-2">
                <button
                  type="button"
                  onClick={() => {
                    openSettingsSubmenuItem('profile');
                  }}
                  className={`${SHELL_CHROME_MENU_ITEM_BASE_CLASS} ${
                    isSettingsMenuItemActive('profile')
                      ? 'bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-action-primary-bg)]'
                      : 'text-[var(--nimi-text-primary)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,white)]'
                  }`}
                >
                  <span className={`w-4 shrink-0 ${isSettingsMenuItemActive('profile') ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)]'}`}>
                    {renderShellNavIcon('profile')}
                  </span>
                  <span className="min-w-0 flex-1 text-left font-medium">{t(SETTINGS_SUBMENU_I18N_KEYS.profile ?? '', 'Profile')}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color-mix(in_srgb,var(--nimi-text-secondary)_45%,white)]">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>

                {SETTINGS_SUBMENU_ITEMS.filter((item) => item.id !== 'logout' && item.id !== 'profile').map((item) => {
                  const active = isSettingsMenuItemActive(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        openSettingsSubmenuItem(item.id);
                      }}
                      className={`${SHELL_CHROME_MENU_ITEM_BASE_CLASS} ${
                        active
                          ? 'bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-action-primary-bg)]'
                          : 'text-[var(--nimi-text-primary)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,white)]'
                      }`}
                    >
                      <span className={`w-4 shrink-0 ${active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-secondary)]'}`}>
                        {renderShellNavIcon(item.icon)}
                      </span>
                      <span className="min-w-0 flex-1 text-left font-medium">{t(SETTINGS_SUBMENU_I18N_KEYS[item.id] ?? '', item.label)}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color-mix(in_srgb,var(--nimi-text-secondary)_45%,white)]">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  );
                })}
              </div>

              <div className="mx-4 my-2 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--nimi-text-secondary)_14%,white)] to-transparent" />

              <div className="px-2 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    props.onLogout();
                    setSettingsMenuOpen(false);
                  }}
                  className={`${SHELL_CHROME_MENU_ITEM_BASE_CLASS} text-[var(--nimi-text-primary)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,white)]`}
                >
                  <span className="w-4 shrink-0 text-[var(--nimi-text-secondary)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1 text-left font-medium">{t('Menu.logout', 'Log out')}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color-mix(in_srgb,var(--nimi-text-secondary)_45%,white)]">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>
            </ScrollArea>
          </Surface>
        </div>
      ) : null}
    </AmbientBackground>
  );
}
