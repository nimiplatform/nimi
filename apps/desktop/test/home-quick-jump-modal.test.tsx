import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { initI18n, changeLocale, i18n } from '../src/shell/renderer/i18n/index.js';
import {
  buildHomeQuickJumpItems,
  filterHomeQuickJumpItems,
  type HomeQuickJumpActions,
} from '../src/shell/renderer/features/home/home-quick-jump-modal.js';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';

(globalThis as { React?: typeof React }).React = React;

const NOOP_ACTIONS: HomeQuickJumpActions = {
  onOpenZhiyu: () => {},
  onOpenHarness: () => {},
  onOpenApp: () => {},
  onOpenPartner: () => {},
  onOpenCapability: () => {},
  onOpenExplore: () => {},
  onOpenApps: () => {},
  onOpenModelLibrary: () => {},
  onOpenAIProfiles: () => {},
  onOpenCloud: () => {},
  onOpenConnections: () => {},
  onOpenIntegrations: () => {},
  onOpenDownloads: () => {},
  onOpenAIActivity: () => {},
  onOpenTroubleshooting: () => {},
  onOpenDataStorage: () => {},
};

test('quick jump builds read-only navigation items across apps, partners, capabilities, and settings and filters by keyword', async () => {
  await initI18n();
  await changeLocale('zh');
  const appEntry = {
    identity: { entryKey: 'verified:storybook', appId: 'storybook', sourceClass: 'verified', displayName: 'Storybook', updatedAtUnixMs: 1 },
    catalogTarget: null,
    localDevelopment: null,
    committedRelease: { version: '1.0.0' },
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: '互动故事创作',
  } as unknown as DesktopAppsEntry;

  const items = buildHomeQuickJumpItems({
    t: i18n.t.bind(i18n),
    apps: [appEntry],
    partners: Array.from({ length: 13 }, (_, index) => ({
      localAgentRef: index === 12 ? 'agent:wenhe' : `agent:${index}`,
      runtimeSourceRef: `src:${index}`,
      ownerUserId: 'u1',
      displayName: index === 12 ? '温荷' : `Partner ${index}`,
      sourceKey: `source-${index}`,
      sourceRef: {
        kind: 'personaCharacter', id: `partner-${index}`, worldId: 'world', ownerAccountId: 'u1', sourceHash: 'a'.repeat(64),
      },
    })),
    actions: NOOP_ACTIONS,
  });

  assert.ok(items.some((item) => item.id === 'app:zhiyu'));
  assert.ok(items.some((item) => item.id === 'app:storybook'));
  assert.ok(items.some((item) => item.id === 'partner:agent:wenhe'));
  assert.ok(items.some((item) => item.id === 'page:ai-activity'));
  assert.equal(filterHomeQuickJumpItems(items, '').filter((item) => item.group === 'partners').length, 12);
  assert.deepEqual(filterHomeQuickJumpItems(items, '温荷').map((item) => item.id), ['partner:agent:wenhe']);

  const bySpend = filterHomeQuickJumpItems(items, '花销');
  assert.equal(bySpend.length, 1);
  assert.equal(bySpend[0]?.id, 'page:ai-activity');

  const byStory = filterHomeQuickJumpItems(items, '互动故事');
  assert.equal(byStory.length, 1);
  assert.equal(byStory[0]?.id, 'app:storybook');
});

test('quick jump selects the bundled and local-development Zhiyu entries independently', async () => {
  await initI18n();
  const t = i18n.t.bind(i18n);
  const selected: string[] = [];
  const localEntry = {
    identity: { entryKey: 'local:zhiyu', appId: 'nimi.zhiyu', displayName: t('Apps.bundled.zhiyu') },
    localDevelopment: { selector: 'local-zhiyu' },
  } as unknown as DesktopAppsEntry;
  const items = buildHomeQuickJumpItems({
    t,
    apps: [localEntry],
    partners: [],
    actions: {
      ...NOOP_ACTIONS,
      onOpenZhiyu: () => selected.push('bundled'),
      onOpenApp: (id, key) => selected.push(`${id}/${key}`),
    },
  });

  const [bundled, local] = filterHomeQuickJumpItems(items, 'nimi.zhiyu');
  assert.equal(bundled?.badge, t('runtimeConfig.overview.appsWorkbench.builtInBadge'));
  assert.equal(local?.badge, t('Apps.sourceBadge.devTag'));
  bundled.onSelect();
  local.onSelect();
  assert.deepEqual(selected, ['bundled', 'nimi.zhiyu/local:zhiyu']);
});
