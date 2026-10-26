import assert from 'node:assert/strict';
import test from 'node:test';
import type { DesktopAIActivitySnapshot, GetDesktopAIUsageSummaryResponse } from '@nimiplatform/sdk/runtime/generated';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { createSystemEntryAIObserver } from '../src/shell/renderer/features/system-entry/system-entry-ai-observer.js';
import { systemEntryTimestamp } from '../src/shell/renderer/features/system-entry/system-entry-time.js';

type Audit = Pick<ReturnType<DesktopRendererSdkPort['accountProduct']>['audit'], 'getDesktopAIActivitySnapshot' | 'subscribeDesktopAIActivity' | 'getDesktopAIUsageSummary'>;
type GetDesktopAIUsageSummaryRequest = Parameters<Audit['getDesktopAIUsageSummary']>[0];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function snapshot(revision = '1'): DesktopAIActivitySnapshot {
  return { generationId: 'runtime-a', revision, observedAt: systemEntryTimestamp(Date.parse('2026-10-23T03:00:00Z')),
    executions: [], sourceCoverage: [{ source: 'home', activityComplete: true, usageComplete: true }], recordsComplete: true,
    knownActiveAttemptCount: '0', workCountKnown: true, knownWorkCount: '0', partialReasons: [] };
}
function usage(request: GetDesktopAIUsageSummaryRequest): GetDesktopAIUsageSummaryResponse {
  return { summary: { generationId: 'runtime-a', fromTime: request.fromTime, toTime: request.toTime, readAt: request.fromTime, effectiveTo: request.fromTime,
    totals: { attemptCount: '0', activeAttemptCount: '0', pendingUsageCount: '0', measuredAttemptCount: '0', inputTokens: '0', outputTokens: '0', cachedInputTokens: '0', reasoningOutputTokens: '0', computeMs: '0', unpricedAttemptCount: '0' },
    groups: [], groupsComplete: true, estimates: [], sourceCoverage: [], sourceComplete: false, timeComplete: false, quantityComplete: true, attributionComplete: true,
    coverageFrom: request.fromTime, coverageTo: request.fromTime, partialReasons: ['not_all_sources'] } };
}
function activityStream() {
  const queue: Array<DesktopAIActivitySnapshot | null> = [];
  let wake: (() => void) | undefined;
  return {
    push(value: DesktopAIActivitySnapshot | null) { queue.push(value); wake?.(); },
    async *read(signal?: AbortSignal) {
      while (!signal?.aborted) {
        if (!queue.length) {
          await new Promise<void>((resolve) => { wake = () => resolve(); signal?.addEventListener('abort', wake, { once: true }); });
          if (wake) signal?.removeEventListener('abort', wake);
          wake = undefined;
        }
        if (signal?.aborted) return;
        const value = queue.shift();
        if (value === null) return;
        if (value) yield value;
      }
    },
  };
}

test('AI observation rejects older revisions and clears current work when the stream ends', async () => {
  const stream = activityStream();
  const audit: Audit = {
    getDesktopAIActivitySnapshot: async (request) => { assert.deepEqual(request, { limit: 100 }); return { snapshot: snapshot() }; },
    subscribeDesktopAIActivity: (request, options) => { assert.deepEqual(request, { limit: 100 }); return stream.read(options?.signal); },
    getDesktopAIUsageSummary: async (request) => usage(request),
  };
  const observer = createSystemEntryAIObserver({ audit, onChange: () => {}, now: () => Date.parse('2026-10-23T03:00:00Z'), timeZone: () => 'UTC' });
  try {
    observer.start(); await flush();
    stream.push(snapshot('3')); await flush();
    stream.push(snapshot('2')); await flush();
    assert.equal(observer.getSnapshot().activity.value?.revision, '3');
    stream.push(null); await flush();
    assert.equal(observer.getSnapshot().activity.status, 'unavailable');
    assert.equal(observer.getSnapshot().activity.value, null);
  } finally { observer.stop(); }
});

test('a usage response crossing midnight is discarded and a fresh half-open day is read', async () => {
  const stream = activityStream();
  let now = Date.parse('2026-10-23T23:59:59Z');
  let finish!: (value: GetDesktopAIUsageSummaryResponse) => void;
  const requests: GetDesktopAIUsageSummaryRequest[] = [];
  const audit: Audit = {
    getDesktopAIActivitySnapshot: async () => ({ snapshot: snapshot() }),
    subscribeDesktopAIActivity: (_request, options) => stream.read(options?.signal),
    getDesktopAIUsageSummary: async (request) => {
      requests.push(request);
      if (requests.length === 1) return new Promise((resolve) => { finish = resolve; });
      return usage(request);
    },
  };
  const observer = createSystemEntryAIObserver({ audit, onChange: () => {}, now: () => now, timeZone: () => 'UTC' });
  try {
    observer.start(); await flush();
    now = Date.parse('2026-10-24T00:00:01Z'); finish(usage(requests[0]!)); await flush(); await flush();
    assert.equal(requests.length, 2);
    assert.equal(observer.getSnapshot().range.date, '2026-10-24');
    assert.deepEqual(requests[0]!.toTime, requests[1]!.fromTime);
    assert.deepEqual(observer.getSnapshot().usage.value?.fromTime, requests[1]!.fromTime);
  } finally { observer.stop(); }
});

test('explicit refresh obtains a new activity snapshot and stop ignores late usage', async () => {
  const stream = activityStream();
  let snapshots = 0, updates = 0;
  let finish!: (value: GetDesktopAIUsageSummaryResponse) => void;
  let pendingRequest!: GetDesktopAIUsageSummaryRequest;
  const audit: Audit = {
    getDesktopAIActivitySnapshot: async () => { snapshots += 1; return { snapshot: snapshot(String(snapshots)) }; },
    subscribeDesktopAIActivity: (_request, options) => stream.read(options?.signal),
    getDesktopAIUsageSummary: async (request) => {
      if (snapshots === 1) return usage(request);
      pendingRequest = request;
      return new Promise((resolve) => { finish = resolve; });
    },
  };
  const observer = createSystemEntryAIObserver({ audit, onChange: () => { updates += 1; }, now: () => Date.parse('2026-10-23T03:00:00Z'), timeZone: () => 'UTC' });
  observer.start(); await flush();
  const refreshing = observer.refresh(); await flush();
  assert.equal(snapshots, 2);
  observer.stop(); const before = updates;
  finish(usage(pendingRequest)); await refreshing; await flush();
  assert.equal(updates, before);
});
