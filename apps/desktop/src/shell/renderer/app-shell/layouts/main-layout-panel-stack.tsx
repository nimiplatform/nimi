import { Suspense, lazy } from 'react';
import type { AppTab } from '@renderer/app-shell/providers/app-store';
import type { NimiRealmFeedScope } from '@nimiplatform/sdk/realm';
import type { ExploreSectionId } from '@renderer/features/explore/explore-section-nav';
import { loadWorldDetailPanelModule, WorldDetailRouteLoading } from '@renderer/features/world/world-detail-route-state';
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
            className="flex min-h-0 flex-1 flex-col"
            style={{ display: runtimeActive ? undefined : 'none' }}
          >
            <RuntimeConfigPanelBody />
          </div>
        </Suspense>
      ) : null}

      <Suspense fallback={activeTab === 'world-detail' ? <WorldDetailRouteLoading /> : <div className="flex min-h-0 flex-1" />}>
        {activeTab === 'home' ? (
          <div data-testid={E2E_IDS.panel('home')} className="flex min-h-0 flex-1 flex-col">
            <HomePanel
              createPostRequestKey={homeCreatePostRequestKey}
              feedScope={homeFeedScope}
            />
          </div>
        ) : null}

        {activeTab === 'chat' ? (
          <div data-testid={E2E_IDS.panel('chat')} className="flex min-h-0 flex-1">
            <ChatPage />
          </div>
        ) : null}

        {activeTab === 'explore' ? (
          <div data-testid={E2E_IDS.panel('explore')} className="flex min-h-0 flex-1 flex-col">
            <ExplorePanel
              activeSection={exploreActiveSection}
              searchText={exploreSearchText}
            />
          </div>
        ) : null}

        {activeTab === 'apps' ? (
          <div data-testid={E2E_IDS.panel('apps')} className="flex min-h-0 flex-1 flex-col">
            <AppsPanel />
          </div>
        ) : null}

        {activeTab === 'notification' ? (
          <div data-testid={E2E_IDS.panel('notification')} className="flex min-h-0 flex-1 flex-col">
            <NotificationPanel />
          </div>
        ) : null}

        {activeTab === 'gift-inbox' ? (
          <div data-testid={E2E_IDS.panel('gift-inbox')} className="flex min-h-0 flex-1 flex-col">
            <GiftInboxPanel />
          </div>
        ) : null}

        {activeTab === 'settings' ? (
          <div data-testid={E2E_IDS.panel('settings')} className="flex min-h-0 flex-1 flex-col">
            <SettingsPanelBody />
          </div>
        ) : null}

        {activeTab === 'support' ? (
          <div data-testid={E2E_IDS.panel('support')} className="flex min-h-0 flex-1 flex-col">
            <SupportPanel />
          </div>
        ) : null}

        {activeTab === 'profile' ? (
          <div data-testid={E2E_IDS.panel('profile')} className="flex min-h-0 flex-1 flex-col">
            <ProfilePanel />
          </div>
        ) : null}

        {activeTab === 'agent-detail' ? (
          <div data-testid={E2E_IDS.panel('agent-detail')} className="flex min-h-0 flex-1 flex-col">
            <AgentDetailPanel />
          </div>
        ) : null}

        {activeTab === 'world-detail' ? (
          <div data-testid={E2E_IDS.panel('world-detail')} className="flex min-h-0 flex-1 flex-col">
            <WorldDetailPanel />
          </div>
        ) : null}

        {activeTab === 'developer-tools' && developerModeEnabled ? (
          <div data-testid={E2E_IDS.panel('developer-tools')} className="flex min-h-0 flex-1 flex-col">
            <DeveloperToolsPanel />
          </div>
        ) : null}

        {activeTab === 'privacy-policy' ? (
          <div data-testid={E2E_IDS.panel('privacy-policy')} className="flex min-h-0 flex-1 flex-col">
            <PrivacyPolicyView />
          </div>
        ) : null}

        {activeTab === 'terms-of-service' ? (
          <div data-testid={E2E_IDS.panel('terms-of-service')} className="flex min-h-0 flex-1 flex-col">
            <TermsOfServiceView />
          </div>
        ) : null}
      </Suspense>
    </>
  );
}
