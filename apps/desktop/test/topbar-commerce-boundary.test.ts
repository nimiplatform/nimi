import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const mainLayoutViewSource = readWorkspaceFile('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');

test('topbar currency balances consume Kit commerce realm projection, not Desktop dataSync', () => {
  assert.match(mainLayoutViewSource, /loadRealmCurrencyBalances/);
  assert.match(mainLayoutViewSource, /from '@nimiplatform\/kit\/features\/commerce\/realm'/);
  assert.match(mainLayoutViewSource, /getDesktopRealmCommerceGiftService/);
  assert.match(mainLayoutViewSource, /queryFn:\s*async \(\) => loadRealmCurrencyBalances\(\{\s*service: getDesktopRealmCommerceGiftService\(\),\s*\}\)/);
  assert.doesNotMatch(mainLayoutViewSource, /dataSync\.loadCurrencyBalances/);
  assert.doesNotMatch(mainLayoutViewSource, /parseBalanceValue/);
});

test('topbar notification unread count consumes SDK Realm projection, not Desktop dataSync', () => {
  assert.match(mainLayoutViewSource, /loadNimiRealmNotificationUnreadCount/);
  assert.match(mainLayoutViewSource, /from '@nimiplatform\/sdk\/realm'/);
  assert.match(mainLayoutViewSource, /queryFn:\s*async \(\) => loadNimiRealmNotificationUnreadCount\(getDesktopRealm\(\)\)/);
  assert.match(mainLayoutViewSource, /const unreadCount = unreadCountQuery\.data\?\.total \?\? 0/);
  assert.doesNotMatch(mainLayoutViewSource, /dataSync\.loadNotificationUnreadCount/);
  assert.doesNotMatch(mainLayoutViewSource, /function parseUnreadCount/);
  assert.doesNotMatch(mainLayoutViewSource, /getPlatformClient\(\)\.realm/);
});
