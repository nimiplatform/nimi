
import { Suspense, lazy, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import type { AppTab } from '../providers/app-store';
import type { ExploreSectionId } from '../../features/explore/explore-section-nav';
import { loadWorldDetailPanelModule, WorldDetailRouteLoading } from '../../features/world/world-detail-route-state';
import { E2E_IDS } from '../../testability/e2e-ids';
import { DESKTOP_PANEL_VARIANTS, useDesktopPanelCustom } from '../../ui/motion/desktop-motion';

const ExplorePanel = lazy(async () => {
  const mod = await import('../../features/explore/explore-panel');
  return { default: mod.ExplorePanel };
});
const ContactsPage = lazy(async () => ({ default: (await import('../../features/chat/contacts-page.js')).ContactsPage }));
const ConnectionsPanel = lazy(async () => ({ default: (await import('../../features/settings/connections-panel.js')).ConnectionsPanel }));
const AppsPanel = lazy(async () => {
  const mod = await import('../../features/apps/apps-panel');
  return { default: mod.AppsPanel };
});
const SettingsPanelBody = lazy(async () => {
  const mod = await import('../../features/settings/settings-panel-body');
  return { default: mod.SettingsPanelBody };
});
const RuntimeConfigPanelBody = lazy(async () => {
  const mod = await import('../../features/runtime-config/runtime-config-panel-view');
  return { default: mod.RuntimeConfigPanelBody };
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
const GlobalDownloadsView = lazy(async () => ({
  default: (await import('../../features/runtime-config/global-downloads-view')).GlobalDownloadsView,
}));
const NimiOverview = lazy(async () => ({
  default: (await import('../../features/home/nimi-overview')).NimiOverview,
}));
type MainLayoutPanelStackProps = {
  activeTab: AppTab;
  exploreActiveSection: ExploreSectionId;
  exploreSearchText: string;
  runtimeActive: boolean;
  runtimeEverMounted: boolean;
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
  const isPresent = useIsPresent();
  return (
    <motion.div
      key={panelId}
      data-testid={E2E_IDS.panel(panelId)}
      className={isPresent ? className : `${className} z-0 pointer-events-none`}
      inert={!isPresent}
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
  runtimeActive,
  runtimeEverMounted,
  onExploreSectionChange,
  onExploreSearchTextChange,
}: MainLayoutPanelStackProps) {

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {runtimeEverMounted ? (
        <Suspense fallback={<div className="flex min-h-0 flex-1" />}>
          <div
            data-testid={E2E_IDS.panel('runtime')}
            className={`min-h-0 flex-1 flex-col ${
              runtimeActive
                ? 'relative z-10 flex bg-[var(--nimi-surface-canvas)]'
                : 'hidden'
            }`}
          >
            <RuntimeConfigPanelBody />
          </div>
        </Suspense>
      ) : null}

      <Suspense
        fallback={
          activeTab === 'world-detail' ? <WorldDetailRouteLoading /> : <div className="flex min-h-0 flex-1" />
        }
      >
        <AnimatePresence initial={false}>
          {activeTab === 'downloads' ? (
            <MotionPanelFrame panelId="downloads">
              <GlobalDownloadsView />
            </MotionPanelFrame>
          ) : null}
          {activeTab === 'home' || activeTab === 'notification' ? (
            <MotionPanelFrame panelId={activeTab}>
              <NimiOverview />
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

          {activeTab === 'contacts' ? <MotionPanelFrame panelId="contacts"><ContactsPage /></MotionPanelFrame> : null}
          {activeTab === 'connections' ? <MotionPanelFrame panelId="connections"><ConnectionsPanel /></MotionPanelFrame> : null}
          {activeTab === 'apps' ? (
            <MotionPanelFrame panelId="apps">
              <AppsPanel />
            </MotionPanelFrame>
          ) : null}



          {activeTab === 'settings' ? (
            <MotionPanelFrame panelId="settings">
              <SettingsPanelBody />
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

        </AnimatePresence>
      </Suspense>
    </div>
  );
}
