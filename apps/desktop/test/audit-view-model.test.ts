import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  resolveAuditSource,
  resolveAuditModality,
  resolveAuditReasonCode,
  resolveAuditDetail,
  resolveAuditPolicyGate,
  resolveAuditLabel,
  filterAuditEvents,
  summarizeAuditReasons,
  summarizeAuditEventTypes,
  summarizeAuditSources,
  summarizeAuditModalities,
  buildAuditDiagnosticsText,
} from '../src/shell/renderer/features/runtime-config/domain/diagnostics/audit-view-model';

type AuditEvent = Parameters<typeof resolveAuditSource>[0];

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'test-001',
    eventType: 'inference_invoked',
    occurredAt: '2026-03-02T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveAuditSource
// ---------------------------------------------------------------------------

describe('resolveAuditSource', () => {
  test('returns event.source when present', () => {
    assert.equal(resolveAuditSource(makeEvent({ source: 'local-runtime' })), 'local-runtime');
  });

  test('falls back to payload.source', () => {
    assert.equal(resolveAuditSource(makeEvent({ payload: { source: 'token-api' } })), 'token-api');
  });

  test('returns "-" when neither present', () => {
    assert.equal(resolveAuditSource(makeEvent()), '-');
  });
});

// ---------------------------------------------------------------------------
// resolveAuditModality
// ---------------------------------------------------------------------------

describe('resolveAuditModality', () => {
  test('returns event.modality when present', () => {
    assert.equal(resolveAuditModality(makeEvent({ modality: 'chat' })), 'chat');
  });

  test('falls back to payload.modality', () => {
    assert.equal(resolveAuditModality(makeEvent({ payload: { modality: 'image' } })), 'image');
  });

  test('returns "-" when neither present', () => {
    assert.equal(resolveAuditModality(makeEvent()), '-');
  });
});

// ---------------------------------------------------------------------------
// resolveAuditReasonCode
// ---------------------------------------------------------------------------

describe('resolveAuditReasonCode', () => {
  test('returns event.reasonCode when present', () => {
    assert.equal(resolveAuditReasonCode(makeEvent({ reasonCode: 'RUNTIME_UNAVAILABLE' })), 'RUNTIME_UNAVAILABLE');
  });

  test('falls back to payload.reasonCode', () => {
    assert.equal(resolveAuditReasonCode(makeEvent({ payload: { reasonCode: 'TIMEOUT' } })), 'TIMEOUT');
  });

  test('returns "-" when neither present', () => {
    assert.equal(resolveAuditReasonCode(makeEvent()), '-');
  });
});

// ---------------------------------------------------------------------------
// resolveAuditDetail
// ---------------------------------------------------------------------------

describe('resolveAuditDetail', () => {
  test('returns event.detail when present', () => {
    assert.equal(resolveAuditDetail(makeEvent({ detail: 'connection refused' })), 'connection refused');
  });

  test('falls back to payload.detail', () => {
    assert.equal(resolveAuditDetail(makeEvent({ payload: { detail: 'timeout occurred' } })), 'timeout occurred');
  });

  test('falls back to payload.error', () => {
    assert.equal(resolveAuditDetail(makeEvent({ payload: { error: 'err msg' } })), 'err msg');
  });

  test('returns "-" when neither present', () => {
    assert.equal(resolveAuditDetail(makeEvent()), '-');
  });
});

// ---------------------------------------------------------------------------
// resolveAuditPolicyGate
// ---------------------------------------------------------------------------

describe('resolveAuditPolicyGate', () => {
  test('string policy gate', () => {
    assert.equal(resolveAuditPolicyGate(makeEvent({ payload: { policyGate: 'allow' } })), 'allow');
  });

  test('object policy gate → JSON', () => {
    const result = resolveAuditPolicyGate(makeEvent({ payload: { policyGate: { mode: 'deny' } } }));
    assert.ok(result.includes('deny'));
  });

  test('long object → truncated', () => {
    const large = { data: 'x'.repeat(200) };
    const result = resolveAuditPolicyGate(makeEvent({ payload: { policyGate: large } }));
    assert.ok(result.endsWith('...'));
    assert.ok(result.length <= 184);
  });

  test('absent → "-"', () => {
    assert.equal(resolveAuditPolicyGate(makeEvent()), '-');
  });
});

