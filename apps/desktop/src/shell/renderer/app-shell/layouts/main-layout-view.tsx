import { useHomeNavigation, useHomeDestination } from '../providers/app-store.js';
import { homeNavigationColumn } from '../providers/home-navigation.js';
// @nimi-authority: rule.nimi.desktop.shell-ui.r023
import { ExecutionNotificationPreferenceSync } from '../../features/home/execution-notices.js';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plug } from 'lucide-react';
import logoImage from '../../assets/logo.png';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { loadNimiRealmNotificationUnreadCount } from '@nimiplatform/sdk/realm';
import { AnimatePresence, motion } from 'motion/react';
import { useAppStore, type AppTab, type AuthStatus } from '../providers/app-store';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { AmbientBackground, ConfirmDialog, NimiToaster, ScrollArea, Tooltip } from '@nimiplatform/kit/ui';
import {
  notificationQueryKeys,
  resolveNotificationIdentityRef,
} from '../../features/notification/notification-query.js';
import { DEFAULT_HOME_FEED_SCOPE } from '../../features/home/home-feed-controls';
import { MainLayoutPanelStack } from './main-layout-panel-stack';
import { shouldHideMainLayoutPrimaryRail } from './main-layout-primary-rail';
import {
  MainLayoutSettingsMenu,
  type SettingsMenuAnchorPosition,
  type SettingsSubmenuItemId,
} from './main-layout-settings-menu';
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
import { GlobalDownloadsNavigation } from '../../features/runtime-config/global-downloads-view.js';
import { ProductUpdateNotice } from '../../features/home/product-update-notice.js';
import { useProductUpdate } from '../../features/home/product-update-context.js';

/** Track window focus so polling queries can pause when the app is not focused. */
function useWindowFocused(
  initialFocused: boolean,
  subscribe: (listener: (focused: boolean) => void) => () => void,
): boolean {
  const [focused, setFocused] = useState(initialFocused);
  useEffect(() => subscribe(setFocused), [subscribe]);
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
};

