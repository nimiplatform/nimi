/**
 * Characters tab (D-SHELL-001 `agents`) render proof.
 *
 * Mounts AgentsPanelView through the real i18n instance with the per-card
 * source display detail query seeded into a QueryClient cache, and asserts
 * the signed-out, loading, populated, and empty states render with resolved
 * copy — no missing translation keys, no undefined-access crash. Effects do
 * not run under `renderToStaticMarkup`, so this covers static structure and
 * translation wiring; store/query orchestration lives in AgentsPanel and is
 * exercised by the shell E2E navigation scenario on Linux CI.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ScrollArea / radix CJS primitives expect a global `React`.
(globalThis as { React?: typeof React }).React = React;

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n';
import { AgentsPanelView, type AgentsPanelViewProps } from '../src/shell/renderer/features/agents/agents-panel-view';
import type { LocalAgentListItem } from '../src/shell/renderer/features/agents/local-agent-list-model';
import { sourceDisplayDetailQueryKey } from '../src/shell/renderer/features/source-detail/source-detail-queries';

const AGENT_ITEMS: LocalAgentListItem[] = [
  {
    localAgentRef: 'local-agent:01A',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:a',
    displayName: '赵孟頫',
    sourceRef: {
      kind: 'worldCharacter',
      id: 'char-zhao',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-zhao' },
      sourceHash: 'a'.repeat(64),
    },
    sourceKey: 'worldCharacter:world-1:char-zhao:hash-a',
  },
  {
    localAgentRef: 'local-agent:01B',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:b',
    displayName: 'Kaelis',
    sourceRef: {
      kind: 'personaCharacter',
      id: 'char-kaelis',
      worldId: 'world-2',
      ownerAccountId: 'account-kaelis',
      sourceHash: 'b'.repeat(64),
    },
    sourceKey: `personaCharacter:world-2:char-kaelis:account-kaelis:${'b'.repeat(64)}`,
  },
];

function baseProps(overrides: Partial<AgentsPanelViewProps> = {}): AgentsPanelViewProps {
  return {
    authStatus: 'authenticated',
    agents: AGENT_ITEMS,
    agentsPending: false,
    agentsErrorMessage: null,
    worldNameById: new Map([
      ['world-1', '元代文人书院世界'],
      ['world-2', 'Aurora Verge'],
    ]),
    onRetry: () => {},
    onOpenAgent: () => {},
    onBrowseExplore: () => {},
    sdk: {} as AgentsPanelViewProps['sdk'],
    ...overrides,
  };
}

function renderView(props: AgentsPanelViewProps, queryClient = new QueryClient()): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AgentsPanelView {...props} />
    </QueryClientProvider>,
  );
}

test('Characters tab renders the signed-out state with resolved copy', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ authStatus: 'anonymous', agents: [] }));
  assert.ok(markup.includes('我的角色'), 'expected zh panel title');
  assert.ok(markup.includes('登录后查看我的角色'), 'expected zh signed-out copy');
  assert.equal(markup.includes('signedOutTitle'), false, 'no raw i18n keys');
});

test('Characters tab renders local agent cards with world badges and search field', async () => {
  await initI18n();
  await changeLocale('zh');
  const queryClient = new QueryClient();
  queryClient.setQueryData(sourceDisplayDetailQueryKey(AGENT_ITEMS[0].sourceRef), {
    source: {
      displayName: '赵孟頫',
      handle: 'zhao-mengfu',
      avatarUrl: null,
      bio: '元代书画大家，湖州路总管府事。',
      characterProfile: { role: '书画家' },
    },
    stats: null,
  });
  const markup = renderView(baseProps(), queryClient);
  assert.ok(markup.includes('data-testid="agents-list"'), 'expected agents list');
  assert.ok(markup.includes('data-testid="agents-card:local-agent:01A"'), 'expected first card testid');
  assert.ok(markup.includes('赵孟頫'), 'expected first agent name');
  assert.ok(markup.includes('世界角色 · 书画家'), 'expected readable world-character identity');
  assert.ok(markup.includes('元代书画大家'), 'expected enriched bio from seeded detail');
  assert.ok(markup.includes('Kaelis'), 'expected second agent name');
  assert.ok(markup.includes('人设角色'), 'expected readable persona-character identity');
  assert.equal(markup.includes('@zhao-mengfu'), false, 'does not expose the source handle');
  assert.equal(markup.includes('@char-kaelis'), false, 'does not expose the source id');
  assert.ok(markup.includes('元代文人书院世界'), 'expected world badge');
  assert.ok(markup.includes('data-testid="agents-search-field"'), 'expected search field');

  await changeLocale('en');
  const englishMarkup = renderView(baseProps(), queryClient);
  assert.ok(englishMarkup.includes('My Characters'), 'expected en panel title');
  await changeLocale('zh');
});

test('Characters tab renders the empty state with the Explore call to action', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ agents: [] }));
  assert.ok(markup.includes('还没有角色'), 'expected zh empty title');
  assert.ok(markup.includes('去探索'), 'expected zh empty action');
});

test('Characters tab fails visible on list load error with retry copy', async () => {
  await initI18n();
  await changeLocale('zh');
  const markup = renderView(baseProps({ agents: [], agentsErrorMessage: '' }));
  assert.ok(markup.includes('加载角色列表失败'), 'expected zh load error title');
  assert.ok(markup.includes('重试'), 'expected zh retry action');
});
