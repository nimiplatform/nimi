import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import logoImage from '../../assets/logo.png';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { loadNimiRealmNotificationUnreadCount } from '@nimiplatform/sdk/realm';
import { AnimatePresence, motion } from 'motion/react';
import { useAppStore, type AppTab, type AuthStatus } from '../providers/app-store';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { AmbientBackground, ScrollArea, Tooltip } from '@nimiplatform/kit/ui';
import { StatusBanner } from '../../ui/feedback/status-banner';
import {
  notificationQueryKeys,
  resolveNotificationIdentityRef,
} from '../../features/notification/notification-query.js';
import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import { DEFAULT_HOME_FEED_SCOPE } from '../../features/home/home-feed-controls';
import { getShellFeatureFlags } from '@nimiplatform/kit/core/shell-mode';
import { DesktopReleaseStrip } from './desktop-release-strip';
import { MainLayoutPanelStack } from './main-layout-panel-stack';
import { MainLayoutTopBar } from './main-layout-topbar';
import {
  MainLayoutSettingsMenu,
  type SettingsMenuAnchorPosition,
  type SettingsSubmenuItemId,
} from './main-layout-settings-menu';
import { MainLayoutTitlebarContent } from './main-layout-titlebar-content';
import { OfflineShellStrip } from './offline-shell-strip';
import {
  SHELL_CHROME_INTERACTIVE_RADIUS_CLASS,
  SHELL_CHROME_TOOLTIP_CLASS,
} from './shell-chrome-classes';
import {
  DESKTOP_MENU_VARIANTS,
  useDesktopInteractiveMotion,
  useDesktopReducedMotion,
} from '../../ui/motion/desktop-motion';
import {
  getCoreNavItems,
  getQuickNavItems,
  NavLink,
} from './navigation-config';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useDesktopRendererBindings } from '../../renderer/binding-context';

const DEFAULT_TITLEBAR_TOP_INSET_CLASS = 'top-0';
const MACOS_TITLEBAR_TOP_INSET_CLASS = 'top-7';
const DEFAULT_SHELL_CONTENT_TOP_PADDING_CLASS = 'pt-14';
const MACOS_SHELL_CONTENT_TOP_PADDING_CLASS = 'pt-[calc(3.5rem+1.75rem)]';
const DEFAULT_SETTINGS_MENU_TOP_PX = 64;
const MACOS_SETTINGS_MENU_TOP_PX = 92;

/** Track window focus so polling queries can pause when the app is not focused. */
function useWindowFocused(
  subscribe: (listener: (focused: boolean) => void) => () => void,
): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    setFocused(document.hasFocus());
    return subscribe(setFocused);
  }, [subscribe]);
  return focused;
}

type MainLayoutViewProps = {
  activeTab: AppTab;
  authStatus: AuthStatus;
  displayName: string;
  userAvatarUrl: string | null;
  userEmail?: string | null;
  onNav: (tabId: string) => void;
  onSwitchAccount: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onTitlebarMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
};

