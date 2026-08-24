import { Suspense, lazy, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AppTab } from '../providers/app-store';
import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import type { ExploreSectionId } from '../../features/explore/explore-section-nav';
import { loadWorldDetailPanelModule, WorldDetailRouteLoading } from '../../features/world/world-detail-route-state';
import { E2E_IDS } from '../../testability/e2e-ids';
import {
  DESKTOP_PANEL_VARIANTS,
  useDesktopPanelCustom,
} from '../../ui/motion/desktop-motion';

const ChatPage = lazy(async () => {
  const mod = await import('../../features/chat/chat-page');
  return { default: mod.ChatPage };
});
const ExplorePanel = lazy(async () => {
  const mod = await import('../../features/explore/explore-panel');
  return { default: mod.ExplorePanel };
});
const AppsPanel = lazy(async () => {
  const mod = await import('../../features/apps/apps-panel');
  return { default: mod.AppsPanel };
});
const SettingsPanelBody = lazy(async () => {
  const mod = await import('../../features/settings/settings-panel-body');
  return { default: mod.SettingsPanelBody };
});
const SupportPanel = lazy(async () => {
  const mod = await import('../../features/support/support-panel');
  return { default: mod.SupportPanel };
});
const RuntimeConfigPanelBody = lazy(async () => {
  const mod = await import('../../features/runtime-config/runtime-config-panel-view');
  return { default: mod.RuntimeConfigPanelBody };
});
const NotificationPanel = lazy(async () => {
  const mod = await import('../../features/notification/notification-panel');
  return { default: mod.NotificationPanel };
});
const ProfilePanel = lazy(async () => {
  const mod = await import('../../features/profile/profile-panel');
  return { default: mod.ProfilePanel };
});
const SourceDetailPanel = lazy(async () => {
  const mod = await import('../../features/source-detail/source-detail-panel');
  return { default: mod.SourceDetailPanel };
});
const WorldDetailPanel = lazy(async () => {
  const mod = await loadWorldDetailPanelModule();
  return { default: mod.WorldDetailActivePanel };
});
const HomePanel = lazy(async () => {
  const mod = await import('../../features/home/home-panel');
  return { default: mod.HomePanel };
});
const PrivacyPolicyView = lazy(async () => {
  const mod = await import('../../features/legal/privacy-policy-view');
  return { default: mod.PrivacyPolicyView };
});
const TermsOfServiceView = lazy(async () => {
  const mod = await import('../../features/legal/terms-of-service-view');
  return { default: mod.TermsOfServiceView };
});

type MainLayoutPanelStackProps = {
  activeTab: AppTab;
  exploreActiveSection: ExploreSectionId;
  exploreSearchText: string;
  homeFeedScope: NimiRealmFeedScope;
  runtimeActive: boolean;
  runtimeEverMounted: boolean;
  onHomeFeedScopeChange: (scope: NimiRealmFeedScope) => void;
  onExploreSectionChange: (section: ExploreSectionId) => void;
  onExploreSearchTextChange: (value: string) => void;
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
  exploreActiveSection,
  exploreSearchText,
  homeFeedScope,
  runtimeActive,
  runtimeEverMounted,
  onHomeFeedScopeChange,
  onExploreSectionChange,
  onExploreSearchTextChange,
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
              feedScope={homeFeedScope}
              onFeedScopeChange={onHomeFeedScopeChange}
            />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'chat' ? (
          <MotionPanelFrame panelId="chat" className="flex h-full min-h-0 flex-1">
            <ChatPage />
          </MotionPanelFrame>
        ) : null}

        {activeTab === 'explore' ? (
          <MotionPanelFrame panelId="explore">
            <ExplorePanel
              activeSection={exploreActiveSection}
              searchText={exploreSearchText}
              onSectionChange={onExploreSectionChange}
              onSearchTextChange={onExploreSearchTextChange}
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