// @nimi-authority: rule.nimi.desktop.shell-ui.r001
export function MainLayoutView(props: MainLayoutViewProps) {
  const navigation = useHomeNavigation();
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const { homeReady } = useProductUpdate();
  useEffect(homeReady, [homeReady]);
  const profileDetailOverlayOpen = useAppStore((state) => state.profileDetailOverlayOpen);
  const authUser = useAppStore((state) => state.auth.user);

  const homeEntryDestination = useHomeDestination().homeSection ?? 'overview';
  const exploreActiveSection = useHomeDestination().exploreSection ?? 'worlds';
  const exploreSearchText = useHomeDestination().search ?? '';
  const railVisible = useAppStore(state => state.primaryRailVisible);
  const destination = useHomeDestination();
  const navigationColumn = homeNavigationColumn(destination);
  const isAnonymousShell = props.authStatus !== 'authenticated';
  const notificationIdentityRef = useMemo(
    () => resolveNotificationIdentityRef(props.authStatus, authUser),
    [props.authStatus, authUser],
  );
  const notificationQueryIdentityRef = notificationIdentityRef ?? 'missing-auth-identity';
  const coreNavItems = getCoreNavItems();
  const quickNavItems = getQuickNavItems();
  const primaryCoreNavItems = coreNavItems.filter((item) => item.id !== 'home');
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [pendingAccountAction, setPendingAccountAction] = useState<'logout' | 'switch-account' | null>(null);
  const [settingsMenuPosition, setSettingsMenuPosition] = useState<SettingsMenuAnchorPosition>({
    bottom: 16,
    left: 84,
  });
  const settingsTriggerRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const sidebarWidthClass = 'w-[60px]';
  const [homeFeedScope, setHomeFeedScope] = useState(DEFAULT_HOME_FEED_SCOPE);
  const reducedMotion = useDesktopReducedMotion();
  const interactiveMotion = useDesktopInteractiveMotion();

  // Keep-alive: once the runtime tab is visited, keep the component mounted (display:none
  // when inactive) so that subsequent visits are instant — no re-init, no re-hydration.
  const runtimeActive = ['runtime', 'cloud', 'diagnostics'].includes(props.activeTab);
  const runtimeEverMountedRef = useRef(false);
  if (runtimeActive) runtimeEverMountedRef.current = true;
  const runtimeEverMounted = runtimeEverMountedRef.current;

  const hidePrimaryRail = shouldHideMainLayoutPrimaryRail({
    activeTab: props.activeTab,
    profileDetailOverlayOpen,
  });
  const windowFocused = useWindowFocused(
    bindings.app.projection.windowFocused(),
    bindings.app.events.subscribeWindowFocus,
  );
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.topbarUnreadCount(notificationQueryIdentityRef),
    queryFn: async () => loadNimiRealmNotificationUnreadCount(bindings.sdk.realm()),
    enabled: props.authStatus === 'authenticated' && Boolean(notificationIdentityRef),
    staleTime: 15_000,
    refetchInterval: windowFocused ? 30_000 : false,
  });

  const unreadCount = unreadCountQuery.data?.total ?? 0;
  const unreadBadge = unreadCount > 99 ? '99+' : String(unreadCount);
  const integrationsRailActive = props.activeTab === 'home' && homeEntryDestination === 'integrations';

  const updateSettingsMenuPosition = useCallback(() => {
    const triggerRect = settingsTriggerRef.current?.getBoundingClientRect();
    if (!triggerRect) {
      setSettingsMenuPosition({ bottom: 16, left: 84 });
      return;
    }
    const viewportHeight = bindings.app.projection.viewportHeight();
    setSettingsMenuPosition({
      bottom: Math.max(12, Math.round(viewportHeight - triggerRect.bottom)),
      left: Math.max(12, Math.round(triggerRect.right + 12)),
    });
  }, [bindings]);

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
      props.onNav('settings');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'support') {
      props.onNav('support');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'logout') {
      setPendingAccountAction('logout');
      setSettingsMenuOpen(false);
    }
  };

  const openNotificationsFromSidebar = () => {
    props.onNav('notification');
  };
  const toggleSettingsMenuFromSidebar = () => {
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
      // Decorative halos extend beyond the viewport. Clip without creating a
      // scroll container, so descendant focus/scrollIntoView cannot move the shell.
      className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-clip bg-[var(--nimi-surface-canvas)]"
    >
      <ExecutionNotificationPreferenceSync />
      <div
        className="relative z-10 flex min-h-0 flex-1 gap-3 px-3 pb-3 pt-3"
      >
        {hidePrimaryRail || isAnonymousShell || !railVisible ? null : (
          <aside
            data-testid={E2E_IDS.shellSidebarRail}
            className={`flex h-full shrink-0 flex-col ${sidebarWidthClass}`}
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
                  data-nimi-semantic-id="desktop-main-shell-primary"
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
                      active={navigationColumn === item.id}
                      collapsed
                      onClick={() => props.onNav(item.id)}
                    />
                  ))}
                  {/* Integrations keeps its Home-owned destination below Cloud. */}
                  <NavLink
                    item={{ id: 'integrations', label: t('Integrations.title'), icon: <Plug size={18} /> }}
                    active={integrationsRailActive}
                    collapsed
                    testId="integrations-rail-entry"
                    onClick={() => navigation.push({ id: 'home', homeSection: 'integrations' })}
                  />
                  {quickNavItems.map((item) => (
                    <NavLink
                      key={item.id}
                      item={item}
                      active={navigationColumn === item.id}
                      collapsed
                      onClick={() => props.onNav(item.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </nav>
            <div className="flex shrink-0 flex-col items-center gap-2 pb-3">
              <ProductUpdateNotice />
              <GlobalDownloadsNavigation selected={props.activeTab === 'downloads'} onOpen={() => props.onNav('downloads')} />
              <Tooltip
                content={t('Navigation.notifications')}
                placement="right"
                contentClassName={SHELL_CHROME_TOOLTIP_CLASS}
              >
                <motion.button
                  type="button"
                  onClick={openNotificationsFromSidebar}
                  whileHover={interactiveMotion.whileHover}
                  whileTap={interactiveMotion.whileTap}
                  transition={interactiveMotion.transition}
                  className={`relative flex h-11 w-11 items-center justify-center transition-colors ${SHELL_CHROME_INTERACTIVE_RADIUS_CLASS} ${
                    props.activeTab === 'notification'
                      ? 'text-[var(--nimi-action-primary-bg)]'
                      : 'text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
                  }`}
                  aria-label={t('Common.openNotifications')}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  {unreadCount > 0 ? (
                    unreadCount > 1 ? (
                      <span className="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full border-2 border-[color:var(--nimi-surface-canvas)] bg-[var(--nimi-status-danger)] px-1 text-[10px] leading-[14px] text-white">
                        {unreadBadge}
                      </span>
                    ) : (
                      <span className="absolute right-1 top-1.5 h-2 w-2 rounded-full border-2 border-[color:var(--nimi-surface-canvas)] bg-[var(--nimi-status-danger)]" />
                    )
                  ) : null}
                </motion.button>
              </Tooltip>
              <Tooltip
                content={t('Common.openAccountMenu')}
                placement="right"
                contentClassName={SHELL_CHROME_TOOLTIP_CLASS}
              >
                <div ref={settingsTriggerRef} className="flex h-11 items-center">
                  <motion.button
                    type="button"
                    data-testid="desktop-account-menu-trigger"
                    onClick={toggleSettingsMenuFromSidebar}
                    whileHover={interactiveMotion.whileHover}
                    whileTap={interactiveMotion.whileTap}
                    transition={interactiveMotion.transition}
                    className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-black/5 bg-white p-0 text-[var(--nimi-text-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-transform duration-150 hover:scale-[1.03]"
                    aria-label={t('Common.openAccountMenu')}
                    aria-expanded={settingsMenuOpen}
                  >
                    {avatarNode}
                  </motion.button>
                </div>
              </Tooltip>
            </div>
          </aside>
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <OfflineShellStrip />
          <NimiToaster />

          <MainLayoutPanelStack
            activeTab={props.activeTab}
            exploreActiveSection={exploreActiveSection}
            exploreSearchText={exploreSearchText}
            homeFeedScope={homeFeedScope}
            runtimeActive={runtimeActive}
            runtimeEverMounted={runtimeEverMounted}
            onHomeFeedScopeChange={setHomeFeedScope}
            onExploreSectionChange={section => void navigation.push({ id: 'explore', exploreSection: section, search: destination.search ?? '', worldSearch: destination.worldSearch, worldTopicId: destination.worldTopicId })}
            onExploreSearchTextChange={search => void navigation.replace({ id: 'explore', exploreSection: destination.exploreSection ?? 'worlds', search, exploreWorldId: destination.exploreWorldId, worldSearch: destination.worldSearch, worldTopicId: destination.worldTopicId })}
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
            className="fixed z-[11010]"
            style={{
              bottom: settingsMenuPosition.bottom,
              left: settingsMenuPosition.left,
            }}
          >
            <MainLayoutSettingsMenu
              userAvatarUrl={props.userAvatarUrl}
              displayName={props.displayName}
              userEmail={props.userEmail}
              isItemActive={isSettingsMenuItemActive}
              onOpenItem={openSettingsSubmenuItem}
              onEditProfile={() => {
              props.onNav('settings');
              setSettingsMenuOpen(false);
              }}
              onSwitchAccount={() => {
              setPendingAccountAction('switch-account');
              setSettingsMenuOpen(false);
              }}
              onLogout={() => {
              setPendingAccountAction('logout');
              setSettingsMenuOpen(false);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={pendingAccountAction !== null}
        title={
          pendingAccountAction === 'switch-account'
            ? t('Menu.switchAccountConfirmTitle', { defaultValue: 'Switch account?' })
            : t('Menu.logoutConfirmTitle', { defaultValue: 'Log out of your current account?' })
        }
        message={
          pendingAccountAction === 'switch-account'
            ? t('Menu.switchAccountConfirmBody', {
                defaultValue:
                  'You will be signed out of the current account and returned to the sign-in screen.',
              })
            : null
        }
        confirmLabel={
          pendingAccountAction === 'switch-account'
            ? t('Menu.switchAccountConfirmAction', { defaultValue: 'Switch account' })
            : t('Menu.logoutConfirmAction', { defaultValue: 'Log Out' })
        }
        cancelLabel={t('Common.cancel', { defaultValue: 'Cancel' })}
        confirmTone="primary"
        onConfirm={() => {
          const action = pendingAccountAction;
          setPendingAccountAction(null);
          if (action === 'switch-account') {
            props.onSwitchAccount();
          } else if (action === 'logout') {
            props.onLogout();
          }
        }}
        onClose={() => setPendingAccountAction(null)}
      />
    </AmbientBackground>
  );
}
