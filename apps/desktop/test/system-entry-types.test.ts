import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSystemEntryActionOffered,
  parseSystemEntryActionRequest,
  parseSystemEntryProjection,
  type SystemEntryProjection,
} from '../src/shell/shared/system-entry-types.js';

function projection(): SystemEntryProjection {
  const empty = { status: 'available', observedAt: '2026-10-23T00:00:00.000Z', total: 0, items: [] } as const;
  return {
    generation: 'host-generation', revision: 1, locale: 'zh', colorScheme: 'light', observedAt: empty.observedAt, service: 'running',
    attention: empty, work: empty, recent: empty, apps: empty, downloads: empty,
    usage: { status: 'partial', observedAt: empty.observedAt, periodLabel: '今日', attempts: '1', localAttempts: '1', cloudAttempts: '0', costs: [], partial: true, note: '记录始于今天' },
    notificationsEnabled: true, notificationsPausedUntil: 0,
  };
}

test('system entry rejects arbitrary commands and extra authority-bearing fields', () => {
  assert.throws(() => parseSystemEntryActionRequest({ generation: 'g', revision: 1, action: { kind: 'invoke', command: 'product_control_record_set' } }));
  assert.throws(() => parseSystemEntryActionRequest({ generation: 'g', revision: 1, action: { kind: 'home', accountId: 'foreign' } }));
  assert.throws(() => parseSystemEntryActionRequest({ generation: 'g', revision: 1, action: { kind: 'focus-app', appId: 'guess' } }));
  assert.throws(() => parseSystemEntryProjection({ ...projection(), credential: 'never-forward' }));
  assert.throws(() => parseSystemEntryProjection({ ...projection(), colorScheme: 'dark; background: red' }));
  for (const source of [{ kind: 'installed', launchSelector: [256] }, { kind: 'installed', launchSelector: [] },
    { kind: 'installed', launchSelector: Array(161).fill(1) }, { kind: 'local-development', selector: 'x', credential: 'never' }]) {
    assert.throws(() => parseSystemEntryActionRequest({ generation: 'g', revision: 1, action: { kind: 'focus-app', entryKey: 'entry', source } }));
  }
});

test('source actions must still be offered by the current available source', () => {
  const action = { kind: 'focus-app', entryKey: 'source-qualified-entry', source: { kind: 'installed', launchSelector: [12, 34] } } as const;
  const current = projection();
  const next = { ...current, apps: { ...current.apps, total: 1, items: [{ id: 'a', title: 'App', detail: '', action }] } };
  assert.equal(isSystemEntryActionOffered(next, action), true);
  assert.equal(isSystemEntryActionOffered(current, action), false);
  assert.equal(isSystemEntryActionOffered({ ...next, apps: { ...next.apps, status: 'unavailable' } }, action), false);
  assert.equal(isSystemEntryActionOffered(next, { ...action, entryKey: 'other-source' }), false);
  assert.equal(isSystemEntryActionOffered(next, { ...action, source: { kind: 'installed', launchSelector: [12, 35] } }), false);
});

test('display schema preserves unknown counts and exact large integer quantities', () => {
  const input = projection();
  const parsed = parseSystemEntryProjection({ ...input, work: { ...input.work, total: null, status: 'unavailable' }, usage: { ...input.usage, attempts: '9007199254740993', costs: [{ currency: 'USD', estimate: '0.0101' }] } });
  assert.equal(parsed.work.total, null);
  assert.equal(parsed.usage.attempts, '9007199254740993');
  assert.equal(parsed.usage.partial, true);
});

test('display schema rejects inconsistent totals, duplicate identities and non-finite context', () => {
  const input = projection();
  const row = { id: 'same', title: 'App', detail: '', action: null };
  assert.throws(() => parseSystemEntryProjection({ ...input, apps: { ...input.apps, total: 1, items: [row, row] } }));
  assert.throws(() => parseSystemEntryProjection({ ...input, apps: { ...input.apps, total: 0, items: [row] } }));
  assert.throws(() => parseSystemEntryProjection({ ...input, revision: Number.NaN }));
  assert.throws(() => parseSystemEntryProjection({ ...input, usage: { ...input.usage, costs: [{ currency: 'USD', estimate: 'NaN' }] } }));
});
