/**
 * Apps panel library/detail render proof.
 *
 * Mounts AppsPanelView through the real i18n instance and asserts the loading,
 * error, empty, app-center grid, running-first ordering, and detail states
 * render with resolved copy. Effects do not run under `renderToStaticMarkup`,
 * so this covers static structure and translation wiring; live polling and
 * host actions are covered by the controller/projection tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ScrollArea / radix CJS primitives expect a global `React`.
(globalThis as { React?: typeof React }).React = React;

import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import {
  AppsPanelView,
  type AppsPanelViewProps,
} from '../src/shell/renderer/features/apps/apps-panel-view';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types';
import type { DesktopAppsEntry } from '../src/shell/renderer/features/apps/apps-panel-projection';
import {
  AppPackageJobKind,
  AppPackageJobPhase,
  AppPackageProgressBasis,
  AppPackageSourceClass,
  AppPackageTerminalResult,
  type AppPackageJob,
  type CommittedAppRelease,
} from '@nimiplatform/sdk/runtime/wire-types';

function registration(
  overrides: Partial<LocalDevelopmentRegistration> = {},
): LocalDevelopmentRegistration {
  return {
    selector: 'dev-project-example',
    appId: 'nimi.lab',
    displayName: 'Nimi Lab',
    canonicalProjectRoot: '/projects/nimi-lab',
    shell: 'electron',
    appAccess: ['realm.data', 'runtime.consume'],
    sourceGeneration: 1,
    declarationGeneration: 2,
    registeredAtUnixMs: 1_721_000_000_000,
    updatedAtUnixMs: 1_722_000_000_000,
    ...overrides,
  };
}

function entry(
  overrides: Partial<LocalDevelopmentRegistration> = {},
  runState: string | null = null,
): DesktopAppsEntry {
  const row = registration(overrides);
  const entryKey = `local_development:${row.appId}:${row.selector}`;
  return {
    identity: {
      entryKey,
      appId: row.appId,
      sourceClass: 'local_development',
      displayName: row.displayName,
      updatedAtUnixMs: row.updatedAtUnixMs,
    },
    localDevelopment: row,
    committedRelease: null,
    packageJob: null,
    run: runState === null
      ? null
      : {
        selector: row.selector,
        appId: row.appId,
        displayName: row.displayName,
        canonicalProjectRoot: row.canonicalProjectRoot,
        shell: row.shell,
        state: runState,
        message: '',
        retryable: false,
        hostGeneration: 1,
      },
    aiConfigSummary: null,
    summary: null,
  };
}

function installedRuntimeEntry(overrides: Partial<AppPackageJob> = {}): DesktopAppsEntry {
  const entry: DesktopAppsEntry = {
    identity: {
      entryKey: 'verified:example.catalog-app',
      appId: 'example.catalog-app',
      sourceClass: 'verified',
      displayName: 'example.catalog-app',
      updatedAtUnixMs: 1_788_134_400_000,
    },
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    summary: null,
  };
  const committedRelease: CommittedAppRelease = {
    appId: entry.identity.appId,
    sourceClass: AppPackageSourceClass.VERIFIED,
    version: '1.0.0',
    releaseRef: 'release:example:1.0.0',
    launchSelector: new Uint8Array([1]),
    committedAt: { seconds: '1788134400', nanos: 0 },
  };
  const packageJob: AppPackageJob = {
    jobId: new Uint8Array([1]),
    appId: entry.identity.appId,
    sourceClass: AppPackageSourceClass.VERIFIED,
    kind: AppPackageJobKind.UPDATE,
    targetRef: 'release:example:1.1.0',
    phase: AppPackageJobPhase.DOWNLOADING,
    progressBasis: AppPackageProgressBasis.BYTES,
    bytesCompleted: '50',
    bytesTotal: '100',
    stepsCompleted: '0',
    terminalResult: AppPackageTerminalResult.UNSPECIFIED,
    reasonCode: '',
    cancelable: true,
    ...overrides,
  };
  return { ...entry, committedRelease, packageJob };
}

const ENTRIES: DesktopAppsEntry[] = [
  entry(),
  entry({ selector: 'dev-project-zhiyu', appId: 'nimi.zhiyu', displayName: '织羽 Zhiyu' }),
];

function baseProps(overrides: Partial<AppsPanelViewProps> = {}): AppsPanelViewProps {
  return {
    projection: { status: 'loaded', entries: ENTRIES, catalogStatus: 'not-implemented', runtimeError: null },
    searchQuery: '',
    onSearchChange: () => {},
    selectedEntryKey: null,
    requestedDetailSection: null,
    requestedDetailNavigationRevision: 0,
    onCardAction: () => {},
    onBack: () => {},
    onOpenDeveloperMode: () => {},
    onRetry: () => {},
    onAIConfigChanged: () => {},
    actionError: null,
    activeAction: null,
    ...overrides,
  };
}

function renderView(props: AppsPanelViewProps): string {
  return renderToStaticMarkup(<AppsPanelView {...props} />);
}

test('Apps library renders the loading skeleton', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ projection: null }));
  assert.ok(markup.includes('data-testid="apps-panel-loading"'), 'expected loading skeleton');
});

test('Apps library fails visible on projection error with retry copy', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({
    projection: { status: 'error', detail: 'fixed Runtime service unavailable' },
  }));
  assert.ok(markup.includes('data-testid="apps-error"'), 'expected error alert');
  assert.ok(markup.includes('无法加载 Apps'), 'expected zh error copy');
  assert.ok(markup.includes('重试'), 'expected zh retry copy');
});

test('Apps library renders the empty state with the developer-mode action', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ projection: { status: 'loaded', entries: [], catalogStatus: 'not-implemented', runtimeError: null } }));
  assert.ok(markup.includes('data-testid="apps-empty-local-development"'), 'expected empty state');
  assert.ok(markup.includes('还没有接入应用'), 'expected zh empty title');
  assert.ok(markup.includes('打开开发者模式'), 'expected zh developer action');
});

test('Apps library renders the app-center header and App Store style list rows with resolved zh copy', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps());
  assert.ok(markup.includes('data-testid="apps-library-title"'), 'expected page title');
  assert.ok(markup.includes('应用中心'), 'expected app-center title copy');
  assert.ok(markup.includes('data-testid="apps-entry-list"'), 'expected entry collection');
  assert.ok(markup.includes('所有应用'), 'expected all-apps section title');
  assert.ok(markup.includes('2 个'), 'expected all-apps count copy');
  assert.ok(markup.includes('data-testid="apps-filter-all"'), 'expected all filter chip');
  assert.ok(markup.includes('data-testid="apps-filter-running"'), 'expected running filter chip');
  assert.ok(markup.includes('data-testid="apps-filter-attention"'), 'expected attention filter chip');
  assert.ok(markup.includes('全部'), 'expected all chip copy');
  assert.ok(markup.includes('需处理'), 'expected attention chip copy');
  assert.ok(markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example"'), 'expected first row');
  assert.ok(markup.includes('data-testid="apps-entry-local_development:nimi.zhiyu:dev-project-zhiyu"'), 'expected second row');
  assert.ok(markup.includes('Nimi Lab'), 'expected first display name');
  assert.ok(markup.includes('织羽 Zhiyu'), 'expected second display name');
  assert.equal(markup.includes('data-source-badge="local_development"'), false, 'local-development source tag hidden on rows');
  assert.equal(markup.includes('本地开发'), false, 'local-development source tag copy hidden on rows');
  assert.ok(markup.includes('linear-gradient'), 'expected generated artwork gradients');
  assert.ok(markup.includes('未运行'), 'expected stopped status copy on rows');
  assert.ok(markup.includes('启动'), 'expected launch action copy');
  assert.ok(markup.includes('data-testid="apps-connect-local"'), 'expected header add-app action');
  assert.ok(markup.includes('添加应用'), 'expected add-app action copy');
  assert.ok(markup.includes('搜索 App 或 App ID'), 'expected rail search placeholder');
  assert.ok(markup.includes('搜索已安装的应用'), 'expected library search placeholder');
  assert.ok(markup.includes('最近更新'), 'expected default sort copy');
  assert.equal(markup.includes('data-testid="apps-frequent-section"'), false, 'frequent section hidden below the minimum entry count');
  assert.equal(markup.includes('-installed-version"'), false, 'local-development rows have no package state');
  assert.equal(markup.includes('Apps.library.'), false, 'no raw i18n keys');
  assert.equal(markup.includes('Apps.sourceBadge.'), false, 'no raw i18n keys');
});

test('Apps library renders bounded App AIConfig posture without opening the App', async () => {
  await initI18n();
  await changeLocale('zh');
  const configured = {
    ...entry(),
    aiConfigSummary: {
      routePosture: 'partial-cloud' as const,
      healthPosture: 'blocked' as const,
      intentCount: 2,
      total: 9,
      blockedCount: 1,
      localCount: 0,
      cloudCount: 2,
    },
  };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [configured], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('data-app-ai-config-summary="partial-cloud"'));
  assert.ok(markup.includes('data-app-ai-config-health="blocked"'));
  assert.ok(markup.includes('AI 云端 · 2/9 · 1 项受阻'));
  assert.ok(
    markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example-ai-config-open"'),
    'expected the AI pill to be an actionable button',
  );
  assert.ok(markup.includes('打开 AI 模型设置'), 'expected the AI pill open-settings hint');
});

test('Apps library hides the unconfigured AI pill as a default empty state', async () => {
  await initI18n();
  await changeLocale('zh');
  const unconfigured = {
    ...entry(),
    aiConfigSummary: {
      routePosture: 'unconfigured' as const,
      healthPosture: 'healthy' as const,
      intentCount: 0,
      total: 9,
      blockedCount: 0,
      localCount: 0,
      cloudCount: 0,
    },
  };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [unconfigured], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.equal(markup.includes('AI 未配置'), false, 'unconfigured AI pill hidden on cards');
});

test('Apps library renders the host-read project summary under the app title', async () => {
  await initI18n();
  await changeLocale('zh');
  const withSummary = {
    ...entry(),
    summary: '面向本地项目的示例 App，演示 Nimi 平台能力。',
  };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [withSummary], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example-summary"'), 'expected summary element');
  assert.ok(markup.includes('面向本地项目的示例 App，演示 Nimi 平台能力。'), 'expected summary copy under the title');
  const withoutSummary = renderView(baseProps());
  assert.equal(withoutSummary.includes('-summary"'), false, 'no summary element when the project has none');
});

test('Apps search fields render a clear button only when the query is non-empty', async () => {
  await initI18n();
  await changeLocale('zh');
  const withQuery = renderView(baseProps({ searchQuery: 'lab' }));
  assert.ok(withQuery.includes('data-testid="apps-search-clear"'), 'expected rail clear button');
  assert.ok(withQuery.includes('data-testid="apps-search-clear-library"'), 'expected library clear button');
  assert.ok(withQuery.includes('清除搜索'), 'expected zh clear copy');
  const emptyQuery = renderView(baseProps({ searchQuery: '' }));
  assert.equal(emptyQuery.includes('data-testid="apps-search-clear"'), false, 'no rail clear button when empty');
  assert.equal(emptyQuery.includes('data-testid="apps-search-clear-library"'), false, 'no library clear button when empty');
});

test('Apps rail and library list pin running apps first without group sections', async () => {
  await initI18n();
  await changeLocale('zh');
  const running = entry({ updatedAtUnixMs: 1_721_000_000_000 }, 'running');
  const stopped = entry({
    selector: 'dev-project-zhiyu',
    appId: 'nimi.zhiyu',
    displayName: '织羽 Zhiyu',
    updatedAtUnixMs: 1_999_000_000_000,
  });
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [stopped, running], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(!markup.includes('data-testid="apps-running-group"'), 'no running group section');
  assert.ok(!markup.includes('正在运行'), 'no group title copy');
  assert.ok(markup.includes('运行中'), 'expected running status copy');
  assert.ok(markup.includes('停止'), 'expected stop action copy for the running app');
  const runningIndex = markup.indexOf('data-testid="apps-rail-entry-local_development:nimi.lab:dev-project-example"');
  const stoppedIndex = markup.indexOf('data-testid="apps-rail-entry-local_development:nimi.zhiyu:dev-project-zhiyu"');
  assert.ok(runningIndex !== -1 && stoppedIndex !== -1, 'expected both rail rows');
  assert.ok(runningIndex < stoppedIndex, 'running app pinned before the stopped app');
  const runningCardIndex = markup.indexOf('data-testid="apps-entry-local_development:nimi.lab:dev-project-example"');
  const stoppedCardIndex = markup.indexOf('data-testid="apps-entry-local_development:nimi.zhiyu:dev-project-zhiyu"');
  assert.ok(runningCardIndex !== -1 && stoppedCardIndex !== -1, 'expected both list rows');
  assert.ok(runningCardIndex < stoppedCardIndex, 'running row pinned before the stopped row');
  assert.ok(markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example-stop"'), 'running app exposes the supported stop action');
  assert.equal(markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example-open"'), false, 'startRegistration does not focus an existing window');
});

test('Apps detail mode renders the header, tabs, and README surface', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ selectedEntryKey: 'local_development:nimi.lab:dev-project-example' }));
  assert.ok(markup.includes('data-testid="apps-detail-body"'), 'expected detail body');
  assert.ok(markup.includes('data-testid="apps-detail-title"'), 'expected detail title');
  assert.ok(markup.includes('Nimi Lab'), 'expected detail name');
  assert.ok(markup.includes('返回应用库'), 'expected back-to-library copy');
  assert.ok(markup.includes('概览'), 'expected overview tab');
  assert.ok(markup.includes('data-testid="apps-readme-loading"'), 'expected readme loading surface');
  assert.ok(markup.includes('data-testid="apps-detail-launch"'), 'expected primary launch action');
  assert.equal(markup.includes('-installed-version"'), false, 'local-development detail has no package state');
  assert.ok(markup.includes('data-testid="apps-sidebar"'), 'expected permanent rail');
  assert.ok(markup.includes('data-testid="apps-rail-entry-local_development:nimi.zhiyu:dev-project-zhiyu"'), 'expected rail rows');
});

test('Apps library exposes public catalog search as not implemented without fabricated entries', async () => {
  await initI18n();
  await changeLocale('en');
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('data-testid="apps-catalog-unavailable"'));
  assert.ok(markup.includes('Public App catalog search is not implemented yet.'));
  assert.equal(markup.includes('Example Catalog App'), false, 'must not fabricate public catalog data');
  await changeLocale('zh');
});

test('Runtime committed version and cancelable package job render without enabling launch', async () => {
  await initI18n();
  await changeLocale('en');
  const installed = installedRuntimeEntry();
  const cardMarkup = renderView(baseProps({
    projection: { status: 'loaded', entries: [installed], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(cardMarkup.includes('Installed 1.0.0'));
  assert.ok(cardMarkup.includes('Downloading package · 50%'));
  assert.equal(cardMarkup.includes(`apps-entry-${installed.identity.entryKey}-launch`), false);

  const detailMarkup = renderView(baseProps({
    projection: { status: 'loaded', entries: [installed], catalogStatus: 'not-implemented', runtimeError: null },
    selectedEntryKey: installed.identity.entryKey,
  }));
  assert.ok(detailMarkup.includes('data-testid="apps-detail-cancel-job"'));
  assert.equal(detailMarkup.includes('data-testid="apps-detail-launch"'), false);
  await changeLocale('zh');
});

test('installed App detail keeps action and Runtime lifecycle failures visible', async () => {
  await initI18n();
  await changeLocale('en');
  const installed = installedRuntimeEntry();
  const markup = renderView(baseProps({
    projection: {
      status: 'loaded',
      entries: [installed],
      catalogStatus: 'not-implemented',
      runtimeError: 'package lifecycle unavailable',
    },
    selectedEntryKey: installed.identity.entryKey,
    actionError: 'package job phase changed',
  }));
  assert.ok(markup.includes('data-testid="apps-runtime-error"'));
  assert.ok(markup.includes('package lifecycle unavailable'));
  assert.ok(markup.includes('data-testid="apps-action-error"'));
  assert.ok(markup.includes('package job phase changed'));
  await changeLocale('zh');
});

test('latest Runtime package failure stays visible on the App card', async () => {
  await initI18n();
  await changeLocale('en');
  const failed = installedRuntimeEntry({
    phase: AppPackageJobPhase.FAILED,
    terminalResult: AppPackageTerminalResult.FAILED,
    reasonCode: 'package-signature-invalid',
    cancelable: false,
  });
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [failed], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('Failed'));
  assert.ok(markup.includes('package-signature-invalid'));
  await changeLocale('zh');
});

test('active uninstall phases use the non-terminal Apps locale copy', async () => {
  await initI18n();
  const uninstalling = installedRuntimeEntry({
    kind: AppPackageJobKind.UNINSTALL,
    phase: AppPackageJobPhase.REMOVING_PACKAGE,
    progressBasis: AppPackageProgressBasis.INDETERMINATE,
    cancelable: false,
  });
  await changeLocale('en');
  assert.ok(renderView(baseProps({
    projection: { status: 'loaded', entries: [uninstalling], catalogStatus: 'not-implemented', runtimeError: null },
  })).includes('Uninstalling'));
  await changeLocale('zh');
  assert.ok(renderView(baseProps({
    projection: { status: 'loaded', entries: [uninstalling], catalogStatus: 'not-implemented', runtimeError: null },
  })).includes('正在卸载'));
});

test('Apps library surfaces a terminal launch failure instead of a silent stop', async () => {
  await initI18n();
  await changeLocale('zh');
  const failed = entry({}, 'registration-unavailable');
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [failed], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('data-run-visual="failed"'), 'expected failed run visual');
  assert.ok(markup.includes('启动失败'), 'expected zh failed status copy');
  assert.ok(markup.includes('重试'), 'expected zh retry action copy for the failed row');
  assert.ok(!markup.includes('Apps.runState.'), 'no raw i18n keys');
});

test('Apps library renders the 常用 quick-launch strip once enough apps are connected', async () => {
  await initI18n();
  await changeLocale('zh');
  const running = entry({ selector: 'dev-project-running', appId: 'nimi.running', displayName: 'Running App', updatedAtUnixMs: 1_721_000_000_000 }, 'running');
  const recent = entry({ selector: 'dev-project-recent', appId: 'nimi.recent', displayName: 'Recent App', updatedAtUnixMs: 1_999_000_000_000 });
  const older = entry({ selector: 'dev-project-older', appId: 'nimi.older', displayName: 'Older App', updatedAtUnixMs: 1_900_000_000_000 });
  const oldest = entry({ selector: 'dev-project-oldest', appId: 'nimi.oldest', displayName: 'Oldest App', updatedAtUnixMs: 1_800_000_000_000 });
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [oldest, older, recent, running], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('data-testid="apps-frequent-section"'), 'expected frequent section');
  assert.ok(markup.includes('常用'), 'expected frequent section copy');
  const runningTile = markup.indexOf('data-testid="apps-frequent-local_development:nimi.running:dev-project-running"');
  const recentTile = markup.indexOf('data-testid="apps-frequent-local_development:nimi.recent:dev-project-recent"');
  const olderTile = markup.indexOf('data-testid="apps-frequent-local_development:nimi.older:dev-project-older"');
  assert.ok(runningTile !== -1 && recentTile !== -1 && olderTile !== -1, 'expected three frequent tiles');
  assert.ok(runningTile < recentTile && recentTile < olderTile, 'frequent tiles order running first, then recently updated');
  assert.equal(markup.includes('data-testid="apps-frequent-local_development:nimi.oldest:dev-project-oldest"'), false, 'frequent strip capped at three apps');
  const searching = renderView(baseProps({
    searchQuery: 'running',
    projection: { status: 'loaded', entries: [oldest, older, recent, running], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.equal(searching.includes('data-testid="apps-frequent-section"'), false, 'frequent section hidden while searching');
});

test('Apps library renders with resolved en copy after locale switch', async () => {
  await initI18n();
  await changeLocale('en');
  const markup = renderView(baseProps());
  assert.ok(markup.includes('App Center'), 'expected en page title');
  assert.ok(markup.includes('Add App'), 'expected en add-app action copy');
  assert.ok(markup.includes('Search apps or App ID'), 'expected en rail search placeholder');
  assert.ok(markup.includes('Search installed apps'), 'expected en library search placeholder');
  assert.ok(markup.includes('All Apps'), 'expected en all-apps section title');
  assert.ok(markup.includes('Needs Attention'), 'expected en attention chip copy');
  assert.ok(markup.includes('Recently updated'), 'expected en sort copy');
  assert.ok(markup.includes('Not running'), 'expected en stopped status copy on rows');
  await changeLocale('zh');
});
