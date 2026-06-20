import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  SETTINGS_SELECTED_STORAGE_KEY,
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from '../src/shell/renderer/features/settings/settings-storage.js';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktop(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function installMemoryLocalStorage(seed: Record<string, string> = {}): void {
  const store = new Map<string, string>(Object.entries(seed));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
}

function clearMemoryLocalStorage(): void {
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

test('desktop shell does not expose wallet from the topbar or account menu', () => {
  const topbarSource = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-topbar.tsx');
  const layoutViewSource = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-view.tsx');
  const settingsMenuSource = readDesktop('src/shell/renderer/app-shell/layouts/main-layout-settings-menu.tsx');

  assert.doesNotMatch(topbarSource, /Common\.openWallet|onOpenWallet|SHELL_TOPBAR_ASSET_CELL_CLASS/);
  assert.doesNotMatch(layoutViewSource, /topbar-currency-balances|openWalletFromTitlebar|persistStoredSettingsSelected\('wallet'\)/);
  assert.doesNotMatch(settingsMenuSource, /id:\s*'wallet'|Menu\.wallet/);
});

test('settings navigation and router keep wallet hidden and stale wallet selection cannot render it', () => {
  const settingsAssetsSource = readDesktop('src/shell/renderer/features/settings/settings-assets.tsx');
  const settingsPanelSource = readDesktop('src/shell/renderer/features/settings/settings-panel-body.tsx');
  const settingsPagesSource = readDesktop('src/shell/renderer/features/settings/settings-pages.tsx');

  assert.doesNotMatch(settingsAssetsSource, /id:\s*'wallet'/);
  assert.doesNotMatch(settingsPanelSource, /menuWallet|wallet:\s*'Settings\.menuWallet'/);
  assert.doesNotMatch(settingsPagesSource, /case\s+'wallet'/);

  installMemoryLocalStorage({
    [SETTINGS_SELECTED_STORAGE_KEY]: 'wallet',
  });
  try {
    assert.equal(loadStoredSettingsSelected('profile'), 'profile');

    persistStoredSettingsSelected('wallet');
    assert.equal(loadStoredSettingsSelected('profile'), 'profile');

    persistStoredSettingsSelected('notifications');
    assert.equal(loadStoredSettingsSelected('profile'), 'notifications');
  } finally {
    clearMemoryLocalStorage();
  }
});

test('gift surfaces do not route accepted gifts into the hidden wallet page', () => {
  const giftBubbleSource = readDesktop('src/shell/renderer/features/economy/gift-message-bubble.tsx');
  const giftInboxSource = readDesktop('src/shell/renderer/features/economy/gift-inbox-panel.tsx');

  assert.doesNotMatch(giftBubbleSource, /persistStoredSettingsSelected\('wallet'\)|GiftBubble\.openWallet/);
  assert.match(giftInboxSource, /walletActionVisible=\{false\}/);
  assert.doesNotMatch(giftInboxSource, /persistStoredSettingsSelected\('wallet'\)|onOpenWallet=\{openWallet\}|GiftInbox\.openWallet/);
});
