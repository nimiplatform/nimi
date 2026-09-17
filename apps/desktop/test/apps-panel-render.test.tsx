/**
 * Apps panel home/detail render proof.
 *
 * Mounts AppsPanelView through the real i18n instance and asserts the loading,
 * error, empty, home sections, merged rail list, running section, and detail
 * states render with resolved copy. Effects do not run under
 * `renderToStaticMarkup`, so this covers static structure and translation
 * wiring; live polling and host actions are covered by the
 * controller/projection tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@nimiplatform/kit/ui';

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
  type AppPackageInfo,
  type AppPackageJob,
  type ApprovedAppCatalogTarget,
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
    aiConfigAllowedRoutes: ['local', 'cloud'],
    capabilityContractRefs: [],
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
    catalogTarget: null,
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
    iconUrl: null,
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
    catalogTarget: null,
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
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

function verifiedLabEntry(): DesktopAppsEntry {
  const base = installedRuntimeEntry();
  return {
    ...base,
    identity: {
      entryKey: 'verified:nimi.lab',
      appId: 'nimi.lab',
      sourceClass: 'verified',
      displayName: 'Nimi Lab',
      updatedAtUnixMs: 1_788_134_400_000,
    },
    committedRelease: { ...base.committedRelease!, appId: 'nimi.lab' },
    packageJob: null,
  };
}

function catalogRuntimeEntry(policyBlocked = false): DesktopAppsEntry {
  const catalogTarget = {
    approvedTargetSelector: new Uint8Array([1, 2, 3]), observedRegistryRevision: 'a'.repeat(40),
    descriptorId: 'example.catalog-app@1.0.0', appId: 'example.catalog-app', displayName: 'Example Catalog App', version: '1.0.0',
    publisherGithubNamespace: 'publisher', sourceRepository: 'https://github.com/publisher/example', sourceLicenseSpdxExpression: 'MIT', targetId: 'windows-x86_64', os: 'windows', arch: 'x86_64',
    assetName: 'example.catalog-app-1.0.0-windows-x86_64.nimiapp', assetSize: '42', executionProfileRef: 'windows-user-mode-as-invoker-v1',
    windowsCodeSigning: 'unsigned', appAccess: ['runtime.consume'], capabilityContractRefs: ['text.generate'], requiredStandardizedFeatureRefs: ['app.storage'],
    storagePolicyKind: 'app-owned-os-storage', osStorageDisclosures: [{ pathPattern: '%LOCALAPPDATA%/Example', purpose: 'cache', expectedSizeBand: '1–10 MiB' }],
    policyBlocked, policyReason: policyBlocked ? 'security-review-revoked' : undefined, policyRevision: policyBlocked ? '7' : '0',
  } as ApprovedAppCatalogTarget;
  return {
    identity: {
      entryKey: 'verified:example.catalog-app', appId: catalogTarget.appId, sourceClass: 'verified',
      displayName: catalogTarget.displayName, updatedAtUnixMs: 0,
    },
    catalogTarget,
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: null,
  };
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
    onImportLocal: () => {},
    onRetry: () => {},
    onAIConfigChanged: () => {},
    actionError: null,
    activeAction: null,
    installConfirmation: null,
    onConfirmInstall: () => undefined,
    onCancelInstall: () => undefined,
    ...overrides,
  };
}

function renderView(props: AppsPanelViewProps): string {
  return renderToStaticMarkup(<TooltipProvider><AppsPanelView {...props} /></TooltipProvider>);
}

test('automatic update prompts wait until the current install confirmation closes', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, Element: dom.window.Element,
    Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { snapshotAppsInstallIntent } = await import('../src/shell/renderer/features/apps/apps-install-intent.js');
  const { writeAppUpdatePolicy, readAppUpdatePreference } = await import('../src/shell/renderer/features/apps/apps-update-preferences.js');
  await initI18n();
  const catalog = catalogRuntimeEntry();
  const entry: DesktopAppsEntry = {
    ...catalog,
    catalogTarget: { ...catalog.catalogTarget!, version: '2.0.0' },
    committedRelease: installedRuntimeEntry().committedRelease,
  };
  writeAppUpdatePolicy(entry.identity.appId, 'auto');
  const calls: string[] = [];
  const props = baseProps({
    projection: { status: 'loaded', entries: [entry], catalogStatus: 'loaded', runtimeError: null },
    onCardAction: (entryKey, action) => calls.push(`${entryKey}:${action}`),
    installConfirmation: snapshotAppsInstallIntent(catalog.catalogTarget!),
  });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(<TooltipProvider><AppsPanelView {...props} /></TooltipProvider>));
    assert.deepEqual(calls, []);
    assert.equal(readAppUpdatePreference(entry.identity.appId).lastAutoPromptedVersion, null);
    await act(async () => root.render(<TooltipProvider><AppsPanelView {...props} installConfirmation={null} /></TooltipProvider>));
    assert.deepEqual(calls, [`${entry.identity.entryKey}:update`]);
    assert.equal(readAppUpdatePreference(entry.identity.appId).lastAutoPromptedVersion, '2.0.0');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('installed AI model tabs follow installed access, independently of Catalog access', async () => {
  await initI18n();
  await changeLocale('en');
  for (const source of [AppPackageSourceClass.VERIFIED, AppPackageSourceClass.USER_IMPORTED]) {
    const base = installedRuntimeEntry();
    const installed: DesktopAppsEntry = {
      ...base, packageJob: null,
      identity: { ...base.identity, sourceClass: source === AppPackageSourceClass.USER_IMPORTED ? 'user_imported' : 'verified' },
      committedRelease: { ...base.committedRelease!, sourceClass: source, appAccess: ['runtime.consume'] },
    };
    const markup = renderView(baseProps({
      projection: { status: 'loaded', entries: [installed], catalogStatus: 'loaded', runtimeError: null },
      selectedEntryKey: installed.identity.entryKey,
    }));
    assert.match(markup.replace(/<[^>]*>/gu, " "), /AI models/iu);
    const catalogOnlyAccess: DesktopAppsEntry = {
      ...installed, committedRelease: { ...installed.committedRelease!, appAccess: [] },
      catalogTarget: { ...catalogRuntimeEntry().catalogTarget!, appAccess: ['runtime.consume'] },
    };
    const withoutAccess = renderView(baseProps({
      projection: { status: 'loaded', entries: [catalogOnlyAccess], catalogStatus: 'loaded', runtimeError: null },
      selectedEntryKey: installed.identity.entryKey,
    }));
    assert.doesNotMatch(withoutAccess.replace(/<[^>]*>/gu, " "), /AI models/iu);
  }
});

test('Apps home renders the loading skeleton', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ projection: null }));
  assert.ok(markup.includes('data-testid="apps-panel-loading"'), 'expected loading skeleton');
});

test('Apps home fails visible on projection error with retry copy', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({
    projection: { status: 'error', detail: 'fixed Runtime service unavailable' },
  }));
  assert.ok(markup.includes('data-testid="apps-error"'), 'expected error alert');
  assert.ok(markup.includes('无法加载 Apps'), 'expected zh error copy');
  assert.ok(markup.includes('重试'), 'expected zh retry copy');
});

test('Apps home renders the empty state with the add-app action', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ projection: { status: 'loaded', entries: [], catalogStatus: 'not-implemented', runtimeError: null } }));
  assert.ok(markup.includes('data-testid="apps-empty-local-development"'), 'expected empty state');
  assert.ok(markup.includes('还没有接入应用'), 'expected zh empty title');
  assert.ok(markup.includes('data-testid="apps-connect-local"'), 'expected add-app action');
  assert.ok(markup.includes('添加应用'), 'expected add-app copy');
});

test('Apps home renders the header, recent rows, and the merged rail with resolved zh copy', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps());
  assert.ok(markup.includes('data-testid="apps-library-title"'), 'expected page title');
  assert.ok(markup.includes('应用中心'), 'expected app-center title copy');
  assert.ok(markup.includes('data-testid="apps-home-recent"'), 'expected recent section');
  assert.ok(markup.includes('最近活跃'), 'expected recent section copy');
  assert.ok(markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example"'), 'expected first row');
  assert.ok(markup.includes('data-testid="apps-entry-local_development:nimi.zhiyu:dev-project-zhiyu"'), 'expected second row');
  assert.ok(markup.includes('Nimi Lab'), 'expected first display name');
  assert.ok(markup.includes('织羽 Zhiyu'), 'expected second display name');
  assert.equal(markup.includes('data-source-badge="local_development"'), false, 'single-source local rows keep the quiet name line');
  assert.equal(markup.includes('本地开发'), false, 'local-development source copy hidden without duplicates');
  assert.ok(markup.includes('linear-gradient'), 'expected generated artwork gradients');
  assert.ok(markup.includes('未运行'), 'expected stopped status copy on rows');
  assert.ok(markup.includes('启动'), 'expected launch action copy');
  assert.ok(markup.includes('data-testid="apps-connect-local"'), 'expected header add-app action');
  assert.ok(markup.includes('添加应用'), 'expected add-app action copy');
  assert.ok(markup.includes('data-testid="apps-rail-app-nimi.lab"'), 'expected merged rail row for nimi.lab');
  assert.ok(markup.includes('data-testid="apps-rail-app-nimi.zhiyu"'), 'expected merged rail row for nimi.zhiyu');
  assert.ok(markup.includes('2 个 App'), 'expected merged rail count copy');
  assert.ok(markup.includes('搜索 App 或 App ID'), 'expected rail search placeholder');
  assert.equal(markup.includes('搜索应用'), false, 'the rail is the only search');
  assert.ok(markup.includes('全部 App'), 'expected default filter copy');
  assert.equal(markup.includes('-installed-version"'), false, 'local-development rows have no package state');
  assert.equal(markup.includes('Apps.library.'), false, 'no raw i18n keys');
  assert.equal(markup.includes('Apps.sourceBadge.'), false, 'no raw i18n keys');
});

test('sources of one App merge into a single rail row with source glyphs', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [entry(), verifiedLabEntry()], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  const railRows = markup.match(/data-rail-group="nimi\.lab"/g) ?? [];
  assert.equal(railRows.length, 1, 'two sources produce one merged rail row');
  const railButton = markup.match(/<button[^>]*data-testid="apps-rail-app-nimi\.lab"[\s\S]*?<\/button>/)?.[0];
  assert.ok(railButton, 'the merged App remains in the middle rail');
  assert.ok(!railButton.includes('已审核') && !railButton.includes('badge-check'), 'the middle rail omits review icons');
  assert.ok(markup.includes('1 个 App'), 'rail count follows the merged identity');
  assert.ok(markup.includes('本地开发'), 'multi-source row shows the development glyph');
  assert.ok(markup.includes('aria-label="已审核"'), 'reviewed App names retain an accessible review icon');
  assert.ok(!markup.includes('已通过 Registry 审核'), 'reviewed Apps omit the technical review sentence');
  assert.ok(markup.includes('data-testid="apps-entry-verified:nimi.lab"'), 'home recent row uses the installed primary');
  assert.equal(markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example"'), false, 'duplicate source does not repeat on home');
});

test('Apps rail keeps running Apps in a 运行中 section and home orders them first', async () => {
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
  assert.ok(markup.includes('data-testid="apps-rail-running-section"'), 'expected running section');
  assert.ok(markup.includes('运行中'), 'expected running section copy');
  const runningIndex = markup.indexOf('data-testid="apps-rail-app-nimi.lab"');
  const stoppedIndex = markup.indexOf('data-testid="apps-rail-app-nimi.zhiyu"');
  assert.ok(runningIndex !== -1 && stoppedIndex !== -1, 'expected both rail rows');
  assert.ok(runningIndex < stoppedIndex, 'running section renders before the flat list');
  const runningCardIndex = markup.indexOf('data-testid="apps-entry-local_development:nimi.lab:dev-project-example"');
  const stoppedCardIndex = markup.indexOf('data-testid="apps-entry-local_development:nimi.zhiyu:dev-project-zhiyu"');
  assert.ok(runningCardIndex !== -1 && stoppedCardIndex !== -1, 'expected both home rows');
  assert.ok(runningCardIndex < stoppedCardIndex, 'running row pinned before the stopped row on home');
  assert.ok(markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example-stop"'), 'running app exposes the supported stop action');
  assert.ok(markup.includes('停止'), 'expected stop action copy for the running app');
});

test('Apps home surfaces only actionable App AIConfig postures', async () => {
  await initI18n();
  await changeLocale('zh');
  const blocked = {
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
    projection: { status: 'loaded', entries: [blocked], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('data-app-ai-config-summary="partial-cloud"'));
  assert.ok(markup.includes('data-app-ai-config-health="blocked"'));
  assert.ok(markup.includes('AI 配置受阻 · 1 项'), 'expected the blocked brief copy');
  assert.equal(markup.includes('AI 云端 · 2/9'), false, 'route fractions stay out of list rows');
  assert.ok(
    markup.includes('data-testid="apps-entry-local_development:nimi.lab:dev-project-example-ai-config-open"'),
    'expected the AI pill to be an actionable button',
  );
  assert.ok(markup.includes('打开 AI 模型设置'), 'expected the AI pill open-settings hint');
});

test('Apps home hides non-actionable AI postures as ambient state', async () => {
  await initI18n();
  await changeLocale('zh');
  const cases = [
    { routePosture: 'unconfigured' as const, healthPosture: 'healthy' as const, intentCount: 0, total: 9, blockedCount: 0, localCount: 0, cloudCount: 0 },
    { routePosture: 'partial-local' as const, healthPosture: 'healthy' as const, intentCount: 2, total: 9, blockedCount: 0, localCount: 2, cloudCount: 0 },
    { routePosture: 'local' as const, healthPosture: 'healthy' as const, intentCount: 9, total: 9, blockedCount: 0, localCount: 9, cloudCount: 0 },
  ];
  for (const aiConfigSummary of cases) {
    const markup = renderView(baseProps({
      projection: { status: 'loaded', entries: [{ ...entry(), aiConfigSummary }], catalogStatus: 'not-implemented', runtimeError: null },
    }));
    assert.equal(markup.includes('-ai-config-open"'), false, `no AI pill for ${aiConfigSummary.routePosture}/${aiConfigSummary.healthPosture}`);
  }
});

test('Apps home lists Apps with an available catalog update in their own section', async () => {
  await initI18n();
  await changeLocale('zh');
  const installed = installedRuntimeEntry();
  const catalog = catalogRuntimeEntry();
  const updatable: DesktopAppsEntry = {
    ...catalog,
    catalogTarget: { ...catalog.catalogTarget!, version: '1.1.0' },
    committedRelease: installed.committedRelease,
  };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [updatable], catalogStatus: 'loaded', runtimeError: null },
  }));
  assert.ok(markup.includes('data-testid="apps-home-updates"'), 'expected updates section');
  assert.ok(markup.includes('有更新'), 'expected updates section copy');
  assert.ok(markup.includes(`data-testid="apps-entry-${updatable.identity.entryKey}-update"`), 'expected the update action');
  const current = renderView(baseProps({
    projection: { status: 'loaded', entries: [{ ...catalog, committedRelease: installed.committedRelease }], catalogStatus: 'loaded', runtimeError: null },
  }));
  assert.equal(current.includes('data-testid="apps-home-updates"'), false, 'no updates section when everything is current');
});

test('Apps home renders the host-read project summary under the app title', async () => {
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

test('Apps rail search renders a clear button only when the query is non-empty', async () => {
  await initI18n();
  await changeLocale('zh');
  const withQuery = renderView(baseProps({ searchQuery: 'lab' }));
  assert.ok(withQuery.includes('data-testid="apps-search-clear"'), 'expected rail clear button');
  assert.ok(withQuery.includes('清除搜索'), 'expected zh clear copy');
  const emptyQuery = renderView(baseProps({ searchQuery: '' }));
  assert.equal(emptyQuery.includes('data-testid="apps-search-clear"'), false, 'no rail clear button when empty');
  assert.equal(withQuery.includes('data-testid="apps-search-clear-library"'), false, 'no second search clear button');
});

test('Apps rail keeps search results keyboard reachable when the selected App is filtered out', async () => {
  await initI18n();
  const markup = renderView(baseProps({
    selectedEntryKey: ENTRIES[0]!.identity.entryKey,
    searchQuery: 'nimi.zhiyu',
  }));
  const rows = (markup.match(/<button\b[^>]*>/g) ?? []).filter((button) => button.includes('data-app-row'));
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.includes('data-testid="apps-rail-app-nimi.zhiyu"'));
  assert.ok(rows[0]!.includes('tabindex="0"'), 'the visible result must remain in the Tab order');
});

test('Apps home surfaces entries needing attention in their own section', async () => {
  await initI18n();
  await changeLocale('zh');
  const failed = entry({}, 'registration-unavailable');
  const healthy = entry({ selector: 'dev-project-zhiyu', appId: 'nimi.zhiyu', displayName: '织羽 Zhiyu' });
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [failed, healthy], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.ok(markup.includes('data-testid="apps-home-attention"'), 'expected attention section');
  assert.ok(markup.includes('需处理'), 'expected attention section copy');
  const calm = renderView(baseProps({
    projection: { status: 'loaded', entries: [healthy], catalogStatus: 'not-implemented', runtimeError: null },
  }));
  assert.equal(calm.includes('data-testid="apps-home-attention"'), false, 'attention section hidden when nothing needs it');
});

test('Apps detail mode renders the header, tabs, and overview', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ selectedEntryKey: 'local_development:nimi.lab:dev-project-example' }));
  assert.ok(markup.includes('data-testid="apps-detail-body"'), 'expected detail body');
  assert.ok(markup.includes('data-testid="apps-detail-title"'), 'expected detail title');
  assert.ok(markup.includes('Nimi Lab'), 'expected detail name');
  assert.ok(markup.includes('返回应用库'), 'expected back-to-library copy');
  assert.ok(markup.includes('概览'), 'expected overview tab');
  assert.equal(markup.includes('关于此 App'), false, 'the about heading uses the App name');
  assert.ok(markup.includes('data-testid="apps-about-section"'), 'expected the about section in the overview tab');
  assert.ok(markup.includes('关于 Nimi Lab'), 'expected the named about heading');
  assert.ok(markup.includes('已注册到当前 Nimi 的本地开发 App。'), 'about section falls back to the local summary copy when the project has none');
  assert.equal(markup.includes('开发者</dt>'), false, 'local registration does not supply a developer');
  assert.equal(markup.includes('来源</dt>'), false, 'unreviewed sources do not add an about fact');
  assert.equal(markup.includes('版本</dt>'), false, 'missing versions do not add an about fact');
  assert.equal(markup.includes('未提供'), false, 'missing metadata has no placeholder');
  assert.ok(markup.includes('最近更新'), 'expected the last-updated fact');
  assert.ok(markup.includes('data-testid="apps-about-more"'), 'expected the more-info entry into the properties dialog');
  assert.ok(markup.includes('更多信息'), 'expected more-info copy');
  assert.equal(markup.includes('注册时间'), false, 'registered-at stays in the properties dialog, not the about strip');
  assert.equal(markup.includes('Shell 类型'), false, 'shell type stays in the properties dialog, not the info panel');
  assert.equal(markup.includes('data-app-access-feature'), false, 'access features live in the Nimi Access tab, not the overview');
  assert.equal(markup.includes('Realm 数据'), false, 'access feature copy stays in the Nimi Access tab');
  assert.equal(markup.includes('AI 运行时'), false, 'runtime access is not an overview feature');
  assert.ok(markup.includes('data-testid="apps-documents-section"'), 'expected the documents section');
  assert.equal(markup.includes('应用文档'), false, 'overview content needs no extra document heading');
  assert.equal(markup.includes('>README<'), false, 'overview content needs no README kind tag');
  assert.ok(markup.includes('data-testid="apps-readme-loading"'), 'README renders in the overview tab');
  assert.equal(markup.includes('开发排查'), false, 'no developer-diagnostics copy in the overview README');
  assert.equal(markup.includes('data-testid="apps-detail-properties"'), false, 'properties action lives in the overflow menu, not next to launch');
  assert.ok(markup.includes('data-testid="apps-detail-more"'), 'expected the overflow menu carrying the properties action');
  assert.equal(markup.includes('开发者信息'), false, 'developer info lives behind the properties dialog, not a tab');
  assert.ok(markup.includes('data-testid="apps-detail-launch"'), 'expected primary launch action');
  assert.equal(markup.includes('-installed-version"'), false, 'local-development detail has no package state');
  assert.ok(markup.includes('data-testid="apps-sidebar"'), 'expected permanent rail');
  assert.ok(markup.includes('data-testid="apps-rail-app-nimi.zhiyu"'), 'expected rail rows');
});

test('Apps detail header carries the host-read project summary as the tagline', async () => {
  await initI18n();
  await changeLocale('zh');
  const withSummary = {
    ...entry(),
    summary: '面向本地项目的示例 App，演示 Nimi 平台能力。',
  };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [withSummary], catalogStatus: 'not-implemented', runtimeError: null },
    selectedEntryKey: withSummary.identity.entryKey,
  }));
  assert.ok(markup.includes('data-testid="apps-detail-summary"'), 'expected the header tagline element');
  assert.ok(markup.includes('面向本地项目的示例 App，演示 Nimi 平台能力。'), 'expected summary copy in the header');
  assert.equal(markup.includes('已注册到当前 Nimi 的本地开发 App。'), false, 'no fallback about copy when the project provides a summary');
});

test('Apps detail lists the other sources of the same App', async () => {
  await initI18n();
  await changeLocale('zh');
  const entries = [entry(), verifiedLabEntry()];
  const devDetail = renderView(baseProps({
    projection: { status: 'loaded', entries, catalogStatus: 'not-implemented', runtimeError: null },
    selectedEntryKey: 'local_development:nimi.lab:dev-project-example',
  }));
  assert.ok(devDetail.includes('data-testid="apps-other-sources"'), 'expected the other-sources banner');
  assert.ok(devDetail.includes('其他来源'), 'expected the other-sources accessible label');
  assert.ok(devDetail.includes('线上版本已安装'), 'expected the registry-installed headline');
  assert.ok(!devDetail.includes('已通过 Registry 审核'), 'other sources omit the technical review sentence');
  assert.ok(devDetail.includes('data-testid="apps-source-entry-verified:nimi.lab"'), 'expected the installed source link');
  assert.ok(devDetail.includes('已安装 1.0.0'), 'expected the installed source version');
  const installedDetail = renderView(baseProps({
    projection: { status: 'loaded', entries, catalogStatus: 'not-implemented', runtimeError: null },
    selectedEntryKey: 'verified:nimi.lab',
  }));
  assert.ok(installedDetail.includes('已注册本地开发来源'), 'expected the local-development headline');
  assert.ok(installedDetail.includes('data-testid="apps-source-entry-local_development:nimi.lab:dev-project-example"'), 'expected the development source link');
  const single = renderView(baseProps({ selectedEntryKey: 'local_development:nimi.lab:dev-project-example' }));
  assert.equal(single.includes('data-testid="apps-other-sources"'), false, 'single-source Apps render no sources banner');
});

test('Apps home exposes public catalog search as not implemented without fabricated entries', async () => {
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
  assert.ok(cardMarkup.includes('Downloading package · 50 B / 100 B'));
  assert.equal(cardMarkup.includes(`apps-entry-${installed.identity.entryKey}-launch`), false);

  const detailMarkup = renderView(baseProps({
    projection: { status: 'loaded', entries: [installed], catalogStatus: 'not-implemented', runtimeError: null },
    selectedEntryKey: installed.identity.entryKey,
  }));
  assert.ok(detailMarkup.includes('data-testid="apps-detail-more"'), 'cancel-job lives in the detail overflow menu');
  assert.equal(detailMarkup.includes('data-testid="apps-installed-launch"'), false);
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

test('Apps home surfaces a terminal launch failure instead of a silent stop', async () => {
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

test('An action on another App disables mutations on home rows, rail rows and details without marking them loading', async () => {
  await initI18n();
  await changeLocale('en');
  const installed = { ...installedRuntimeEntry(), packageJob: null };
  const props = baseProps({
    projection: { status: 'loaded', entries: [installed, ...ENTRIES, entry({ selector: 'fourth', appId: 'example.fourth' })], catalogStatus: 'not-implemented', runtimeError: null },
    activeAction: { entryKey: ENTRIES[0]!.identity.entryKey, action: 'launch' },
  });
  const home = renderView(props);
  const buttons = [...home.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
  const launches = buttons.filter((button) => button.includes(`data-testid="apps-entry-${installed.identity.entryKey}-launch"`));
  assert.equal(launches.length, 1, 'installed App appears once on the merged home');
  for (const button of launches) {
    assert.ok(button.includes(' disabled=""'), 'other App launch must be disabled');
    assert.ok(!button.includes('aria-busy="true"'), 'other App is not launching');
  }
  const railLaunch = buttons.find((button) => button.includes(`data-testid="apps-rail-app-${installed.identity.appId}-launch"`));
  assert.ok(railLaunch?.includes(' disabled=""'), 'rail quick launch must be disabled');
  const detail = renderView({ ...props, selectedEntryKey: installed.identity.entryKey });
  const detailLaunch = [...detail.matchAll(/<button\b[^>]*>/g)].map((match) => match[0])
    .find((button) => button.includes('data-testid="apps-installed-launch"'));
  assert.ok(detailLaunch?.includes(' disabled=""'), 'selected App launch must also be disabled');
  assert.ok(!detailLaunch.includes('aria-busy="true"'));
  const idleDetail = renderView({ ...props, activeAction: null, selectedEntryKey: installed.identity.entryKey });
  const idleLaunch = [...idleDetail.matchAll(/<button\b[^>]*>/g)].map((match) => match[0])
    .find((button) => button.includes('data-testid="apps-installed-launch"'));
  assert.ok(idleLaunch && !idleLaunch.includes(' disabled=""'), 'launch becomes available after the operation finishes');
});

test('Apps home renders with resolved en copy after locale switch', async () => {
  await initI18n();
  await changeLocale('en');
  const markup = renderView(baseProps());
  assert.ok(markup.includes('App Center'), 'expected en page title');
  assert.ok(markup.includes('Add App'), 'expected en add-app action copy');
  assert.ok(markup.includes('Search apps or App ID'), 'expected en rail search placeholder');
  assert.ok(markup.includes('Recent Activity'), 'expected en recent section copy');
  assert.ok(markup.includes('All apps'), 'expected en filter copy');
  assert.ok(markup.includes('Not running'), 'expected en stopped status copy on rows');
  assert.equal(markup.includes('All Apps'), false, 'no second all-apps list on home');
  await changeLocale('zh');
});

test('approved Catalog facts render an install intent without claiming certification', async () => {
  await initI18n();
  await changeLocale('en');
  const catalog = catalogRuntimeEntry();
  const cardMarkup = renderView(baseProps({
    projection: { status: 'loaded', entries: [catalog], catalogStatus: 'loaded', runtimeError: null },
  }));
  assert.equal(cardMarkup.includes(`data-testid="apps-entry-${catalog.identity.entryKey}-install"`), false);
  assert.ok(cardMarkup.includes('aria-label="Reviewed"'));
  assert.ok(!cardMarkup.includes('Registry approved'));
  assert.equal(cardMarkup.includes('Nimi certified'), false);

  const detailMarkup = renderView(baseProps({
    projection: { status: 'loaded', entries: [catalog], catalogStatus: 'loaded', runtimeError: null },
    selectedEntryKey: catalog.identity.entryKey,
  }));
  assert.match(detailMarkup, /<h1[^>]*data-testid="apps-detail-title"[^>]*>[^<]+<span[^>]*data-source-badge="verified"[^>]*aria-label="Reviewed"[^>]*><svg[\s\S]*?<\/svg><\/span><\/h1>/, 'the review icon belongs to the App heading without visible review text');
  assert.equal(detailMarkup.includes('data-testid="apps-catalog-approved"'), false);
  assert.equal(detailMarkup.includes('Approval and verification do not guarantee'), false);
  assert.ok(detailMarkup.includes('data-testid="apps-detail-install"'));
  assert.ok(detailMarkup.includes('@publisher'), 'the about strip keeps the Registry publisher as the developer');
  assert.equal(detailMarkup.includes('data-testid="apps-catalog-target-facts"'), false, 'registry facts leave the overview for the properties dialog');
  assert.equal(detailMarkup.includes('Online version'), false, 'the registry card title stays behind the properties dialog');
  assert.ok(detailMarkup.includes('Version</dt>'), 'the about section displays the source version');
  assert.equal(detailMarkup.includes('MIT'), false, 'the license stays behind the properties dialog');
  assert.equal(detailMarkup.includes('unsigned'), false, 'the signing posture stays behind the properties dialog');
  assert.equal(detailMarkup.includes('Expected size: 1–10 MiB'), false, 'storage disclosures stay behind the properties dialog');

  const blocked = catalogRuntimeEntry(true);
  const blockedMarkup = renderView(baseProps({
    projection: { status: 'loaded', entries: [blocked], catalogStatus: 'loaded', runtimeError: null },
    selectedEntryKey: blocked.identity.entryKey,
  }));
  assert.ok(blockedMarkup.includes('data-testid="apps-catalog-policy-blocked"'));
  assert.ok(blockedMarkup.includes('security-review-revoked'));
  assert.equal(blockedMarkup.includes('data-testid="apps-detail-install"'), false);
  await changeLocale('zh');
});

test('installed App detail moves Registry and release facts into the properties dialog', async () => {
  await initI18n();
  await changeLocale('en');
  const catalog = catalogRuntimeEntry();
  const installed = installedRuntimeEntry();
  const appInfo = {
    version: '1.0.0', displayName: 'Example Catalog App', summary: 'Summary', iconPngBase64: '',
    readmeMarkdown: '# How to use\n\nCreate things.', releaseNotesMarkdown: '', licenseIdentifier: 'MIT', licenseText: '',
    appAccess: ['runtime.consume'], capabilityContractRefs: ['text.generate'], requiredStandardizedFeatureRefs: ['app.storage'],
    storagePolicyKind: 'app-owned-os-storage',
    osStorageDisclosure: [{ pathPattern: '%LOCALAPPDATA%/Example', purpose: 'cache', expectedSizeBand: '1–10 MiB' }],
    author: 'Publisher', homepageUrl: 'https://example.com', supportUrl: 'https://example.com/support',
  } as AppPackageInfo;
  const entry: DesktopAppsEntry = { ...catalog, committedRelease: installed.committedRelease, appInfo };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [entry], catalogStatus: 'loaded', runtimeError: null },
    selectedEntryKey: entry.identity.entryKey,
  }));
  assert.ok(markup.includes('data-testid="apps-about-section"'), 'the installed overview keeps the shared about section');
  assert.equal(markup.includes('data-testid="apps-catalog-approved"'), false);
  assert.equal(markup.includes('Approval and verification do not guarantee'), false);
  assert.ok(markup.includes('About Example Catalog App'), 'expected the named about heading');
  assert.ok(markup.includes('Developer'), 'expected the developer fact');
  assert.ok(markup.includes('Publisher'), 'expected the declared author as the developer');
  assert.equal(markup.includes('Last updated'), false, 'local installation time is not an online update date');
  assert.ok(markup.includes('data-testid="apps-about-more"'), 'expected the more-info entry into the properties dialog');
  assert.ok(markup.includes('https://example.com/support'), 'expected the support link under the about strip');
  assert.ok(markup.includes('data-testid="apps-documents-section"'), 'expected the documents section');
  assert.ok(markup.includes('data-testid="apps-readme"'), 'README renders inline in the overview');
  assert.ok(markup.includes('Create things.'), 'expected the README content');
  assert.equal(markup.includes('runtime.consume'), false, 'app access leaves the overview for the Nimi Access tab');
  assert.equal(markup.includes('data-testid="apps-catalog-target-facts"'), false, 'registry facts leave the overview once installed');
  assert.equal(markup.includes('Online version'), false, 'the registry card title stays behind the properties dialog');
  assert.equal(markup.includes('release:example:1.0.0'), false, 'the release reference leaves the overview');
  assert.equal(markup.includes('text.generate'), false, 'capability refs move to the properties dialog');
  assert.equal(markup.includes('%LOCALAPPDATA%/Example'), false, 'storage disclosures move to the properties dialog');
  await changeLocale('zh');
});


test('an installed App keeps a later Registry policy block visible as an independent fact', async () => {
  await initI18n();
  await changeLocale('en');
  const blocked = catalogRuntimeEntry(true);
  const installed = installedRuntimeEntry();
  const entry: DesktopAppsEntry = { ...blocked, committedRelease: installed.committedRelease };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [entry], catalogStatus: 'loaded', runtimeError: null },
    selectedEntryKey: entry.identity.entryKey,
  }));
  assert.ok(markup.includes('data-testid="apps-catalog-policy-blocked"'));
  assert.ok(markup.includes('security-review-revoked'));
  assert.ok(markup.includes('data-testid="apps-installed-access"'));
  assert.ok(!markup.includes('data-testid="apps-installed-launch"'));
  assert.equal(markup.includes('data-testid="apps-detail-install"'), false);
  await changeLocale('zh');
});

test('imported package details never claim Registry approval', async () => {
  await initI18n();
  await changeLocale('en');
  const installed = installedRuntimeEntry();
  const imported: DesktopAppsEntry = {
    ...installed,
    identity: { ...installed.identity, entryKey: 'user_imported:example.catalog-app', sourceClass: 'user_imported' },
    committedRelease: { ...installed.committedRelease!, sourceClass: AppPackageSourceClass.USER_IMPORTED },
    packageJob: null,
  };
  const markup = renderView(baseProps({
    projection: { status: 'loaded', entries: [imported], catalogStatus: 'loaded', runtimeError: null },
    selectedEntryKey: imported.identity.entryKey,
  }));
  assert.ok(markup.includes('Imported'));
  assert.ok(!markup.includes('Registry approved'));
  await changeLocale('zh');
});
