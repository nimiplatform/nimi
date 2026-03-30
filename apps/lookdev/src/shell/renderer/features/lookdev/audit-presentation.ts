import type { TFunction } from 'i18next';
import type { LookdevAuditEvent, LookdevAuditEventSeverity } from './types.js';

function resolveAgentLabel(t: TFunction, event: LookdevAuditEvent): string {
  return event.agentDisplayName?.trim()
    || event.agentId?.trim()
    || t('auditEvent.unknownAgent');
}

export function getAuditEventTitle(t: TFunction, event: LookdevAuditEvent): string {
  switch (event.kind) {
    case 'batch_created':
      return t('auditEvent.kind.batch_created', { count: event.count ?? 0 });
    case 'batch_paused':
      return t('auditEvent.kind.batch_paused');
    case 'batch_resumed':
      return t('auditEvent.kind.batch_resumed');
    case 'processing_complete':
      return t('auditEvent.kind.processing_complete');
    case 'item_auto_passed':
      return t('auditEvent.kind.item_auto_passed', { agent: resolveAgentLabel(t, event) });
    case 'item_gated_retryable':
      return t('auditEvent.kind.item_gated_retryable', { agent: resolveAgentLabel(t, event) });
    case 'item_gated_exhausted':
      return t('auditEvent.kind.item_gated_exhausted', { agent: resolveAgentLabel(t, event) });
    case 'item_processing_failed':
      return t('auditEvent.kind.item_processing_failed', { agent: resolveAgentLabel(t, event) });
    case 'rerun_queued':
      return t('auditEvent.kind.rerun_queued', { count: event.count ?? 0 });
    case 'item_committed':
      return t('auditEvent.kind.item_committed', {
        agent: resolveAgentLabel(t, event),
        target: event.detail?.trim() || 'AGENT_PORTRAIT',
      });
    case 'item_commit_failed':
      return t('auditEvent.kind.item_commit_failed', { agent: resolveAgentLabel(t, event) });
    case 'commit_complete':
      return t('auditEvent.kind.commit_complete');
    default:
      return event.kind;
  }
}

export function getAuditEventDetail(event: LookdevAuditEvent): string | null {
  if (!event.detail?.trim()) {
    return null;
  }
  if (event.kind === 'item_committed') {
    return null;
  }
  return event.detail.trim();
}

export function getAuditEventScopeLabel(t: TFunction, event: LookdevAuditEvent): string {
  return t(`auditEvent.scope.${event.scope}`, { defaultValue: event.scope });
}

export function getAuditEventSeverityLabel(t: TFunction, severity: LookdevAuditEventSeverity): string {
  return t(`auditEvent.severity.${severity}`, { defaultValue: severity });
}

export function getAuditEventSeverityTone(severity: LookdevAuditEventSeverity): string {
  switch (severity) {
    case 'success':
      return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100';
    case 'warning':
      return 'border-amber-300/20 bg-amber-300/10 text-amber-100';
    case 'error':
      return 'border-rose-300/20 bg-rose-300/10 text-rose-100';
    default:
      return 'border-white/10 bg-black/16 text-white/70';
  }
}
