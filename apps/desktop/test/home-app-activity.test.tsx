import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NimiAppActivityRecord, NimiAppActivityViewSnapshot } from '@nimiplatform/sdk/app';
import { changeLocale, initI18n, productionDesktopI18n } from '../src/shell/renderer/i18n';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context.js';
import { HomeAppActivityView, type HomeActivityNotice } from '../src/shell/renderer/features/home/home-app-activity.js';
import { applyActivityFacet, groupByOccurredDay } from '../src/shell/renderer/features/home/home-app-activity-model.js';

(globalThis as { React?: typeof React }).React = React;

const NOW = new Date(2026, 8, 23, 15, 0, 0);

function record(n: number, overrides: Partial<NimiAppActivityRecord> = {}): NimiAppActivityRecord {
  return {
    activityId: `act_${String(n).padStart(26, '0')}`,
    source: { kind: 'app', sourceRef: 'src_studio', appId: 'com.example.studio', displayName: 'Studio', available: true },
    key: `draft-${n}`,
    revision: 1,
    kind: 'todo',
    todoState: 'open',
    attention: true,
    title: `Review draft ${n}`,
    summary: `Chapter ${n} is ready for review`,
    objectRef: `draft:${n}`,
    type: 'com.example.studio.draft-review.v1',
    data: { chapter: n },
    agent: null,
    occurredAt: new Date(2026, 8, 23, 10, n).toISOString(),
    publishedAt: new Date(2026, 8, 23, 10, n).toISOString(),
    updatedAt: new Date(2026, 8, 23, 10, n).toISOString(),
    changeSeq: String(n),
    userView: { readThroughRevision: 0, unread: true, needsAttention: true },
    ...overrides,
  };
}

function snapshot(records: NimiAppActivityRecord[], status: NimiAppActivityViewSnapshot['status'] = 'ready', hasMore = false): NimiAppActivityViewSnapshot {
  return { status, records, complete: status === 'ready' && !hasMore, hasMore, error: null };
}

function render(input: {
  pending?: NimiAppActivityViewSnapshot;
  recent?: NimiAppActivityViewSnapshot;
  facetKey?: string | null;
  notices?: Record<string, HomeActivityNotice>;
}) {
  return renderToStaticMarkup(
    <DesktopI18nResourceProvider resource={productionDesktopI18n}>
    <HomeAppActivityView
      pending={input.pending ?? snapshot([])}
      recent={input.recent ?? snapshot([])}
      facetKey={input.facetKey ?? null}
      now={NOW}
      busy={{}}
      notices={input.notices ?? {}}
      onFacet={() => undefined}
      onOpen={() => undefined}
      onMarkRead={() => undefined}
      onRetry={() => undefined}
      onLoadMore={() => undefined}
    />
    </DesktopI18nResourceProvider>,
  );
}

test('pending keeps read open todos and shows an open action only for App source objects', async () => {
  await initI18n(); await changeLocale('en');
  const unread = record(1);
  const read = record(2, { userView: { readThroughRevision: 1, unread: false, needsAttention: false } });
  const html = render({ pending: snapshot([unread, read]), recent: snapshot([unread, read]) });
  assert.match(html, /data-testid="home-app-activity-item:act_0+1" data-unread="true"/);
  assert.match(html, /data-testid="home-app-activity-item:act_0+2" data-unread="false"/);
  assert.equal((html.match(/Mark as read/g) ?? []).length, 1, 'only the unread item offers mark as read');
  assert.equal((html.match(/>Open</g) ?? []).length, 2);
  assert.match(html, /Needs attention/);
  // Open todos stay in Pending only; Recent shows its empty state.
  assert.match(html, /No recent activity from your apps yet\./);
  assert.doesNotMatch(html, /runtimeConfig\.overview\.appActivity\./);
});

