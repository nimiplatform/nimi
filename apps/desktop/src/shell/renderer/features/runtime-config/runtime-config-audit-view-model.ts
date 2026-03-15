import { i18n } from '@renderer/i18n';
import type { LocalRuntimeAuditEvent } from '@runtime/local-runtime';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function payloadValue(event: LocalRuntimeAuditEvent, key: string): string {
  const payload = asRecord(event.payload);
  return String(payload[key] || '').trim();
}

function payloadRaw(event: LocalRuntimeAuditEvent, key: string): unknown {
  const payload = asRecord(event.payload);
  return payload[key];
}

function toIsoTimestampMs(value: string): number | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
}

function translateAuditText(
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>,
): string {
  if (!i18n.isInitialized) {
    return defaultValue;
  }
  return i18n.t(key, {
    defaultValue,
    ...(options || {}),
  });
}

export function resolveAuditSource(event: LocalRuntimeAuditEvent): string {
  return String(event.source || payloadValue(event, 'source')).trim() || '-';
}

export function resolveAuditModality(event: LocalRuntimeAuditEvent): string {
  return String(event.modality || payloadValue(event, 'modality')).trim() || '-';
}

export function resolveAuditReasonCode(event: LocalRuntimeAuditEvent): string {
  return String(event.reasonCode || payloadValue(event, 'reasonCode')).trim() || '-';
}

export function resolveAuditDetail(event: LocalRuntimeAuditEvent): string {
  return String(event.detail || '').trim()
    || payloadValue(event, 'detail')
    || payloadValue(event, 'error')
    || '-';
}

export function resolveAuditPolicyGate(event: LocalRuntimeAuditEvent): string {
  const direct = payloadRaw(event, 'policyGate');
  if (typeof direct === 'string') {
    return direct.trim() || '-';
  }
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const summary = JSON.stringify(direct);
    return summary.length > 180 ? `${summary.slice(0, 180)}...` : summary;
  }
  return '-';
}

export function resolveAuditLabel(event: LocalRuntimeAuditEvent): string {
  const source = resolveAuditSource(event);
  const modId = payloadValue(event, 'modId');
  const model = String(event.modelId || '').trim() || payloadValue(event, 'model');
  const modality = resolveAuditModality(event);
  const parts = [
    event.eventType,
    source || '-',
    modality || '-',
    model || '-',
    modId || '-',
  ];
  return parts.join(' · ');
}

export function filterAuditEvents(input: {
  audits: LocalRuntimeAuditEvent[];
  eventType: string;
  source: string;
  modality: string;
  reasonCodeQuery: string;
  timeRange?: {
    from?: string;
    to?: string;
  };
}): LocalRuntimeAuditEvent[] {
  const eventType = String(input.eventType || '').trim();
  const source = String(input.source || '').trim();
  const modality = String(input.modality || '').trim();
  const reasonCodeQuery = String(input.reasonCodeQuery || '').trim().toLowerCase();
  const fromMs = toIsoTimestampMs(String(input.timeRange?.from || '').trim());
  const toMs = toIsoTimestampMs(String(input.timeRange?.to || '').trim());
  return input.audits.filter((event) => {
    if (eventType && eventType !== 'all' && event.eventType !== eventType) {
      return false;
    }
    if (source && source !== 'all' && resolveAuditSource(event) !== source) {
      return false;
    }
    if (modality && modality !== 'all' && resolveAuditModality(event) !== modality) {
      return false;
    }
    if (reasonCodeQuery) {
      const reasonCode = resolveAuditReasonCode(event).toLowerCase();
      if (!reasonCode.includes(reasonCodeQuery)) {
        return false;
      }
    }
    if (fromMs !== null || toMs !== null) {
      const eventMs = toIsoTimestampMs(event.occurredAt);
      if (eventMs === null) return false;
      if (fromMs !== null && eventMs < fromMs) return false;
      if (toMs !== null && eventMs > toMs) return false;
    }
    return true;
  });
}

export function summarizeAuditReasons(audits: LocalRuntimeAuditEvent[]): Array<{ reasonCode: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of audits) {
    const reasonCode = resolveAuditReasonCode(event);
    if (!reasonCode || reasonCode === '-') continue;
    counts.set(reasonCode, (counts.get(reasonCode) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((left, right) => right.count - left.count || left.reasonCode.localeCompare(right.reasonCode));
}

export function summarizeAuditEventTypes(audits: LocalRuntimeAuditEvent[]): Array<{ eventType: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of audits) {
    const eventType = String(event.eventType || '').trim();
    if (!eventType) continue;
    counts.set(eventType, (counts.get(eventType) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((left, right) => right.count - left.count || left.eventType.localeCompare(right.eventType));
}

export function summarizeAuditSources(audits: LocalRuntimeAuditEvent[]): Array<{ source: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of audits) {
    const source = resolveAuditSource(event);
    if (!source || source === '-') continue;
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((left, right) => right.count - left.count || left.source.localeCompare(right.source));
}

export function summarizeAuditModalities(audits: LocalRuntimeAuditEvent[]): Array<{ modality: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of audits) {
    const modality = resolveAuditModality(event);
    if (!modality || modality === '-') continue;
    counts.set(modality, (counts.get(modality) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([modality, count]) => ({ modality, count }))
    .sort((left, right) => right.count - left.count || left.modality.localeCompare(right.modality));
}

export function buildAuditDiagnosticsText(audits: LocalRuntimeAuditEvent[]): string {
  if (audits.length === 0) {
    return translateAuditText('runtimeConfig.runtime.noAuditEventsSimple', 'No audit events.');
  }
  return audits.map((event) => {
    return [
      event.occurredAt,
      event.eventType,
      `source=${resolveAuditSource(event)}`,
      `modality=${resolveAuditModality(event)}`,
      `reason=${resolveAuditReasonCode(event)}`,
      `detail=${resolveAuditDetail(event)}`,
      `policyGate=${resolveAuditPolicyGate(event)}`,
      `model=${event.modelId || '-'}`,
      `localModelId=${event.localModelId || '-'}`,
      `label=${resolveAuditLabel(event)}`,
    ].join(' | ');
  }).join('\n');
}