// ---------------------------------------------------------------------------
// resolveAuditLabel
// ---------------------------------------------------------------------------

describe('resolveAuditLabel', () => {
  test('combines all fields with dot separator', () => {
    const label = resolveAuditLabel(makeEvent({
      source: 'local-runtime',
      modality: 'chat',
      modelId: 'gpt-4',
    }));
    assert.ok(label.includes('inference_invoked'));
    assert.ok(label.includes('local-runtime'));
    assert.ok(label.includes('chat'));
    assert.ok(label.includes('gpt-4'));
  });

  test('uses "-" for missing fields', () => {
    const label = resolveAuditLabel(makeEvent());
    assert.ok(label.includes(' · - · '));
  });
});

// ---------------------------------------------------------------------------
// filterAuditEvents
// ---------------------------------------------------------------------------

describe('filterAuditEvents', () => {
  const events: AuditEvent[] = [
    makeEvent({ id: '1', eventType: 'inference_invoked', source: 'local-runtime', modality: 'chat', reasonCode: 'OK' }),
    makeEvent({ id: '2', eventType: 'inference_failed', source: 'token-api', modality: 'image', reasonCode: 'TIMEOUT' }),
    makeEvent({ id: '3', eventType: 'engine_started', source: 'local-runtime' }),
  ];

  test('no filters → returns all', () => {
    const result = filterAuditEvents({ audits: events, eventType: 'all', source: 'all', modality: 'all', reasonCodeQuery: '' });
    assert.equal(result.length, 3);
  });

  test('filter by eventType', () => {
    const result = filterAuditEvents({ audits: events, eventType: 'inference_invoked', source: 'all', modality: 'all', reasonCodeQuery: '' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  test('filter by source', () => {
    const result = filterAuditEvents({ audits: events, eventType: 'all', source: 'token-api', modality: 'all', reasonCodeQuery: '' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  test('filter by modality', () => {
    const result = filterAuditEvents({ audits: events, eventType: 'all', source: 'all', modality: 'chat', reasonCodeQuery: '' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  test('filter by reasonCode query (case insensitive)', () => {
    const result = filterAuditEvents({ audits: events, eventType: 'all', source: 'all', modality: 'all', reasonCodeQuery: 'timeout' });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  test('filter by time range', () => {
    const earlyEvents: AuditEvent[] = [
      makeEvent({ id: '1', occurredAt: '2026-03-01T10:00:00Z' }),
      makeEvent({ id: '2', occurredAt: '2026-03-02T10:00:00Z' }),
      makeEvent({ id: '3', occurredAt: '2026-03-03T10:00:00Z' }),
    ];
    const result = filterAuditEvents({
      audits: earlyEvents,
      eventType: 'all',
      source: 'all',
      modality: 'all',
      reasonCodeQuery: '',
      timeRange: { from: '2026-03-02T00:00:00Z', to: '2026-03-02T23:59:59Z' },
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '2');
  });

  test('combined filters', () => {
    const result = filterAuditEvents({
      audits: events,
      eventType: 'inference_invoked',
      source: 'local-runtime',
      modality: 'chat',
      reasonCodeQuery: 'ok',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '1');
  });

  test('empty audits → empty result', () => {
    const result = filterAuditEvents({ audits: [], eventType: 'all', source: 'all', modality: 'all', reasonCodeQuery: '' });
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// summarizeAuditEventTypes
// ---------------------------------------------------------------------------

describe('summarizeAuditEventTypes', () => {
  test('counts event types correctly', () => {
    const events: AuditEvent[] = [
      makeEvent({ eventType: 'inference_invoked' }),
      makeEvent({ eventType: 'inference_invoked' }),
      makeEvent({ eventType: 'inference_failed' }),
    ];
    const result = summarizeAuditEventTypes(events);
    assert.equal(result.length, 2);
    assert.equal(result[0].eventType, 'inference_invoked');
    assert.equal(result[0].count, 2);
    assert.equal(result[1].eventType, 'inference_failed');
    assert.equal(result[1].count, 1);
  });

  test('empty audits → empty result', () => {
    assert.deepEqual(summarizeAuditEventTypes([]), []);
  });
});

// ---------------------------------------------------------------------------
// summarizeAuditSources
// ---------------------------------------------------------------------------

describe('summarizeAuditSources', () => {
  test('counts sources correctly', () => {
    const events: AuditEvent[] = [
      makeEvent({ source: 'local-runtime' }),
      makeEvent({ source: 'local-runtime' }),
      makeEvent({ source: 'token-api' }),
    ];
    const result = summarizeAuditSources(events);
    assert.equal(result.length, 2);
    assert.equal(result[0].source, 'local-runtime');
    assert.equal(result[0].count, 2);
  });

  test('ignores "-" source', () => {
    const events: AuditEvent[] = [makeEvent()]; // no source → resolves to "-"
    const result = summarizeAuditSources(events);
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// summarizeAuditModalities
// ---------------------------------------------------------------------------

describe('summarizeAuditModalities', () => {
  test('counts modalities correctly', () => {
    const events: AuditEvent[] = [
      makeEvent({ modality: 'chat' }),
      makeEvent({ modality: 'chat' }),
      makeEvent({ modality: 'image' }),
    ];
    const result = summarizeAuditModalities(events);
    assert.equal(result.length, 2);
    assert.equal(result[0].modality, 'chat');
    assert.equal(result[0].count, 2);
  });
});

// ---------------------------------------------------------------------------
// summarizeAuditReasons
// ---------------------------------------------------------------------------

describe('summarizeAuditReasons', () => {
  test('counts reason codes correctly', () => {
    const events: AuditEvent[] = [
      makeEvent({ reasonCode: 'OK' }),
      makeEvent({ reasonCode: 'OK' }),
      makeEvent({ reasonCode: 'TIMEOUT' }),
    ];
    const result = summarizeAuditReasons(events);
    assert.equal(result.length, 2);
    assert.equal(result[0].reasonCode, 'OK');
    assert.equal(result[0].count, 2);
  });

  test('sorted by count desc then alphabetically', () => {
    const events: AuditEvent[] = [
      makeEvent({ reasonCode: 'B_ERROR' }),
      makeEvent({ reasonCode: 'A_ERROR' }),
      makeEvent({ reasonCode: 'B_ERROR' }),
    ];
    const result = summarizeAuditReasons(events);
    assert.equal(result[0].reasonCode, 'B_ERROR');
    assert.equal(result[1].reasonCode, 'A_ERROR');
  });
});

// ---------------------------------------------------------------------------
// buildAuditDiagnosticsText
// ---------------------------------------------------------------------------

describe('buildAuditDiagnosticsText', () => {
  test('empty audits → message', () => {
    assert.equal(buildAuditDiagnosticsText([]), 'No audit events.');
  });

  test('produces pipe-separated lines', () => {
    const events: AuditEvent[] = [
      makeEvent({ source: 'local-runtime', modality: 'chat', modelId: 'gpt-4' }),
    ];
    const text = buildAuditDiagnosticsText(events);
    assert.ok(text.includes(' | '));
    assert.ok(text.includes('inference_invoked'));
    assert.ok(text.includes('source=local-runtime'));
    assert.ok(text.includes('modality=chat'));
    assert.ok(text.includes('model=gpt-4'));
  });

  test('multiple events → multiple lines', () => {
    const events: AuditEvent[] = [makeEvent({ id: '1' }), makeEvent({ id: '2' })];
    const lines = buildAuditDiagnosticsText(events).split('\n');
    assert.equal(lines.length, 2);
  });
});