test('unknown extension types use the standard card and Runtime turns stay read-only summaries', async () => {
  await initI18n(); await changeLocale('en');
  const completed = record(3, {
    revision: 2,
    todoState: 'completed',
    type: 'org.unknown.vendor.thing.v7',
    data: { opaque: true },
    userView: { readThroughRevision: 1, unread: true, needsAttention: false },
  });
  const runtimeTurn = record(4, {
    source: { kind: 'runtime-agent', sourceRef: 'src_runtime', appId: null, displayName: null, available: true },
    kind: 'activity',
    todoState: null,
    attention: false,
    title: 'Conversation reply',
    summary: null,
    objectRef: null,
    type: 'nimi.runtime.agent-conversation.turn-completed.v1',
    data: null,
    agent: { agentRef: 'agr_nova', displayName: 'Nova' },
    userView: { readThroughRevision: 0, unread: true, needsAttention: false },
  });
  const html = render({ recent: snapshot([runtimeTurn, completed]) });
  assert.match(html, /Review draft 3/);
  assert.match(html, /Chapter 3 is ready for review/);
  assert.match(html, /Completed/);
  assert.doesNotMatch(html, /opaque/);
  assert.match(html, /Replied in a conversation/);
  assert.match(html, /Nova · /);
  assert.equal((html.match(/>Open</g) ?? []).length, 1, 'the Runtime turn has no open action');
  assert.match(html, /aria-pressed="false"[^>]*>.*Nova/s, 'Agent grouping is offered');
});

test('an unavailable activity read only affects the activity region', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({ pending: snapshot([], 'unavailable'), recent: snapshot([], 'unavailable') });
  assert.match(html, /data-testid="home-app-activity-unavailable"/);
  assert.match(html, /Activity from your apps is temporarily unavailable\./);
  assert.match(html, /Try again/);
});

test('open results render as typed notices without claiming success', async () => {
  await initI18n(); await changeLocale('en');
  const item = record(5);
  const html = render({
    pending: snapshot([item]),
    notices: { [item.activityId]: { tone: 'warning', text: 'Studio could not find this item anymore.' } },
  });
  assert.match(html, /role="status"[^>]*>Studio could not find this item anymore\./);
});

test('day groups follow occurred time and facets filter by source or Agent', () => {
  const lateDelivered = record(6, {
    occurredAt: new Date(2026, 8, 22, 23, 30).toISOString(),
    publishedAt: new Date(2026, 8, 23, 9, 0).toISOString(),
  });
  const today = record(7, { agent: { agentRef: 'agr_nova', displayName: 'Nova' } });
  const groups = groupByOccurredDay([today, lateDelivered], NOW);
  assert.deepEqual(groups.map((group) => [group.relative, group.records.map((item) => item.key)]), [
    ['today', ['draft-7']],
    ['yesterday', ['draft-6']],
  ]);
  assert.deepEqual(applyActivityFacet([today, lateDelivered], 'agent:agr_nova').map((item) => item.key), ['draft-7']);
  assert.deepEqual(applyActivityFacet([today, lateDelivered], 'source:src_studio').length, 2);
});

test('a truncated listing never presents its loaded items as the full set', async () => {
  await initI18n(); await changeLocale('en');
  const pendingItems = Array.from({ length: 3 }, (_, index) => record(10 + index));
  const recentItems = [record(20, { kind: 'activity', todoState: null })];
  const html = render({
    pending: snapshot(pendingItems, 'ready', true),
    recent: snapshot(recentItems, 'ready', true),
  });
  assert.match(html, />3\+ open</, 'the pending count shows that more items exist');
  assert.equal((html.match(/>Show more</g) ?? []).length, 2, 'pending and recent both offer loading the remaining items');
  const complete = render({ pending: snapshot(pendingItems), recent: snapshot(recentItems) });
  assert.match(complete, />3 open</);
  assert.doesNotMatch(complete, />Show more</);
});

test('a paused listing keeps its load entry even when nothing is shown yet', async () => {
  await initI18n(); await changeLocale('en');
  // Recent paused on a page that held only open todos, which Pending shows.
  const openTodo = record(30);
  const paused = render({ pending: snapshot([], 'ready', true), recent: snapshot([openTodo], 'ready', true) });
  assert.doesNotMatch(paused, /Nothing from your apps is waiting for you\.|No recent activity from your apps yet\./);
  assert.equal((paused.match(/>Show more</g) ?? []).length, 2, 'both regions keep a load entry');
  // Only a completely listed empty region shows its empty state.
  const incomplete = render({ pending: { ...snapshot([]), complete: false }, recent: { ...snapshot([]), complete: false } });
  assert.doesNotMatch(incomplete, /Nothing from your apps is waiting for you\.|No recent activity from your apps yet\./);
  const empty = render({ pending: snapshot([]), recent: snapshot([]) });
  assert.match(empty, /Nothing from your apps is waiting for you\./);
  assert.match(empty, /No recent activity from your apps yet\./);
});
