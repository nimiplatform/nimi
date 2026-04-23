import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const homeViewSource = readWorkspaceFile('src/shell/renderer/features/home/home-view.tsx');
const exploreViewSource = readWorkspaceFile('src/shell/renderer/features/explore/explore-view.tsx');
const contactsViewSource = readWorkspaceFile('src/shell/renderer/features/contacts/contacts-view.tsx');
const notificationPanelSource = readWorkspaceFile('src/shell/renderer/features/notification/notification-panel.tsx');
const profilePanelSource = readWorkspaceFile('src/shell/renderer/features/profile/profile-panel.tsx');

test('W3 route redesign: home and explore adopt route-shell material hosts', () => {
  assert.match(homeViewSource, /<Surface[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*Home\.pageTitle/);
  assert.match(homeViewSource, /<Surface[\s\S]*as="button"[\s\S]*material="glass-regular"/);
  assert.doesNotMatch(homeViewSource, /viewportClassName="bg-gray-50"/);

  assert.match(exploreViewSource, /<Surface[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*Explore\.pageTitle/);
  assert.match(exploreViewSource, /<Surface[\s\S]*material="glass-thick"[\s\S]*type="search"/);
  assert.doesNotMatch(exploreViewSource, /className="flex min-h-0 flex-1 flex-col bg-\[var\(--nimi-sidebar-canvas\)\]"/);
});

test('W3 route redesign: contacts, notification, and profile consume glass route shells', () => {
  assert.match(contactsViewSource, /<SidebarShell[\s\S]*className="rounded-\[2rem\] border border-white\/60 border-r-\[color-mix\(in_srgb,var\(--nimi-border-subtle\)_82%,white\)\] bg-\[var\(--nimi-sidebar-canvas\)\] shadow-\[0_18px_44px_rgba\(15,23,42,0\.06\)\]"/);
  assert.match(contactsViewSource, /<Surface[\s\S]*as="main"[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-\[2rem\] border-white\/60 shadow-\[0_18px_44px_rgba\(15,23,42,0\.06\)\]"/);
  assert.doesNotMatch(contactsViewSource, /data-testid=\{E2E_IDS\.panel\('contacts'\)\} className="flex h-full bg-white/u);

  assert.match(notificationPanelSource, /<Surface[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*NotificationPanel\.title/);
  assert.match(notificationPanelSource, /<DesktopCardSurface[\s\S]*key=\{item\.id\}[\s\S]*kind="promoted-glass"/);
  assert.doesNotMatch(notificationPanelSource, /className="flex min-h-0 flex-1 flex-col bg-white"/u);

  assert.match(profilePanelSource, /<Surface[\s\S]*tone="panel"[\s\S]*material="glass-regular"[\s\S]*<ContactDetailView/);
  assert.doesNotMatch(profilePanelSource, /tone="canvas" padding="none" className="flex min-h-0 flex-1 flex-col rounded-none border-0"/u);
});
