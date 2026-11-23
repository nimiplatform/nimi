import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { AppPackageSourceClass } from '@nimiplatform/sdk/runtime/wire-types';
import { DesktopAIExecutionRoute, DesktopAIExecutionState } from '@nimiplatform/sdk/runtime/generated';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';
import { HomeAppsWorkbench } from '../src/shell/renderer/features/home/home-apps-workbench.js';
import { focusRunningDesktopApp, HomeActiveWorkCardView } from '../src/shell/renderer/features/home/home-active-work-card.js';
import { HOME_FOCUS_APP_WINDOW, parseHomeAppFocusRequest } from '../src/shell/shared/system-entry-types.js';
import {
  BUNDLED_ZHIYU_RECENT_KEY,
  buildHomeRecentAppsDock,
  HOME_RECENT_APPS_LIMIT,
} from '../src/shell/renderer/features/home/home-recent-apps-model.js';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection.js';

(globalThis as { React?: typeof React }).React = React;

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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

test('apps dock renders pure icons without visible names for artwork apps, preserves fallback label for monogram-only apps, and removes counts and catalog promo', async () => {
  await initI18n();
  await changeLocale('zh');
  const entries: DesktopAppsEntry[] = [
    makeEntry({
      appId: 'nimi.lab',
      displayName: 'Nimi Lab',
      localDevelopment: { selector: 'dev-lab' } as never,
      iconUrl: TINY_PNG,
      run: { state: 'running', launchSelector: [1], accessAvailable: true, accessReasonCode: '', message: '' },
    }),
    makeEntry({
      appId: 'storybook',
      displayName: 'Storybook',
      committedRelease: { sourceClass: AppPackageSourceClass.VERIFIED, version: '0.4.2', launchSelector: Uint8Array.of(2) } as never,
      iconUrl: null,
    }),
    makeEntry({
      appId: 'parentos',
      displayName: 'ParentOS',
      catalogTarget: { appId: 'parentos', policyBlocked: false, version: '1.0.0' } as never,
    }),
  ];

  const html = renderToStaticMarkup(
    <HomeAppsWorkbench
      focusGeneration="generation"
      entries={entries}
      iconUrls={new Map()}
      loading={false}
      unavailable={false}
      onOpenAllApps={() => {}}
      onOpenApp={() => {}}
    />,
  );
  assert.match(html, /data-testid="bundled-zhiyu"/);
  assert.match(html, /aria-label="打开织羽"/);
  assert.doesNotMatch(html, />织羽</, 'familiar bundled Zhiyu icon renders without a visible caption below');
  assert.match(html, /data-testid="home-app:nimi\.lab"/);
  assert.match(html, /aria-label="Nimi Lab · 运行中 · 聚焦窗口"/);
  assert.doesNotMatch(html, />Nimi Lab</, 'familiar app with custom icon omits visible text label');
  assert.match(html, /data-testid="home-app-running:nimi\.lab"/, 'running app shows dock indicator dot');
  assert.match(html, /data-testid="home-app-manage:nimi\.lab"/);
  assert.match(html, /data-testid="home-app-fallback-label:storybook"[^>]*>Storybook</, 'monogram-only app without artwork retains fallback label');
  assert.match(html, /data-testid="home-apps-more-tile"/);
  assert.doesNotMatch(html, /最近使用|精选目录应用|home-apps-spotlight|ParentOS/, 'counts, store promo, and uninstalled catalog entries stay out of Home dock');
});