export function MainLayoutView(props: MainLayoutViewProps) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const flags = getShellFeatureFlags();
  const usesMacTrafficLightTitlebar = flags.enableMenuBarShell;
  const titlebarTopInsetClass = usesMacTrafficLightTitlebar
    ? MACOS_TITLEBAR_TOP_INSET_CLASS
    : DEFAULT_TITLEBAR_TOP_INSET_CLASS;
  const shellContentTopPaddingClass = usesMacTrafficLightTitlebar
    ? MACOS_SHELL_CONTENT_TOP_PADDING_CLASS
    : DEFAULT_SHELL_CONTENT_TOP_PADDING_CLASS;
  const settingsMenuFallbackTop = usesMacTrafficLightTitlebar
    ? MACOS_SETTINGS_MENU_TOP_PX
    : DEFAULT_SETTINGS_MENU_TOP_PX;
  const selectedProfileId = useAppStore((state) => state.selectedProfileId);
  const profileDetailOverlayOpen = useAppStore((state) => state.profileDetailOverlayOpen);
  const authUser = useAppStore((state) => state.auth.user);
  const exploreActiveSection = useAppStore((state) => state.exploreActiveSection);
  const setExploreActiveSection = useAppStore((state) => state.setExploreActiveSection);
  const exploreSearchText = useAppStore((state) => state.exploreSearchText);
  const setExploreSearchText = useAppStore((state) => state.setExploreSearchText);
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
    () => bindings.app.projection.developerModeEnabled(),
  );
  useEffect(() => {
    return bindings.app.events.subscribeDeveloperMode((next) => {
      setDeveloperModeEnabled(next);
    });
  }, [bindings]);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsMenuPosition, setSettingsMenuPosition] = useState<SettingsMenuAnchorPosition>({
    top: settingsMenuFallbackTop,
    right: 16,
  });
  const settingsTriggerRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const sidebarWidthClass = 'w-[60px]';
  const titlebarLeftInsetClass = flags.enableTitlebarDrag ? 'pl-[92px]' : 'pl-3';
  const [homeFeedScope, setHomeFeedScope] = useState(DEFAULT_HOME_FEED_SCOPE);
  const [homeCreatePostRequestKey, setHomeCreatePostRequestKey] = useState(0);
  const reducedMotion = useDesktopReducedMotion();
  const interactiveMotion = useDesktopInteractiveMotion();

  // Keep-alive: once the runtime tab is visited, keep the component mounted (display:none
  // when inactive) so that subsequent visits are instant — no re-init, no re-hydration.
  const runtimeActive = props.activeTab === 'runtime';
  const runtimeEverMountedRef = useRef(false);
  if (runtimeActive) runtimeEverMountedRef.current = true;
  const runtimeEverMounted = runtimeEverMountedRef.current;

  const immersiveRoute = props.activeTab === 'source-detail'
    || props.activeTab === 'gift-inbox';
  const hidePrimaryRail = immersiveRoute
    || (props.activeTab === 'profile' && Boolean(selectedProfileId))
    || profileDetailOverlayOpen;
  const windowFocused = useWindowFocused(bindings.app.events.subscribeWindowFocus);
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.topbarUnreadCount(notificationQueryIdentityRef),
    queryFn: async () => loadNimiRealmNotificationUnreadCount(bindings.sdk.realm()),
    enabled: props.authStatus === 'authenticated' && Boolean(notificationIdentityRef),
    staleTime: 15_000,
    refetchInterval: windowFocused ? 30_000 : false,
  });

  const unreadCount = unreadCountQuery.data?.total ?? 0;

  const updateSettingsMenuPosition = useCallback(() => {
    const triggerRect = settingsTriggerRef.current?.getBoundingClientRect();
    if (!triggerRect) {
      setSettingsMenuPosition({ top: settingsMenuFallbackTop, right: 16 });
      return;
    }
    const viewportWidth = bindings.app.projection.viewportWidth();
    setSettingsMenuPosition({
      top: Math.max(12, Math.round(triggerRect.bottom + 12)),
      right: Math.max(12, Math.round(viewportWidth - triggerRect.right)),
    });
  }, [bindings, settingsMenuFallbackTop]);

  useLayoutEffect(() => {
    if (settingsMenuOpen) {
      updateSettingsMenuPosition();
    }
  }, [settingsMenuOpen, updateSettingsMenuPosition]);

  useEffect(() => {
    if (!settingsMenuOpen) {
      return;
    }
    return bindings.app.events.subscribeWindowResize(updateSettingsMenuPosition);
  }, [bindings, settingsMenuOpen, updateSettingsMenuPosition]);

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
    const unsubscribeMouseDown = bindings.app.events.subscribeDocumentMouseDown(onMouseDown);
    const unsubscribeKeyDown = bindings.app.events.subscribeWindowKeyDown(onKeyDown);
    return () => {
      unsubscribeKeyDown();
      unsubscribeMouseDown();
    };
  }, [bindings, settingsMenuOpen]);

  useEffect(() => {
    setSettingsMenuOpen(false);
  }, [props.activeTab]);

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
      className="h-9 w-9 shrink-0 object-contain mix-blend-multiply"
    />
  );
  const isSettingsMenuItemActive = (itemId: SettingsSubmenuItemId): boolean => {
    if (itemId === 'profile') {
      return props.activeTab === 'profile';
    }
    if (itemId === 'settings') {
      return props.activeTab === 'settings';
    }
    return false;
  };

  const openSettingsSubmenuItem = (itemId: SettingsSubmenuItemId) => {
    if (itemId === 'profile') {
      props.onNav('profile');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'settings') {
      bindings.app.commands.settings.persistSelected('profile');
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
    if (itemId === 'logout') {
      props.onLogout();
      setSettingsMenuOpen(false);
    }
  };

  const openNotificationsFromTitlebar = () => {
    props.onNav('notification');
  };
  const toggleSettingsMenuFromTitlebar = () => {
    if (settingsMenuOpen) {
      setSettingsMenuOpen(false);
      return;
    }
    updateSettingsMenuPosition();
    setSettingsMenuOpen(true);
  };

  return (
    <AmbientBackground
      data-testid={E2E_IDS.mainShell}
      variant="mesh"
      className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--nimi-surface-canvas)]"
    >
      <MainLayoutTopBar
        authStatus={props.authStatus}
        titlebarTopInsetClass={titlebarTopInsetClass}
        titlebarLeftInsetClass={titlebarLeftInsetClass}
        titlebarContent={(
          <MainLayoutTitlebarContent
            activeTab={props.activeTab}
            homeFeedScope={homeFeedScope}
            onHomeFeedScopeChange={(scope: NimiRealmFeedScope) => setHomeFeedScope(scope)}
            exploreActiveSection={exploreActiveSection}
            onExploreSectionChange={setExploreActiveSection}
            exploreSearchText={exploreSearchText}
            onExploreSearchTextChange={setExploreSearchText}
          />
        )}
        unreadCount={unreadCount}
        avatarNode={avatarNode}
        settingsMenuOpen={settingsMenuOpen}
        settingsTriggerRef={settingsTriggerRef}
        onOpenNotifications={openNotificationsFromTitlebar}
        onToggleSettingsMenu={toggleSettingsMenuFromTitlebar}
        activeTab={props.activeTab}
        onLogin={props.onLogin}
        onOpenChat={() => props.onNav('chat')}
        onOpenRuntimeConfig={() => props.onNav('runtime')}
        onCreatePostRequest={() => setHomeCreatePostRequestKey((current) => current + 1)}
        onMouseDown={props.onTitlebarMouseDown}
      />

      <div className={`relative z-10 flex min-h-0 flex-1 gap-3 px-3 pb-3 ${shellContentTopPaddingClass}`}>
        {hidePrimaryRail || isAnonymousShell ? null : (
          <aside
            data-testid={E2E_IDS.shellSidebarRail}
            className={`flex h-full shrink-0 flex-col transition-[width] duration-200 ${sidebarWidthClass}`}
          >
            <div className="flex h-16 shrink-0 items-center justify-center">
              <Tooltip
                content={t('Navigation.home', { defaultValue: 'Home' })}
                placement="right"
                contentClassName={SHELL_CHROME_TOOLTIP_CLASS}
              >
                <motion.button
                  type="button"
                  data-testid={E2E_IDS.navTab('home')}
                  whileHover={interactiveMotion.whileHover}
                  whileTap={interactiveMotion.whileTap}
                  transition={interactiveMotion.transition}
                  className={`flex h-11 w-11 items-center justify-center transition-transform duration-150 hover:-translate-y-0.5 ${SHELL_CHROME_INTERACTIVE_RADIUS_CLASS}`}
                  aria-label={t('Navigation.home', { defaultValue: 'Home' })}
                  onClick={() => {
                    setSettingsMenuOpen(false);
                    props.onNav('home');
                  }}
                >
                  {nimiHomeNode}
                </motion.button>
              </Tooltip>
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

          <MainLayoutPanelStack
            activeTab={props.activeTab}
            developerModeEnabled={developerModeEnabled}
            exploreActiveSection={exploreActiveSection}
            exploreSearchText={exploreSearchText}
            homeCreatePostRequestKey={homeCreatePostRequestKey}
            homeFeedScope={homeFeedScope}
            runtimeActive={runtimeActive}
            runtimeEverMounted={runtimeEverMounted}
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
      {settingsMenuOpen ? (
        <motion.div
          key="settings-menu"
          ref={settingsMenuRef}
          custom={reducedMotion}
          variants={DESKTOP_MENU_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <MainLayoutSettingsMenu
            userAvatarUrl={props.userAvatarUrl}
            displayName={props.displayName}
            userEmail={props.userEmail}
            anchorPosition={settingsMenuPosition}
            developerModeEnabled={developerModeEnabled}
            isItemActive={isSettingsMenuItemActive}
            onOpenItem={openSettingsSubmenuItem}
            onEditProfile={() => {
              bindings.app.commands.settings.persistSelected('profile');
              props.onNav('settings');
              setSettingsMenuOpen(false);
            }}
            onSwitchAccount={() => {
              props.onSwitchAccount();
              setSettingsMenuOpen(false);
            }}
            onLogout={() => {
              props.onLogout();
              setSettingsMenuOpen(false);
            }}
          />
        </motion.div>
      ) : null}
      </AnimatePresence>
    </AmbientBackground>
  );
}
