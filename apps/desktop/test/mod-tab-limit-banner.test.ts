import assert from 'node:assert/strict';
import test from 'node:test';
import { showModTabLimitBanner } from '../src/shell/renderer/mod-ui/host/mod-tab-limit-banner';

test('showModTabLimitBanner emits the configured warning and routes users to mods', () => {
  let captured:
    | {
        kind: 'warning';
        message: string;
        actionLabel: string;
        onAction: () => void;
      }
    | null = null;
  let activeTab: 'mods' | null = null;

  showModTabLimitBanner({
    setStatusBanner: (banner) => {
      captured = banner;
    },
    setActiveTab: (tab) => {
      activeTab = tab;
    },
  });

  assert.ok(captured);
  const banner = captured as {
    kind: 'warning';
    message: string;
    actionLabel: string;
    onAction: () => void;
  };
  assert.equal(banner.kind, 'warning');
  assert.equal(banner.message, '最多同时打开 5 个 Mod，请先关闭一个再继续。');
  assert.equal(banner.actionLabel, '前往 Mods');

  banner.onAction();
  assert.equal(activeTab, 'mods');
});