test('apps dock directly launches installed or local-dev apps on click and opens detail only for blocked apps or manage/context actions', async () => {
  await initI18n();
  await changeLocale('zh');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent'] as const) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  const prevAct = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const { createRoot } = await import('react-dom/client');
  const launched: string[] = [];
  const openedDetail: string[] = [];
  let mutatedCount = 0;

  const entries: DesktopAppsEntry[] = [
    makeEntry({
      appId: 'nimi.lab',
      displayName: 'Nimi Lab',
      localDevelopment: { selector: 'dev-lab' } as never,
      iconUrl: TINY_PNG,
    }),
    makeEntry({
      appId: 'nimi.blocked',
      displayName: 'Blocked App',
      committedRelease: { sourceClass: AppPackageSourceClass.VERIFIED, version: '1.0.0', launchSelector: Uint8Array.of(9) } as never,
      catalogTarget: { appId: 'nimi.blocked', policyBlocked: true, version: '1.0.0' } as never,
      iconUrl: TINY_PNG,
    }),
  ];

  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <HomeAppsWorkbench
          focusGeneration="generation"
          entries={entries}
          iconUrls={new Map()}
          loading={false}
          unavailable={false}
          onOpenAllApps={() => {}}
          onOpenApp={(appId) => openedDetail.push(appId)}
          onLaunchApp={async (entry) => {
            launched.push(entry.identity.appId);
          }}
          onAppsMutated={() => {
            mutatedCount += 1;
          }}
        />,
      );
    });

    const labBtn = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="home-app:nimi.lab"]');
    assert.ok(labBtn);
    await act(async () => {
      labBtn.click();
    });
    assert.deepEqual(launched, ['nimi.lab']);
    assert.equal(mutatedCount, 1);
    assert.deepEqual(openedDetail, []);

    const blockedBtn = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="home-app:nimi.blocked"]');
    assert.ok(blockedBtn);
    await act(async () => {
      blockedBtn.click();
    });
    assert.deepEqual(launched, ['nimi.lab']);
    assert.deepEqual(openedDetail, ['nimi.blocked']);

    const manageBtn = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="home-app-manage:nimi.lab"]');
    assert.ok(manageBtn);
    await act(async () => {
      manageBtn.click();
    });
    assert.deepEqual(openedDetail, ['nimi.blocked', 'nimi.lab']);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = prevAct;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('both Home focus requests match the native command contract and require a focus acknowledgement', async () => {
  const globals = globalThis as Record<string, unknown>;
  const previousBridge = Object.getOwnPropertyDescriptor(globals, '__NIMI_ELECTRON_RUNTIME__');
  const previousWindow = Object.getOwnPropertyDescriptor(globals, 'window');
  const requests: ReturnType<typeof parseHomeAppFocusRequest>[] = [];
  let reply: unknown = { focused: true };
  globals.window = { __NIMI_HTML_BOOT_ID__: 'home-focus-test' };
  globals.__NIMI_ELECTRON_RUNTIME__ = { invoke: async (command: string, args: { payload: unknown }) => {
    if (command === 'log_renderer_event') return {};
    assert.equal(command, HOME_FOCUS_APP_WINDOW);
    requests.push(parseHomeAppFocusRequest(args.payload));
    return reply;
  } };
  try {
    const running = makeEntry({ appId: 'demo', displayName: 'Demo',
      run: { state: 'running', launchSelector: [17], accessAvailable: true, accessReasonCode: '', message: '' } });
    const installed = { ...running, committedRelease: { launchSelector: Uint8Array.of(17) } } as DesktopAppsEntry;
    const development = { ...running, localDevelopment: { selector: 'dev-project-demo' } } as DesktopAppsEntry;
    await focusRunningDesktopApp(installed, 'current');
    await focusRunningDesktopApp(development, 'current');
    assert.deepEqual(requests, [
      { generation: 'current', source: { kind: 'installed', launchSelector: [17] } },
      { generation: 'current', source: { kind: 'local-development', selector: 'dev-project-demo' } },
    ]);
    await assert.rejects(focusRunningDesktopApp(installed, null), /focus-unavailable/);
    await assert.rejects(focusRunningDesktopApp({ ...development, run: null }, 'current'), /focus-unavailable/);
    assert.equal(requests.length, 2);
    reply = { state: 'running' };
    await assert.rejects(focusRunningDesktopApp(installed, 'current'), /focus-failed/);
  } finally {
    if (previousBridge) Object.defineProperty(globals, '__NIMI_ELECTRON_RUNTIME__', previousBridge);
    else delete globals.__NIMI_ELECTRON_RUNTIME__;
    if (previousWindow) Object.defineProperty(globals, 'window', previousWindow);
    else delete globals.window;
  }
});

