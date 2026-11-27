import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DesktopAIExecutionRoute,
  DesktopAIExecutionState,
  type DesktopAIUsageSummary,
} from '@nimiplatform/sdk/runtime/generated';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n/index.js';
import { validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { buildHomeQuickJumpItems } from '../src/shell/renderer/features/home/home-quick-jump-modal.js';
import { HomeAttentionStrip, type HomeAttentionItem } from '../src/shell/renderer/features/home/home-attention-strip.js';
import { HomeAmbientStatusStrip } from '../src/shell/renderer/features/home/home-ambient-status-strip.js';
import { systemEntryDayRange } from '../src/shell/renderer/features/system-entry/system-entry-time.js';
import type { SystemEntryAIState } from '../src/shell/renderer/features/system-entry/system-entry-ai-model.js';

(globalThis as { React?: typeof React }).React = React;

const noop = () => {};

function makeUsageAI(overrides: Partial<DesktopAIUsageSummary> = {}): SystemEntryAIState {
  const range = systemEntryDayRange(Date.UTC(2026, 10, 23, 2, 0, 0), 'Asia/Shanghai');
  const summary: DesktopAIUsageSummary = {
    fromTime: range.fromTime,
    toTime: range.toTime,
    readAt: range.toTime,
    coverageFrom: range.fromTime,
    coverageTo: range.toTime,
    sourceComplete: true,
    timeComplete: true,
    quantityComplete: true,
    groupsComplete: true,
    partialReasons: [],
    sourceCoverage: [{ source: 'app', activityComplete: true, usageComplete: true }],
    totals: { attemptCount: '0', pendingUsageCount: '0', unpricedAttemptCount: '0' },
    estimates: [],
    groups: [],
    ...overrides,
  };
  return {
    range,
    activity: { status: 'ready', value: null, error: null },
    usage: { status: 'ready', value: summary, error: null },
  };
}

test('Home human chat navigation preserves validated draft without auto-sending and Quick Jump deduplicates Harness and Zhiyu', async () => {
  await initI18n();
  await changeLocale('zh');

  const dest = validateHomeDestination({
    id: 'contacts',
    chat: {
      mode: 'human',
      targetId: 'user-alice',
      contactsSection: 'conversations',
      draft: { text: '明天上午十点开会确认一下方案', source: 'home_omni' },
    },
  });
  assert.equal(dest.chat?.targetId, 'user-alice');
  assert.equal(dest.chat?.draft?.text, '明天上午十点开会确认一下方案');
  assert.equal(dest.chat?.draft?.source, 'home_omni');
  assert.throws(() => validateHomeDestination({
    id: 'contacts',
    chat: { mode: 'human', targetId: 'user-alice', draft: { text: '   ' } },
  }), /Invalid chat draft/);

  const items = buildHomeQuickJumpItems({
    t: ((key: string) => key) as never,
    apps: [
      {
        identity: { appId: 'nimi.harness', displayName: 'Nimi Harness', entryKey: 'harness-dev' },
        localDevelopment: { selector: 'dev-1' },
      },
      {
        identity: { appId: 'nimi.zhiyu', displayName: '织羽', entryKey: 'zhiyu-dev' },
        localDevelopment: { selector: 'dev-2' },
      },
      {
        identity: { appId: 'example.custom', displayName: 'Custom App', entryKey: 'custom-1' },
        localDevelopment: { selector: 'dev-3' },
      },
    ] as never,
    partners: [],
    actions: {
      onOpenZhiyu: noop,
      onOpenHarness: noop,
      onOpenApp: noop,
      onOpenPartner: noop,
      onOpenCapability: noop,
      onOpenExplore: noop,
      onOpenApps: noop,
      onOpenModelLibrary: noop,
      onOpenAIProfiles: noop,
      onOpenCloud: noop,
      onOpenConnections: noop,
      onOpenIntegrations: noop,
      onOpenDownloads: noop,
      onOpenAIActivity: noop,
      onOpenTroubleshooting: noop,
      onOpenDataStorage: noop,
    },
  });
  const appGroupIds = items.filter((item) => item.group === 'apps').map((item) => item.id);
  // Fork A: Zhiyu is bundled (deduplicated into app:zhiyu), while Harness is an independent installed App.
  assert.deepEqual(appGroupIds, ['app:zhiyu', 'app:nimi.harness', 'app:example.custom']);
});

test('HomeAttentionStrip collapses to empty markup when idle and enforces caps of 3 attention and 3 active work items', async () => {
  await initI18n();
  await changeLocale('zh');

  assert.equal(
    renderToStaticMarkup(
      <HomeAttentionStrip
        attention={[]}
        executions={[]}
        downloads={[]}
        onOpenActivity={noop}
        onOpenDownloads={noop}
      />,
    ),
    '',
  );

  const attention: HomeAttentionItem[] = [
    { id: 'att-1', tone: 'danger', message: '引擎离线', actionLabel: '查看状态', onAction: noop },
    { id: 'att-2', tone: 'setup', message: '对话能力尚未配置', actionLabel: '去配置', onAction: noop },
    { id: 'att-3', tone: 'warning', message: '待确认写入报告', actionLabel: '去审阅', onAction: noop },
    { id: 'att-4', tone: 'info', message: '第四条不应超过上限', actionLabel: '处理', onAction: noop },
  ];

  const html = renderToStaticMarkup(
    <HomeAttentionStrip
      attention={attention}
      executions={[
        {
          attemptId: 'exec-1',
          sourceKind: 'app',
          sourceLabel: 'Nimi Lab',
          capability: 'text.generate',
          route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL,
          state: DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING,
          models: [{ providerId: 'local', modelId: 'qwen', displayName: 'Qwen3', role: 'primary' }],
          parentWorkKind: '',
          parentWorkId: '',
        },
        {
          attemptId: 'exec-2',
          sourceKind: 'app',
          sourceLabel: '织羽',
          capability: 'audio.synthesize',
          route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
          state: DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING,
          models: [],
          parentWorkKind: '',
          parentWorkId: '',
        },
      ]}
      downloads={[
        { id: 'dl-1', title: 'Qwen3-8B', bytesReceived: 512 * 1024 * 1024, bytesTotal: 1024 * 1024 * 1024, speedBytesPerSec: 12 * 1024 * 1024 },
        { id: 'dl-2', title: 'Hidden Overflow Download', bytesReceived: 100, bytesTotal: 200, speedBytesPerSec: 10 },
      ]}
      onOpenActivity={noop}
      onOpenDownloads={noop}
    />,
  );

  assert.match(html, /data-testid="home-attention-item:att-1"/);
  assert.match(html, /data-testid="home-attention-item:att-2"/);
  assert.match(html, /data-testid="home-attention-item:att-3"/);
  assert.doesNotMatch(html, /data-testid="home-attention-item:att-4"/, 'caps attention at 3');
  assert.match(html, /下一组提醒/);
  assert.match(html, /data-testid="home-active-execution:exec-1"/);
  assert.match(html, /data-testid="home-active-execution:exec-2"/);
  assert.match(html, /data-testid="home-active-download:dl-1"/);
  assert.doesNotMatch(html, /data-testid="home-active-download:dl-2"/, 'caps combined active work at 3');
});

test('HomeAmbientStatusStrip stays calm when idle, omits unconfigured remote/integrations, and preserves honest currencies when active', async () => {
  await initI18n();
  await changeLocale('zh');

  const idleHtml = renderToStaticMarkup(
    <HomeAmbientStatusStrip
      runtime="ready"
      capabilitiesLoading={false}
      capabilitiesFailed={false}
      readyCapabilityCount={1}
      ai={makeUsageAI()}
      remote={{ primaryState: 'this-pc', remoteEnabled: false, connectedClientCount: 0, pendingConfirmCount: 0 }}
      activeIntegrationCount={0}
      onOpenDiagnostics={noop}
      onOpenCapabilities={noop}
      onOpenUsageDetails={noop}
      onOpenConnections={noop}
      onOpenIntegrations={noop}
    />,
  );
  assert.match(idleHtml, /本机引擎就绪/);
  assert.match(idleHtml, /1 项本机 AI 就绪/);
  assert.match(idleHtml, /今日未调用/);
  assert.doesNotMatch(idleHtml, /0\.00|home-ambient-remote|home-ambient-integrations|CPU|内存|磁盘/);

  const activeHtml = renderToStaticMarkup(
    <HomeAmbientStatusStrip
      runtime="ready"
      capabilitiesLoading={false}
      capabilitiesFailed={false}
      readyCapabilityCount={4}
      ai={makeUsageAI({
        totals: { attemptCount: '18', pendingUsageCount: '0', unpricedAttemptCount: '1' },
        estimates: [
          { currency: 'USD', estimatedAmount: '0.42' },
          { currency: 'CNY', estimatedAmount: '1.20' },
        ],
        groups: [
          {
            sourceKind: 'app',
            capability: 'text.generate',
            route: DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD,
            models: [],
            totals: { attemptCount: '18', pendingUsageCount: '0', unpricedAttemptCount: '1' },
            estimates: [{ currency: 'USD', estimatedAmount: '0.42' }],
          },
        ],
      })}
      remote={{ primaryState: 'this-pc', remoteEnabled: true, connectedClientCount: 2, pendingConfirmCount: 0 }}
      activeIntegrationCount={3}
      onOpenDiagnostics={noop}
      onOpenCapabilities={noop}
      onOpenUsageDetails={noop}
      onOpenConnections={noop}
      onOpenIntegrations={noop}
    />,
  );
  assert.match(activeHtml, /今日 USD 0\.42 \/ CNY 1\.20 · 18 次/);
  assert.match(activeHtml, /data-testid="home-ambient-usage-incomplete"/);
  assert.match(activeHtml, /远程连接中（2 台）/);
  assert.match(activeHtml, /已连 3 个外部通道/);
});
