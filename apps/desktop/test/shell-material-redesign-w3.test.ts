import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const homeViewSource = readWorkspaceFile('src/shell/renderer/features/home/home-view.tsx');
const homeFeedControlsSource = readWorkspaceFile('src/shell/renderer/features/home/home-feed-controls.tsx');
const exploreViewSource = readWorkspaceFile('src/shell/renderer/features/explore/explore-view.tsx');
const exploreSectionNavSource = readWorkspaceFile('src/shell/renderer/features/explore/explore-section-nav.tsx');
const mainLayoutTitlebarContentSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-titlebar-content.tsx');
const mainLayoutTopBarSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');
const notificationPanelSource = readWorkspaceFile('src/shell/renderer/features/notification/notification-panel.tsx');
const profilePanelSource = readWorkspaceFile('src/shell/renderer/features/profile/profile-panel.tsx');

test('W3 route redesign: home and explore adopt route-shell material hosts', () => {
  assert.doesNotMatch(homeViewSource, /Home\.pageTitle/);
  assert.match(homeViewSource, /max-w-\[760px\]/);
  assert.match(mainLayoutTitlebarContentSource, /<HomeFeedScopeNav[\s\S]*active=\{props\.homeFeedScope\}/);
  assert.match(homeFeedControlsSource, /data-testid="home-create-post-header-button"/);
  assert.doesNotMatch(homeViewSource, /viewportClassName="bg-gray-50"/);

  assert.doesNotMatch(exploreViewSource, /Explore\.pageTitle/);
  assert.match(mainLayoutTitlebarContentSource, /props\.activeTab === 'explore'/);
  assert.match(mainLayoutTitlebarContentSource, /<ExploreSectionNav[\s\S]*active=\{props\.exploreActiveSection\}[\s\S]*variant="topbar"/);
  assert.match(exploreSectionNavSource, /data-testid="explore-search-field"[\s\S]*type="search"/);
  assert.doesNotMatch(mainLayoutTopBarSource, /RetiredWorkspaceTabs/);
  assert.doesNotMatch(exploreViewSource, /className="flex min-h-0 flex-1 flex-col bg-\[var\(--nimi-sidebar-canvas\)\]"/);
});

test('W3 route redesign: notification and profile consume glass route shells', () => {
  assert.match(notificationPanelSource, /<Surface[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*NotificationPanel\.title/);
  assert.match(notificationPanelSource, /<DesktopCardSurface[\s\S]*key=\{item\.id\}[\s\S]*kind="promoted-glass"/);
  assert.doesNotMatch(notificationPanelSource, /className="flex min-h-0 flex-1 flex-col bg-white"/u);

  assert.match(profilePanelSource, /<Surface[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*<ProfileDetailView/);
  assert.doesNotMatch(profilePanelSource, /tone="canvas" padding="none" className="flex min-h-0 flex-1 flex-col rounded-none border-0"/u);
});
