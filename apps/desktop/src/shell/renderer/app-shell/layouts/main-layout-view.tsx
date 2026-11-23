import { useHomeAppActivity } from '../../features/system-entry/system-entry-context.js';
import { messageCenterActivities, unreadCompanionReplies } from '../../features/home/home-app-activity-model.js';
import { useHumanChatList } from '../../features/chat/use-human-chat-list.js';
import { openHomeSettings } from '../../features/settings/settings-entry.js';
import { useHomeNavigation, useHomeDestination } from '../providers/app-store.js';
import { homeNavigationColumn } from '../providers/home-navigation.js';
// @nimi-authority: rule.nimi.desktop.shell-ui.r023
import { ExecutionNotificationPreferenceSync } from '../../features/home/execution-notices.js';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  SHELL_CHROME_RAIL_ICON_SIZE,
  SHELL_CHROME_RAIL_ICON_STROKE_WIDTH,
  SHELL_CHROME_RAIL_ITEM_SIZE_CLASS,
  SHELL_CHROME_RAIL_SELECTED_BG_CLASS,
  SHELL_CHROME_RAIL_WIDTH_CLASS,
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
import {
  toggleHomeMessagesDrawer,
  useHomeMessagesDrawerOpen,
} from '../../features/home/home-messages-drawer-state.js';
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

  const destination = useHomeDestination();
  const homeEntryDestination = destination.homeSection ?? 'overview';
  const homeMessagesDrawerOpen = useHomeMessagesDrawerOpen();
  const isHomeOverview = destination.id === 'home' && homeEntryDestination === 'overview';
  const bellActive = props.activeTab === 'notification' || (isHomeOverview && homeMessagesDrawerOpen);
  const exploreActiveSection = destination.exploreSection ?? 'worlds';
  const exploreSearchText = destination.search ?? '';
  const railVisible = useAppStore(state => state.primaryRailVisible);
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
    left: 51,
  });
  const settingsTriggerRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const sidebarWidthClass = SHELL_CHROME_RAIL_WIDTH_CLASS;
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
  const showPrimaryRail = !hidePrimaryRail && !isAnonymousShell && railVisible;
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

  const messageActivity = useHomeAppActivity();
  const activityUnread = useMemo(() => messageCenterActivities(messageActivity.pending, messageActivity.recent)
    .some(record => record.userView.unread), [messageActivity.pending, messageActivity.recent]);
  const humanChats = useHumanChatList(props.authStatus);
  const hasUnreadCompanion = useMemo(() => unreadCompanionReplies(messageActivity.recent.records).size > 0, [messageActivity.recent.records]);
  const hasUnreadHumanChat = humanChats.data?.items.some(chat => chat.unreadCount > 0);
  const hasUnreadMessages = (unreadCountQuery.data?.total ?? 0) > 0 || activityUnread;
  const integrationsRailActive = props.activeTab === 'home' && homeEntryDestination === 'integrations';
  const homeRailActive = navigationColumn === 'home' && !integrationsRailActive;

  const updateSettingsMenuPosition = useCallback(() => {
    const triggerRect = settingsTriggerRef.current?.getBoundingClientRect();
    if (!triggerRect) {
      setSettingsMenuPosition({ bottom: 16, left: 51 });
      return;
    }
    const viewportHeight = bindings.app.projection.viewportHeight();
    setSettingsMenuPosition({
      bottom: Math.max(8, Math.round(viewportHeight - triggerRect.bottom)),
      left: Math.max(12, Math.round(triggerRect.right + 10)),
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
        event.preventDefault();
        setSettingsMenuOpen(false);
        settingsTriggerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
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

  useEffect(() => {
    if (!settingsMenuOpen) return;
    const frame = requestAnimationFrame(() => {
      settingsMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [settingsMenuOpen]);

  const avatarNode = (
    <EntityAvatar
      imageUrl={props.userAvatarUrl}
      name={props.displayName}
      kind="human"
      sizeClassName="h-6 w-6"
      className="shrink-0 ring-1 ring-black/8"
      textClassName="text-[11px]"
    />
  );
  const nimiHomeNode = (
    <img
      src={logoImage}
      alt="Nimi"
      className="relative z-10 h-5.5 w-5.5 shrink-0 object-contain mix-blend-multiply"
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
      void openHomeSettings(navigation);
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'support') {
      void openHomeSettings(navigation, 'troubleshooting');
      setSettingsMenuOpen(false);
      return;
    }
    if (itemId === 'logout') {
      setPendingAccountAction('logout');
      setSettingsMenuOpen(false);
    }
  };

  const openNotificationsFromSidebar = () => {
    if (isHomeOverview) {
      toggleHomeMessagesDrawer();
      return;
    }
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
        className={`relative z-10 flex min-h-0 flex-1 pr-2 ${
          showPrimaryRail ? 'gap-0 pl-0' : 'gap-3 py-2 pl-2.5'
        }`}
      >
        {!showPrimaryRail ? null : (
          <aside
            data-testid={E2E_IDS.shellSidebarRail}
            className={`flex h-full shrink-0 flex-col pb-3 pt-2.5 ${sidebarWidthClass}`}
          >
            <div className="flex shrink-0 items-center justify-center pb-1">
              <Tooltip
                content={t('Navigation.home', { defaultValue: 'Home' })}
                placement="right"
                contentClassName={SHELL_CHROME_TOOLTIP_CLASS}
              >
                <motion.button
                  type="button"
                  data-testid={E2E_IDS.navTab('home')}
                  data-nimi-semantic-id="desktop-main-shell-primary"
                  aria-current={homeRailActive ? 'page' : undefined}
                  whileHover={interactiveMotion.whileHover}
                  whileTap={interactiveMotion.whileTap}
                  transition={interactiveMotion.transition}
                  className={`relative flex ${SHELL_CHROME_RAIL_ITEM_SIZE_CLASS} items-center justify-center transition-colors duration-150 ${SHELL_CHROME_INTERACTIVE_RADIUS_CLASS} ${
                    homeRailActive
                      ? SHELL_CHROME_RAIL_SELECTED_BG_CLASS
                      : 'hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]'
                  }`}
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
            <nav className="flex min-h-0 flex-1 flex-col">
              <ScrollArea className="min-h-0 flex-1" viewportClassName="py-0">
                <div className="flex flex-col gap-1">
                  {primaryCoreNavItems.map((item) => (
                    <Fragment key={item.id}>
                      {item.id === 'runtime' ? (
                        <div role="separator" aria-hidden="true" className="mx-auto my-1 h-px w-5 bg-[var(--nimi-border-subtle)]" />
                      ) : null}
                      <NavLink
                        item={item}
                        active={navigationColumn === item.id}
                        collapsed
                        onClick={() => props.onNav(item.id)}
                      />
                    </Fragment>
                  ))}
                  {/* Integrations keeps its Home-owned destination below Cloud. */}
                  <NavLink
                    item={{ id: 'integrations', label: t('Integrations.title'), icon: <Plug size={SHELL_CHROME_RAIL_ICON_SIZE} strokeWidth={SHELL_CHROME_RAIL_ICON_STROKE_WIDTH} /> }}
                    active={integrationsRailActive}
                    collapsed
                    testId="integrations-rail-entry"
                    onClick={() => navigation.push({ id: 'home', homeSection: 'integrations' })}
                  />
                  {quickNavItems.length > 0 ? (
                    <div role="separator" aria-hidden="true" className="mx-auto my-1 h-px w-5 bg-[var(--nimi-border-subtle)]" />
                  ) : null}
                  {quickNavItems.map((item) => (
                    <NavLink
                      key={item.id}
                      badge={item.id === 'contacts' && (hasUnreadHumanChat || hasUnreadCompanion) ? t('Chat.rail.unreadChats') : undefined}
                      item={item}
                      active={navigationColumn === item.id}
                      collapsed
                      onClick={() => props.onNav(item.id)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </nav>
            <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
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
                  className={`relative flex ${SHELL_CHROME_RAIL_ITEM_SIZE_CLASS} items-center justify-center transition-colors ${SHELL_CHROME_INTERACTIVE_RADIUS_CLASS} ${
                    bellActive
                      ? `${SHELL_CHROME_RAIL_SELECTED_BG_CLASS} text-[var(--nimi-action-primary-bg)]`
                      : 'text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] hover:text-[var(--nimi-text-primary)]'
                  }`}
                  aria-label={t('Common.openNotifications')}
                  aria-expanded={isHomeOverview ? homeMessagesDrawerOpen : undefined}
                  aria-current={props.activeTab === 'notification' ? 'page' : undefined}
                >
                  <svg
                    width={SHELL_CHROME_RAIL_ICON_SIZE}
                    height={SHELL_CHROME_RAIL_ICON_SIZE}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={SHELL_CHROME_RAIL_ICON_STROKE_WIDTH}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  {hasUnreadMessages ? <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-[color:var(--nimi-surface-canvas)] bg-[var(--nimi-status-danger)]" role="status" aria-label={t('runtimeConfig.overview.messages.hasUnread')} /> : null}
                </motion.button>
              </Tooltip>
              <Tooltip
                content={t('Common.openAccountMenu')}
                placement="right"
                contentClassName={SHELL_CHROME_TOOLTIP_CLASS}
              >
                <div ref={settingsTriggerRef} className={`flex ${SHELL_CHROME_RAIL_ITEM_SIZE_CLASS} items-center justify-center`}>
                  <motion.button
                    type="button"
                    data-testid="desktop-account-menu-trigger"
                    onClick={toggleSettingsMenuFromSidebar}
                    whileHover={interactiveMotion.whileHover}
                    whileTap={interactiveMotion.whileTap}
                    transition={interactiveMotion.transition}
                    className={`flex ${SHELL_CHROME_RAIL_ITEM_SIZE_CLASS} items-center justify-center p-0 text-[var(--nimi-text-primary)] transition-colors duration-150 ${SHELL_CHROME_INTERACTIVE_RADIUS_CLASS} ${
                      settingsMenuOpen
                        ? SHELL_CHROME_RAIL_SELECTED_BG_CLASS
                        : 'hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]'
                    }`}
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

        <div
          className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${
            showPrimaryRail ? ' pb-2 pt-1' : ''
          }`}
        >
          <OfflineShellStrip />
          <NimiToaster />

          <MainLayoutPanelStack
            activeTab={props.activeTab}
            exploreActiveSection={exploreActiveSection}
            exploreSearchText={exploreSearchText}
            runtimeActive={runtimeActive}
            runtimeEverMounted={runtimeEverMounted}
            onExploreSectionChange={section => void navigation.push({ ...destination, id: 'explore', exploreSection: section,
              search: destination.search ?? '' })}
            onExploreSearchTextChange={search => void navigation.replace({ ...destination, id: 'explore', exploreSection: destination.exploreSection ?? 'worlds', search })}
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
            className="fixed z-[var(--nimi-z-popover)]"
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
              void openHomeSettings(navigation, 'profile');
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
