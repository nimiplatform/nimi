import { Suspense, lazy, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AppTab } from '@renderer/app-shell/providers/app-store';
import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import type { ExploreSectionId } from '@renderer/features/explore/explore-section-nav';
import { loadWorldDetailPanelModule, WorldDetailRouteLoading } from '@renderer/features/world/world-detail-route-state';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  DESKTOP_PANEL_VARIANTS,
  useDesktopPanelCustom,
} from '@renderer/ui/motion/desktop-motion';

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
const SourceDetailPanel = lazy(async () => {
  const mod = await import('@renderer/features/source-detail/source-detail-panel');
  return { default: mod.SourceDetailPanel };
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

type MainLayoutPanelStackProps = {
  activeTab: AppTab;
  developerModeEnabled: boolean;
  exploreActiveSection: ExploreSectionId;
  exploreSearchText: string;
  homeCreatePostRequestKey: number;
  homeFeedScope: NimiRealmFeedScope;
  runtimeActive: boolean;
  runtimeEverMounted: boolean;
};

function MotionPanelFrame({
  panelId,
  className = 'flex min-h-0 flex-1 flex-col',
  children,
}: {
  panelId: string;
  className?: string;
  children: ReactNode;
}) {
  const motionCustom = useDesktopPanelCustom();
  return (
    <motion.div
      key={panelId}
      data-testid={E2E_IDS.panel(panelId)}
      className={className}
      custom={motionCustom}
      variants={DESKTOP_PANEL_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

export function MainLayoutPanelStack({
  activeTab,
  developerModeEnabled,
  exploreActiveSection,
  exploreSearchText,
  homeCreatePostRequestKey,
  homeFeedScope,
  runtimeActive,
  runtimeEverMounted,
}: MainLayoutPanelStackProps) {
  return (
    <>
      {runtimeEverMounted ? (
        <Suspense fallback={<div className="flex min-h-0 flex-1" />}>
          <div
            data-testid={E2E_IDS.panel('runtime')}
            className={`min-h-0 flex-1 flex-col ${runtimeActive ? 'flex' : 'hidden'}`}
          >
            <RuntimeConfigPanelBody />
          </div>
        </Suspense>
      ) : null}

      <Suspense fallback={activeTab === 'world-detail' ? <WorldDetailRouteLoading /> : <div className="flex min-h-0 flex-1" />}>
        <AnimatePresence mode="wait" initial={false}>
        {activeTab === 'home' ? (
          <MotionPanelFrame panelId="home">
            <HomePanel
              createPostRequestKey={homeCreatePostRequestKey}
              feedScope={homeFeedScope}
            />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'chat' ? (
          <MotionPanelFrame panelId="chat" className="flex min-h-0 flex-1">
            <ChatPage />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'explore' ? (
          <MotionPanelFrame panelId="explore">
            <ExplorePanel
              activeSection={exploreActiveSection}
              searchText={exploreSearchText}
            />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'apps' ? (
          <MotionPanelFrame panelId="apps">
            <AppsPanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'notification' ? (
          <MotionPanelFrame panelId="notification">
            <NotificationPanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'gift-inbox' ? (
          <MotionPanelFrame panelId="gift-inbox">
            <GiftInboxPanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'settings' ? (
          <MotionPanelFrame panelId="settings">
            <SettingsPanelBody />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'support' ? (
          <MotionPanelFrame panelId="support">
            <SupportPanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'profile' ? (
          <MotionPanelFrame panelId="profile">
            <ProfilePanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'source-detail' ? (
          <MotionPanelFrame panelId="source-detail">
            <SourceDetailPanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'world-detail' ? (
          <MotionPanelFrame panelId="world-detail">
            <WorldDetailPanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'developer-tools' && developerModeEnabled ? (
          <MotionPanelFrame panelId="developer-tools">
            <DeveloperToolsPanel />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'privacy-policy' ? (
          <MotionPanelFrame panelId="privacy-policy">
            <PrivacyPolicyView />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'terms-of-service' ? (
          <MotionPanelFrame panelId="terms-of-service">
            <TermsOfServiceView />
          </MotionPanelFrame>
        ) : null}
        </AnimatePresence>
      </Suspense>
    </>
  );
}
