import { beforeEach, describe, expect, it } from 'vitest';
import { changeLocale, initI18n, i18n } from '@renderer/i18n/index.js';
import { getAuditEventDetail, getAuditEventScopeLabel, getAuditEventSeverityLabel, getAuditEventSeverityTone, getAuditEventTitle } from './audit-presentation.js';
import type { LookdevAuditEvent } from './types.js';

function makeAuditEvent(overrides: Partial<LookdevAuditEvent> = {}): LookdevAuditEvent {
  return {
    eventId: 'audit-1',
    batchId: 'b1',
    occurredAt: '2026-03-28T00:00:00.000Z',
    kind: 'batch_created',
    scope: 'batch',
    severity: 'info',
    ...overrides,
  };
}

describe('audit presentation', () => {
  beforeEach(async () => {
    await initI18n();
    await changeLocale('en');
  });

  it('formats batch and item event titles with localized interpolation', () => {
    expect(getAuditEventTitle(i18n.t.bind(i18n), makeAuditEvent({ count: 3 }))).toBe('Batch created for 3 items');
    expect(getAuditEventTitle(i18n.t.bind(i18n), makeAuditEvent({
      kind: 'item_committed',
      scope: 'item',
      severity: 'success',
      agentDisplayName: 'Iris',
      detail: 'AGENT_PORTRAIT',
    }))).toBe('Iris committed to AGENT_PORTRAIT');
  });

  it('falls back to an unknown-agent label when item event identity is missing', () => {
    expect(getAuditEventTitle(i18n.t.bind(i18n), makeAuditEvent({
      kind: 'item_commit_failed',
      scope: 'item',
      severity: 'error',
    }))).toBe('Unknown agent commit failed');
  });

  it('returns detail only for events that keep a secondary message', () => {
    expect(getAuditEventDetail(makeAuditEvent({
      kind: 'item_gated_retryable',
      scope: 'item',
      severity: 'warning',
      detail: 'Keep the full body visible.',
    }))).toBe('Keep the full body visible.');

    expect(getAuditEventDetail(makeAuditEvent({
      kind: 'item_committed',
      scope: 'item',
      severity: 'success',
      detail: 'AGENT_PORTRAIT',
    }))).toBeNull();
  });

  it('maps scope and severity labels and tones for operator badges', () => {
    expect(getAuditEventScopeLabel(i18n.t.bind(i18n), makeAuditEvent({ scope: 'item' }))).toBe('item');
    expect(getAuditEventSeverityLabel(i18n.t.bind(i18n), 'warning')).toBe('warning');
    expect(getAuditEventSeverityTone('error')).toContain('rose');
    expect(getAuditEventSeverityTone('success')).toContain('emerald');
  });
});
