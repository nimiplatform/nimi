import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import logoImage from '../../assets/logo.svg';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { i18n } from '@renderer/i18n';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import type { UiExtensionContext } from '@renderer/mod-ui/contracts';
import { resolveRouteTabExtension } from '@renderer/mod-ui/lifecycle/sync-runtime-extensions';
import { StatusBanner } from '@renderer/ui/feedback/status-banner';
import {
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from '@renderer/features/settings/settings-storage';
import { loadWorldDetailPanelModule, WorldDetailRouteLoading } from '@renderer/features/world/world-detail-route-state';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { DesktopReleaseStrip } from './desktop-release-strip';
import { MainLayoutTopBar } from './main-layout-topbar';
import { OfflineShellStrip } from './offline-shell-strip';
import { ScenarioJobStatusHost } from '@renderer/features/turns/scenario-job-status-host';
import {
  getCoreNavItems,
  getQuickNavItems,
  NavLink,
  type NavItem,
  renderShellNavIcon,
} from './navigation-config';

const ChatList = lazy(async () => {
  const mod = await import('@renderer/features/chats/chat-list');
  return { default: mod.ChatList };
});
const MessageTimeline = lazy(async () => {
  const mod = await import('@renderer/features/turns/message-timeline');
  return { default: mod.MessageTimeline };
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

// Sidebar Tooltip Button Component - Green background, white text
function SidebarTooltipButton({
  label,
  onClick,
  children,
  className = '',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  
  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipPos({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
      });
    }
  };
  
  const handleMouseLeave = () => {
    setTooltipPos(null);
  };
  
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={className}
        aria-label={label}
      >
        {children}
      </button>
      {tooltipPos ? (
        <span 
          className="fixed px-2 py-1 rounded-md bg-[#4ECCA3] text-white text-xs whitespace-nowrap z-[9999] shadow-lg pointer-events-none"
          style={{ 
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: 'translateY(-50%)',
          }}
        >
          {label}
        </span>
      ) : null}
    </>
  );
}

function ChatLayout() {
  const MIN_CHAT_LIST_WIDTH = 240;
  const MAX_CHAT_LIST_WIDTH = 460;
  const [chatListWidth, setChatListWidth] = useState(280);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(
        MAX_CHAT_LIST_WIDTH,
        Math.max(MIN_CHAT_LIST_WIDTH, Math.round(event.clientX - rect.left)),
      );
      setChatListWidth(nextWidth);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <div className="relative shrink-0 bg-white" style={{ width: `${chatListWidth}px` }}>
        <ChatList />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={i18n.t('Layout.resizeChatList', { defaultValue: 'Resize chat list' })}
          onMouseDown={startResize}
          className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize bg-transparent"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <MessageTimeline />
      </div>
    </div>
  );
}

