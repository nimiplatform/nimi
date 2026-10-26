import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopAIExecutionRoute, DesktopAIExecutionState, type DesktopAIActivitySnapshot, type DesktopAIExecution, type DesktopAIUsageSummary, type DesktopAIUsageTotals } from '@nimiplatform/sdk/runtime/generated';
import { systemEntryDayRange, systemEntryTimestamp } from '../src/shell/renderer/features/system-entry/system-entry-time.js';
import { projectSystemEntryUsage, projectSystemEntryWork } from '../src/shell/renderer/features/system-entry/system-entry-ai-model.js';
import { projectSystemEntryAttention, projectSystemEntryRecent } from '../src/shell/renderer/features/system-entry/system-entry-source-model.js';
import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';

const local = DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_LOCAL;
const cloud = DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD;
const observedAt = systemEntryTimestamp(Date.parse('2026-10-23T03:00:00Z'));
function totals(attemptCount = '0'): DesktopAIUsageTotals {
  return { attemptCount, activeAttemptCount: '0', pendingUsageCount: '0', measuredAttemptCount: attemptCount,
    inputTokens: '0', outputTokens: '0', cachedInputTokens: '0', reasoningOutputTokens: '0', computeMs: '0', unpricedAttemptCount: '0' };
}
function execution(id: string, parentWorkId: string, modelId: string): DesktopAIExecution {
  return { attemptId: id, parentWorkId, parentWorkKind: parentWorkId ? 'agent-turn' : '', sourceKind: 'local-agent', sourceId: 'agent-1',
    sourceLabel: 'Partner', capability: 'text.generate', models: [{ modelId, displayName: modelId, role: 'primary', providerId: 'provider-1' }],
    route: local, state: DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_RUNNING, startedAt: observedAt, observedAt };
}
function summary(): DesktopAIUsageSummary {
  const range = systemEntryDayRange(Date.parse('2026-10-23T03:00:00Z'), 'Asia/Shanghai');
  return { generationId: 'runtime-1', readAt: observedAt, fromTime: range.fromTime, toTime: range.toTime, effectiveTo: observedAt,
    totals: totals('3'), groups: [
      { sourceKind: 'home', capability: 'text.generate', models: [], route: local, totals: totals('2'), estimates: [] },
      { sourceKind: 'app', capability: 'text.generate', models: [], route: cloud, totals: totals('1'), estimates: [] },
    ], groupsComplete: true, estimates: [], sourceCoverage: [{ source: 'home', activityComplete: true, usageComplete: true }],
    sourceComplete: true, timeComplete: true, quantityComplete: true, attributionComplete: true, coverageFrom: range.fromTime, coverageTo: observedAt, partialReasons: [] };
}

test('local natural day uses 23/25-hour DST days and non-hour offsets', () => {
  const spring = systemEntryDayRange(Date.parse('2026-03-08T15:00:00Z'), 'America/New_York');
  const autumn = systemEntryDayRange(Date.parse('2026-11-01T15:00:00Z'), 'America/New_York');
  assert.equal(spring.endMs - spring.startMs, 23 * 3_600_000);
  assert.equal(autumn.endMs - autumn.startMs, 25 * 3_600_000);
  const nepal = systemEntryDayRange(Date.parse('2026-10-23T03:00:00Z'), 'Asia/Kathmandu');
  assert.equal(new Date(nepal.startMs).toISOString(), '2026-10-22T18:15:00.000Z');
  assert.equal(new Date(nepal.endMs).toISOString(), '2026-10-23T18:15:00.000Z');
  assert.equal(systemEntryDayRange(nepal.endMs, 'Asia/Kathmandu').startMs, nepal.endMs);
});

test('children form one work card while unassociated execution prevents a complete work count', () => {
  const snapshot: DesktopAIActivitySnapshot = { generationId: 'runtime-1', revision: '1', observedAt,
    executions: [execution('a', 'turn-1', 'actual-model-a'), execution('b', 'turn-1', 'actual-model-b'), execution('c', '', 'actual-model-c')],
    sourceCoverage: [{ source: 'agent', activityComplete: true, usageComplete: true }], recordsComplete: true,
    knownActiveAttemptCount: '3', workCountKnown: false, knownWorkCount: '1', partialReasons: ['parent_unknown'] };
  const view = projectSystemEntryWork({ status: 'ready', value: snapshot, error: null }, 'en');
  assert.equal(view.items.length, 2);
  assert.equal(view.total, null);
  assert.equal(view.status, 'partial');
  assert.match(view.items[0]!.detail, /actual-model-a.*actual-model-b/);
  assert.match(view.items[1]!.detail, /Unassociated work/);
  const disconnected = projectSystemEntryWork({ status: 'unavailable', value: snapshot, error: 'connection-ended' }, 'en');
  assert.equal(disconnected.total, null);
  assert.deepEqual(disconnected.items, []);
});