test('recent apps dock caps at 8 slots with overflow tile, prioritizes running then MRU timestamps, and merges multi-source entries', async () => {
  await initI18n();
  await changeLocale('zh');

  const manyInstalled: DesktopAppsEntry[] = Array.from({ length: 24 }, (_, index) =>
    makeEntry({
      appId: `nimi.app-${index + 1}`,
      displayName: `App ${index + 1}`,
      updatedAtUnixMs: 1000 + index,
      committedRelease: { sourceClass: AppPackageSourceClass.VERIFIED, version: '1.0.0', launchSelector: Uint8Array.of(index + 1) } as never,
      iconUrl: TINY_PNG,
    }),
  );
  manyInstalled.push({
    ...makeEntry({
      appId: 'nimi.app-3',
      displayName: 'App 3',
      updatedAtUnixMs: 9999,
      localDevelopment: { selector: 'dev-3' } as never,
      iconUrl: TINY_PNG,
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
    committedRelease: { sourceClass: AppPackageSourceClass.VERIFIED, version: '1.0.0', launchSelector: Uint8Array.of(20) } as never,
    iconUrl: TINY_PNG,
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

  assert.equal(HOME_RECENT_APPS_LIMIT, 8);
  assert.equal(dock.items.length, HOME_RECENT_APPS_LIMIT - 1, 'reserves the 8th slot for the +N overflow tile');
  assert.equal(dock.overflowCount, 18, '25 total - 7 shown = 18 hidden');
  assert.equal(dock.totalCount, 25, '24 unique installed app groups + 1 bundled Zhiyu');
  assert.equal(dock.items[0]?.key, 'nimi.app-20', 'running app takes slot 1');
  assert.equal(dock.items[1]?.key, 'nimi.app-7', 'most recently opened app takes slot 2');
  assert.equal(dock.items[2]?.key, BUNDLED_ZHIYU_RECENT_KEY, 'second most recently opened item takes slot 3');
  assert.equal(dock.items[3]?.key, 'nimi.app-2', 'third most recently opened app takes slot 4');

  const html = renderToStaticMarkup(
    <HomeAppsWorkbench
      focusGeneration="generation"
      entries={manyInstalled}
      iconUrls={new Map()}
      loading={false}
      unavailable={false}
      onOpenAllApps={() => {}}
      onOpenApp={() => {}}
    />,
  );
  assert.match(html, /data-testid="home-apps-overflow-tile"/);
  assert.match(html, /data-overflow-count="18"/);
  assert.match(html, /\+18/);
  assert.match(html, /aria-label="还有 18 款应用，查看全部应用"/);
  assert.doesNotMatch(html, /data-testid="home-apps-more-tile"/);
  assert.doesNotMatch(html, /最近打开|共 25 款/);

  const exactFit = manyInstalled.slice(0, 7);
  const exactDock = buildHomeRecentAppsDock({
    entries: exactFit,
    timestamps: {},
    bundledZhiyuName: '织羽',
  });
  assert.equal(exactDock.items.length, 8);
  assert.equal(exactDock.overflowCount, 0);
  const exactHtml = renderToStaticMarkup(
    <HomeAppsWorkbench
      focusGeneration="generation"
      entries={exactFit}
      iconUrls={new Map()}
      loading={false}
      unavailable={false}
      onOpenAllApps={() => {}}
      onOpenApp={() => {}}
    />,
  );
  assert.doesNotMatch(exactHtml, /data-testid="home-apps-overflow-tile"/);
  assert.match(exactHtml, /data-testid="home-apps-more-tile"/);
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
