/**
 * Apps panel library/detail render proof.
 *
 * Mounts AppsPanelView through the real i18n instance and asserts the loading,
 * error, empty, grid, running-rail, and detail states render with resolved
 * copy. Effects do not run under `renderToStaticMarkup`, so this covers static
 * structure and translation wiring; live polling and host actions are covered
 * by the controller/projection tests.
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
  return {
    registration: row,
    run: runState === null
      ? null
      : {
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
  };
}

const ENTRIES: DesktopAppsEntry[] = [
  entry(),
  entry({ selector: 'dev-project-zhiyu', appId: 'nimi.zhiyu', displayName: '织羽 Zhiyu' }),
];

function baseProps(overrides: Partial<AppsPanelViewProps> = {}): AppsPanelViewProps {
  return {
    projection: { status: 'loaded', entries: ENTRIES },
    selectedAppId: null,
    requestedDetailSection: null,
    requestedDetailNavigationRevision: 0,
    onCardAction: () => {},
    onBack: () => {},
    onOpenDeveloperMode: () => {},
    onRetry: () => {},
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
  const markup = renderView(baseProps({ projection: { status: 'loaded', entries: [] } }));
  assert.ok(markup.includes('data-testid="apps-empty-local-development"'), 'expected empty state');
  assert.ok(markup.includes('还没有接入应用'), 'expected zh empty title');
  assert.ok(markup.includes('打开开发者模式'), 'expected zh developer action');
});

test('Apps library renders cover grid cards with resolved zh copy', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps());
  assert.ok(markup.includes('data-testid="apps-entry-list"'), 'expected entry collection');
  assert.ok(markup.includes('data-testid="apps-entry-nimi.lab"'), 'expected first card');
  assert.ok(markup.includes('data-testid="apps-entry-nimi.zhiyu"'), 'expected second card');
  assert.ok(markup.includes('Nimi Lab'), 'expected first display name');
  assert.ok(markup.includes('织羽 Zhiyu'), 'expected second display name');
  assert.ok(markup.includes('data-source-badge="local_development"'), 'expected source badge');
  assert.ok(markup.includes('本地开发'), 'expected source badge copy');
  assert.ok(markup.includes('linear-gradient'), 'expected generated artwork gradients');
  assert.ok(markup.includes('未运行'), 'expected stopped status copy');
  assert.ok(markup.includes('搜索 App 或 App ID'), 'expected search placeholder');
  assert.ok(markup.includes('最近更新'), 'expected default sort copy');
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
    projection: { status: 'loaded', entries: [configured] },
  }));
  assert.ok(markup.includes('data-app-ai-config-summary="partial-cloud"'));
  assert.ok(markup.includes('data-app-ai-config-health="blocked"'));
  assert.ok(markup.includes('部分云端 · 2/9 · 1 项受阻'));
});

test('Apps rail pins running apps first without group sections', async () => {
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
    projection: { status: 'loaded', entries: [stopped, running] },
  }));
  assert.ok(!markup.includes('data-testid="apps-running-group"'), 'no running group section');
  assert.ok(!markup.includes('正在运行'), 'no group title copy');
  assert.ok(markup.includes('运行中'), 'expected running status copy');
  const runningIndex = markup.indexOf('data-testid="apps-rail-entry-nimi.lab"');
  const stoppedIndex = markup.indexOf('data-testid="apps-rail-entry-nimi.zhiyu"');
  assert.ok(runningIndex !== -1 && stoppedIndex !== -1, 'expected both rail rows');
  assert.ok(runningIndex < stoppedIndex, 'running app pinned before the stopped app');
});

test('Apps detail mode renders the header, tabs, and README surface', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ selectedAppId: 'nimi.lab' }));
  assert.ok(markup.includes('data-testid="apps-detail-body"'), 'expected detail body');
  assert.ok(markup.includes('data-testid="apps-detail-title"'), 'expected detail title');
  assert.ok(markup.includes('Nimi Lab'), 'expected detail name');
  assert.ok(markup.includes('返回应用库'), 'expected back-to-library copy');
  assert.ok(markup.includes('概览'), 'expected overview tab');
  assert.ok(markup.includes('data-testid="apps-readme-loading"'), 'expected readme loading surface');
  assert.ok(markup.includes('data-testid="apps-detail-launch"'), 'expected primary launch action');
  assert.ok(markup.includes('data-testid="apps-sidebar"'), 'expected permanent rail');
  assert.ok(markup.includes('data-testid="apps-rail-entry-nimi.zhiyu"'), 'expected rail rows');
});

test('Apps library renders with resolved en copy after locale switch', async () => {
  await initI18n();
  await changeLocale('en');
  const markup = renderView(baseProps());
  assert.ok(markup.includes('Search apps or App ID'), 'expected en search placeholder');
  assert.ok(markup.includes('Recently updated'), 'expected en sort copy');
  assert.ok(markup.includes('Not running'), 'expected en stopped status copy');
  await changeLocale('zh');
});