type MainLayoutViewProps = {
  activeTab: AppTab;
  displayName: string;
  userAvatarUrl: string | null;
  userEmail?: string | null;
  context: UiExtensionContext;
  onNav: (tabId: string) => void;
  onLogout: () => void;
  onTitlebarMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

export function MainLayoutView(props: MainLayoutViewProps) {
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const authStatus = useAppStore((state) => state.auth.status);
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
  const sidebarWidthClass = 'w-[60px]';
  const titlebarLeftInsetClass = flags.enableTitlebarDrag ? 'pl-[92px]' : 'pl-3';
  const activeModTab = props.activeTab.startsWith('mod:');
  const activeRouteExtension = useMemo(
    () => (activeModTab ? resolveRouteTabExtension(props.activeTab) : null),
    [activeModTab, props.activeTab],
  );
  const immersiveRoute = String(activeRouteExtension?.extension.shellMode || '').trim().toLowerCase() === 'immersive';
  const balancesQuery = useQuery({
    queryKey: ['topbar-currency-balances'],
    queryFn: async () => {
      const { dataSync } = await import('@runtime/data-sync');
      return dataSync.loadCurrencyBalances() as Promise<Record<string, unknown>>;
    },
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const unreadCountQuery = useQuery({
    queryKey: ['topbar-notification-unread-count'],
    queryFn: async () => {
      const { dataSync } = await import('@runtime/data-sync');
      return dataSync.loadNotificationUnreadCount();
    },
    enabled: authStatus === 'authenticated',
    staleTime: 15_000,
    refetchInterval: 30_000,
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
      sizeClassName="h-8 w-8"
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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-50">
      <MainLayoutTopBar
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
        onMouseDown={props.onTitlebarMouseDown}
      />

      <div className="flex min-h-0 flex-1">
        {immersiveRoute ? null : (
          <aside className={`flex h-full shrink-0 flex-col bg-white transition-[width] duration-200 ${sidebarWidthClass}`}>
            <div className="flex h-14 shrink-0 items-center justify-center">
              <SidebarTooltipButton
                label={t('Navigation.home', { defaultValue: 'Home' })}
                onClick={() => {
                  setSettingsMenuOpen(false);
                  props.onNav('home');
                }}
              >
                {nimiHomeNode}
              </SidebarTooltipButton>
            </div>

            <ScrollShell as="nav" className="flex-1" viewportClassName="pt-2">
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
                    onClick={() => props.onNav('mods')}
                  />
                ) : null}
              </div>
            </ScrollShell>

          </aside>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <OfflineShellStrip />
          <DesktopReleaseStrip />
          <StatusBanner />
          <ScenarioJobStatusHost />

          <Suspense fallback={props.activeTab === 'world-detail' ? <WorldDetailRouteLoading /> : <div className="flex min-h-0 flex-1" />}>
            {props.activeTab === 'home' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <HomePanel createPostRequestKey={createPostRequestKey} />
              </div>
            ) : null}

            {props.activeTab === 'chat' ? (
              <ChatLayout />
            ) : null}

            {props.activeTab === 'contacts' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ContactsPanel />
              </div>
            ) : null}

            {props.activeTab === 'explore' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ExplorePanel />
              </div>
            ) : null}

            {props.activeTab === 'runtime' && flags.enableRuntimeTab ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <RuntimeConfigPanelBody />
              </div>
            ) : null}

            {props.activeTab === 'notification' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <NotificationPanel />
              </div>
            ) : null}

            {props.activeTab === 'settings' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <SettingsPanelBody />
              </div>
            ) : null}

            {props.activeTab === 'profile' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ProfilePanel />
              </div>
            ) : null}

            {props.activeTab === 'agent-detail' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <AgentDetailPanel />
              </div>
            ) : null}

            {props.activeTab === 'world' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <WorldList />
              </div>
            ) : null}
            {props.activeTab === 'world-detail' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <WorldDetailPanel />
              </div>
            ) : null}

            {props.activeTab === 'mods' && flags.enableModUi ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <ModsPanel />
              </div>
            ) : null}

            {props.activeTab === 'privacy-policy' ? (
              <PrivacyPolicyView />
            ) : null}

            {props.activeTab === 'terms-of-service' ? (
              <TermsOfServiceView />
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
          className="fixed z-[11010] flex max-h-[calc(100vh-100px)] w-64 flex-col overflow-hidden rounded-2xl border border-[#4ECCA3]/20 bg-white py-2 shadow-2xl shadow-[#4ECCA3]/10"
          style={{
            top: `${collapsedSettingsMenuPosition?.top ?? 76}px`,
            left: `${collapsedSettingsMenuPosition?.left ?? 81}px`,
          }}
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
              <p className="truncate text-sm font-semibold text-gray-900">{props.displayName}</p>
              <p className="truncate text-xs text-gray-500">{props.userEmail || props.displayName.toLowerCase().replace(/\s+/g, '.') + '@nimi.app'}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                persistStoredSettingsSelected('profile');
                props.onNav('settings');
                setSettingsMenuOpen(false);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-[#4ECCA3]/10 hover:text-[#4ECCA3]"
              title={t('Layout.editProfile', { defaultValue: 'Edit Profile' })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </div>

          <div className="mx-4 my-2 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/20 to-transparent" />

          <ScrollShell className="flex-1">
            <div className="px-2">
              <button
                type="button"
                onClick={() => {
                  openSettingsSubmenuItem('profile');
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-all ${
                  isSettingsMenuItemActive('profile')
                    ? 'bg-[#4ECCA3]/10 text-[#2F7D6B]'
                    : 'text-gray-700 hover:bg-[#4ECCA3]/5'
                }`}
              >
                <span className={`w-4 shrink-0 ${isSettingsMenuItemActive('profile') ? 'text-[#4ECCA3]' : 'text-gray-400'}`}>
                  {renderShellNavIcon('profile')}
                </span>
                <span className="min-w-0 flex-1 text-left font-medium">{t(SETTINGS_SUBMENU_I18N_KEYS.profile ?? '', 'Profile')}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
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
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition-all ${
                      active
                        ? 'bg-[#4ECCA3]/10 text-[#2F7D6B]'
                        : 'text-gray-700 hover:bg-[#4ECCA3]/5'
                    }`}
                  >
                    <span className={`w-4 shrink-0 ${active ? 'text-[#4ECCA3]' : 'text-gray-400'}`}>
                      {renderShellNavIcon(item.icon)}
                    </span>
                    <span className="min-w-0 flex-1 text-left font-medium">{t(SETTINGS_SUBMENU_I18N_KEYS[item.id] ?? '', item.label)}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                );
              })}
            </div>

            <div className="mx-4 my-2 h-px bg-gradient-to-r from-transparent via-gray-100 to-transparent" />

            <div className="px-2 pb-2">
              <button
                type="button"
                onClick={() => {
                  props.onLogout();
                  setSettingsMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-gray-700 transition-all hover:bg-[#4ECCA3]/5"
              >
                <span className="w-4 shrink-0 text-gray-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 text-left font-medium">{t('Menu.logout', 'Log out')}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          </ScrollShell>
        </div>
      ) : null}
    </div>
  );
}
