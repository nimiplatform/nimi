import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesktopAIExecutionRoute, DesktopAIExecutionState } from '@nimiplatform/sdk/runtime/generated';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { HomeAppsWorkbench } from '../src/shell/renderer/features/home/home-apps-workbench.js';
import { HomeActiveWorkCardView } from '../src/shell/renderer/features/home/home-active-work-card.js';
import {
  BUNDLED_ZHIYU_RECENT_KEY,
  buildHomeRecentAppsDock,
  HOME_RECENT_APPS_LIMIT,
} from '../src/shell/renderer/features/home/home-recent-apps-model.js';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';

(globalThis as { React?: typeof React }).React = React;

function makeEntry(overrides: Partial<DesktopAppsEntry> & { appId: string; displayName: string; updatedAtUnixMs?: number }): DesktopAppsEntry {
  const { appId, displayName, updatedAtUnixMs = 1, ...rest } = overrides;
  return {
    identity: {
      entryKey: `verified:${appId}`,
      appId,
      sourceClass: 'verified',
      displayName,
      updatedAtUnixMs,
    },
    catalogTarget: null,
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
    ...rest,
  };
}

test('apps workbench unifies bundled Zhiyu, running apps with focus action, and catalog spotlight when few apps are installed', async () => {
  await initI18n();
  await changeLocale('zh');
  const entries: DesktopAppsEntry[] = [
    makeEntry({
      appId: 'storybook',
      displayName: 'Storybook',
      committedRelease: { version: '0.4.2' } as never,
      run: { state: 'running', launchSelector: [1], accessAvailable: true, accessReasonCode: '', message: '' },
    }),
    makeEntry({
      appId: 'parentos',
      displayName: 'ParentOS',
      catalogTarget: { appId: 'parentos', policyBlocked: false, version: '1.0.0' } as never,
    }),
    makeEntry({
      appId: 'overtone',
      displayName: 'Nimi Overtone',
      catalogTarget: { appId: 'overtone', policyBlocked: false, version: '0.2.0' } as never,
    }),
  ];

  const html = renderToStaticMarkup(
    <HomeAppsWorkbench
      entries={entries}
      iconUrls={new Map()}
      loading={false}
      unavailable={false}
      onOpenAllApps={() => {}}
      onOpenApp={() => {}}
    />,
  );
  assert.match(html, /data-testid="bundled-zhiyu"/);
  assert.match(html, /织羽/);
  assert.match(html, /内置/);
  assert.match(html, /data-testid="home-app:storybook"/);
  assert.match(html, /运行中 · 聚焦窗口/);
  assert.match(html, /data-testid="home-app-manage:storybook"/);
  assert.match(html, /data-testid="home-apps-spotlight"/);
  assert.match(html, /data-testid="home-app-spotlight:parentos"/);
  assert.match(html, /data-testid="home-app-spotlight:overtone"/);
});