test('usage keeps estimates separated and reports missing price/coverage without a zero-cost claim', () => {
  const range = systemEntryDayRange(Date.parse('2026-10-23T03:00:00Z'), 'Asia/Shanghai');
  const value = summary();
  value.sourceComplete = false; value.timeComplete = false;
  value.totals!.unpricedAttemptCount = '1'; value.totals!.pendingUsageCount = '1';
  value.estimates = [ { currency: 'USD', estimatedAmount: '0.012', pricingBasis: 'captured' }, { currency: 'EUR', estimatedAmount: '0.02', pricingBasis: 'captured' } ];
  const view = projectSystemEntryUsage({ status: 'ready', value, error: null }, range, 'en');
  assert.equal(view.attempts, '3'); assert.equal(view.localAttempts, '2'); assert.equal(view.cloudAttempts, '1');
  assert.deepEqual(view.costs, [{ currency: 'USD', estimate: '0.012' }, { currency: 'EUR', estimate: '0.02' }]);
  assert.equal(view.partial, true);
  assert.match(view.note, /Day coverage is incomplete/);
  assert.match(view.note, /Recorded since/);
  assert.match(view.note, /not covered/); assert.match(view.note, /pending/); assert.match(view.note, /cannot be estimated/);
  const missing = projectSystemEntryUsage({ status: 'unavailable', value: null, error: 'read-failed' }, range, 'en');
  assert.equal(missing.attempts, null); assert.deepEqual(missing.costs, []);
});

test('route totals are withheld when group coverage is incomplete or does not match the total', () => {
  const range = systemEntryDayRange(Date.parse('2026-10-23T03:00:00Z'), 'Asia/Shanghai');
  const value = summary(); value.groups = value.groups.slice(0, 1);
  const view = projectSystemEntryUsage({ status: 'ready', value, error: null }, range, 'en');
  assert.equal(view.attempts, '3'); assert.equal(view.localAttempts, null); assert.equal(view.cloudAttempts, null); assert.equal(view.partial, true);
});

test('failed conversation reads do not turn prepared Agents into recent conversations', () => {
  const view = projectSystemEntryRecent({ status: 'ready', agentCount: 2, observedAt: null, locale: 'en', partners: [
    { localAgentRef: 'agent-1', displayName: 'Known', avatarUrl: null, lastMessageText: 'private message', conversationTitle: null, updatedAtMs: 100, hasUnread: true },
    { localAgentRef: 'agent-2', displayName: 'Unconfirmed', avatarUrl: null, lastMessageText: null, conversationTitle: null, updatedAtMs: null, hasUnread: false },
  ] });
  assert.equal(view.status, 'partial'); assert.equal(view.total, null); assert.equal(view.items.length, 1);
  assert.doesNotMatch(JSON.stringify(view), /private message|Unconfirmed/);
});

test('attention honors the user read view, keeps read open todos, and drops newer terminal revisions', () => {
  const record = (activityId: string, kind: 'activity' | 'todo', todoState: 'open' | 'completed' | null, changeSeq: string): NimiAppActivityRecord => ({
    activityId, key: activityId, revision: Number(changeSeq), kind, todoState, attention: true,
    title: activityId, summary: '', objectRef: null, type: 'example.note', data: {}, agent: null,
    source: { kind: 'app', sourceRef: 'app-source', appId: 'app.example', displayName: 'Example', available: true },
    occurredAt: '2026-10-23T00:00:00Z', publishedAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z', changeSeq,
    userView: { readThroughRevision: Number(changeSeq), unread: false, needsAttention: false },
  });
  const pending = { status: 'ready' as const, complete: true, hasMore: false, error: null,
    records: [record('still-open', 'todo', 'open', '1'), record('closed-later', 'todo', 'open', '1')] };
  const recent = { ...pending, records: [record('read-event', 'activity', null, '1'), record('closed-later', 'todo', 'completed', '2')] };
  const view = projectSystemEntryAttention({ pending, recent, observedAt: null, downloadFailures: [], downloadsComplete: true, locale: 'en' });
  assert.equal(view.total, 1);
  assert.deepEqual(view.items.map(item => item.id), ['still-open']);
});