test('recent apps dock caps at 10 items, prioritizes running then MRU timestamps, and merges multi-source entries', async () => {
  await initI18n();
  await changeLocale('zh');

  const manyInstalled: DesktopAppsEntry[] = Array.from({ length: 24 }, (_, index) =>
    makeEntry({
      appId: `nimi.app-${index + 1}`,
      displayName: `App ${index + 1}`,
      updatedAtUnixMs: 1000 + index,
      committedRelease: { version: '1.0.0' } as never,
    }),
  );
  // Add a duplicate localDevelopment source for app-3 and a running state for app-20.
  manyInstalled.push({
    ...makeEntry({
      appId: 'nimi.app-3',
      displayName: 'App 3',
      updatedAtUnixMs: 9999,
      localDevelopment: { selector: 'dev-3' } as never,
    }),
    identity: {
      entryKey: 'local_dev:nimi.app-3',
      appId: 'nimi.app-3',
      sourceClass: 'local_development' as never,
      displayName: 'App 3',
      updatedAtUnixMs: 9999,
    },
  });
  manyInstalled[19] = makeEntry({
    appId: 'nimi.app-20',
    displayName: 'App 20',
    updatedAtUnixMs: 1020,
    committedRelease: { version: '1.0.0' } as never,
    run: { state: 'running', launchSelector: [20], accessAvailable: true, accessReasonCode: '', message: '' },
  });

  const dock = buildHomeRecentAppsDock({
    entries: manyInstalled,
    timestamps: {
      'nimi.app-7': 500_000,
      [BUNDLED_ZHIYU_RECENT_KEY]: 400_000,
      'nimi.app-2': 300_000,
    },
    bundledZhiyuName: '织羽',
  });

  assert.equal(dock.items.length, HOME_RECENT_APPS_LIMIT);
  assert.equal(dock.totalCount, 25, '24 unique installed app groups + 1 bundled Zhiyu');
  assert.equal(dock.items[0]?.key, 'nimi.app-20', 'running app takes slot 1');
  assert.equal(dock.items[1]?.key, 'nimi.app-7', 'most recently opened app takes slot 2');
  assert.equal(dock.items[2]?.key, BUNDLED_ZHIYU_RECENT_KEY, 'second most recently opened item takes slot 3');
  assert.equal(dock.items[3]?.key, 'nimi.app-2', 'third most recently opened app takes slot 4');

  const html = renderToStaticMarkup(
    <HomeAppsWorkbench
      entries={manyInstalled}
      iconUrls={new Map()}
      loading={false}
      unavailable={false}
      onOpenAllApps={() => {}}
      onOpenApp={() => {}}
    />,
  );
  assert.match(html, /最近打开 10 \/ 共 25 款/);
  assert.doesNotMatch(html, /data-testid="home-apps-spotlight"/, 'catalog spotlight hides when user already has >= 3 apps');
});

test('active work card hides when idle and renders running apps, AI executions, and transfer progress when active', async () => {
  await initI18n();
  await changeLocale('zh');
  assert.equal(
    renderToStaticMarkup(
      <HomeActiveWorkCardView
        runningApps={[]}
        iconUrls={new Map()}
        executions={[]}
        downloads={[]}
        focusingKey={null}
        onFocusApp={() => {}}
        onOpenApp={() => {}}
        onOpenActivity={() => {}}
        onOpenDownloads={() => {}}
      />,
    ),
    '',
  );

  const runningApp = makeEntry({
    appId: 'vane',
    displayName: 'Vane',
    committedRelease: { version: '1.0.0' } as never,
    run: { state: 'running', launchSelector: [2], accessAvailable: true, accessReasonCode: '', message: '' },
  });
  const activeHtml = renderToStaticMarkup(
    <HomeActiveWorkCardView
      runningApps={[runningApp]}
      iconUrls={new Map()}
      executions={[{
        attemptId: 'att-1',
        sourceKind: 'app',
        sourceLabel: 'Vane',
        capability: 'text.generate',
        route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL,
        state: DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING,
        models: [{ providerId: 'local', modelId: 'qwen', displayName: 'Qwen2.5', role: 'primary' }],
        parentWorkKind: '',
        parentWorkId: '',
      }]}
      downloads={[{
        id: 'dl-1',
        title: 'Qwen2.5-7B-Instruct',
        bytesReceived: 512 * 1024 * 1024,
        bytesTotal: 1024 * 1024 * 1024,
        speedBytesPerSec: 16 * 1024 * 1024,
      }]}
      focusingKey={null}
      onFocusApp={() => {}}
      onOpenApp={() => {}}
      onOpenActivity={() => {}}
      onOpenDownloads={() => {}}
    />,
  );
  assert.match(activeHtml, /data-testid="home-active-work"/);
  assert.match(activeHtml, /data-testid="home-focus-app:vane"/);
  assert.match(activeHtml, /data-testid="home-active-execution:att-1"/);
  assert.match(activeHtml, /data-testid="home-active-download:dl-1"/);
  assert.match(activeHtml, />50%</);
});
