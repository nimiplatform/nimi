import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@nimiplatform/kit/ui';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import {
  resolveAuditDetail,
  resolveAuditModality,
  resolveAuditPolicyGate,
  resolveAuditReasonCode,
  resolveAuditSource,
  type RuntimeConfigAuditEvent,
} from './runtime-config-audit-view-model.js';
import {
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
} from './runtime-config-runtime-page-ui.js';

// Icon set and icon button delegate to the shared runtime-page-ui composition
// layer; only the chevron (expand/collapse affordance) stays local.
export {
  CheckIcon,
  CopyIcon,
  IconButton,
  RefreshIcon,
  SearchIcon,
} from './runtime-config-runtime-page-ui.js';

type AuditEventTone = 'danger' | 'success' | 'info' | 'warning' | 'neutral';

const AUDIT_EVENT_TONE_CLASS: Record<AuditEventTone, string> = {
  danger: 'border-[var(--nimi-status-danger-soft-border)] bg-[var(--nimi-status-danger-soft-bg)] text-[var(--nimi-status-danger-soft-text)]',
  success: 'border-[var(--nimi-status-success-soft-border)] bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]',
  info: 'border-[var(--nimi-status-info-soft-border)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info-soft-text)]',
  warning: 'border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]',
  neutral: 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-status-neutral-soft-bg)] text-[var(--nimi-status-neutral-soft-text)]',
};

function auditEventTone(eventType: string): AuditEventTone {
  if (eventType.endsWith('_failed')) return 'danger';
  if (eventType.endsWith('_completed') || eventType.endsWith('_ready') || eventType.endsWith('_after_install')) return 'success';
  if (eventType.endsWith('_started') || eventType.endsWith('_invoked') || eventType.endsWith('_listed')) return 'info';
  if (eventType.startsWith('fallback_')) return 'warning';
  return 'neutral';
}

export function auditEventTypeColor(eventType: string): string {
  return AUDIT_EVENT_TONE_CLASS[auditEventTone(eventType)];
}

export function ChevronIcon({ expanded, size = 14 }: { expanded: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('transition-transform duration-200', expanded ? 'rotate-180' : 'rotate-0')}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function EventTypePill({
  label,
  count,
  active,
  onClick,
  className,
  dark,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  className?: string;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[length:var(--nimi-type-caption-size)] font-medium transition-all',
        active
          ? dark
            ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
            : 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
          : cn(
            'hover:-translate-y-[0.5px]',
            className || 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]',
          ),
      )}
    >
      <span className="font-mono">{label}</span>
      <span className={cn(
        'rounded-full px-1.5 text-[length:var(--nimi-type-caption-size)] font-semibold',
        active
          ? 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_22%,transparent)]'
          : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)]',
      )}>
        {count}
      </span>
    </button>
  );
}

export function FacetPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium transition-colors',
        active
          ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
          : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]',
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' ? (
        <span className={cn(
          'rounded-full px-1.5 text-[length:var(--nimi-type-caption-size)] font-semibold',
          active
            ? 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_22%,transparent)]'
            : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)]',
        )}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function AuditTableRow({ event }: { event: RuntimeConfigAuditEvent }) {
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const source = resolveAuditSource(event);
  const modality = resolveAuditModality(event);
  const reasonCode = resolveAuditReasonCode(event);
  const detail = resolveAuditDetail(event);
  const policyGate = resolveAuditPolicyGate(event);
  const target = event.modelId || (detail !== '-' ? detail : '—');
  const reasonDisplay = reasonCode !== '-' ? reasonCode : detail !== '-' ? detail : '—';

  const colorClass = auditEventTypeColor(event.eventType);

  const extraMeta = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    if (event.modelId) rows.push({ label: 'modelId', value: event.modelId });
    if (detail !== '-' && detail !== event.modelId) {
      rows.push({ label: 'detail', value: detail });
    }
    if (reasonCode !== '-') rows.push({ label: 'reasonCode', value: reasonCode });
    if (policyGate !== '-') rows.push({ label: 'policyGate', value: policyGate });
    rows.push({ label: 'occurredAt', value: event.occurredAt });
    rows.push({ label: 'modality', value: modality });
    return rows;
  }, [event, detail, reasonCode, policyGate, modality]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="grid w-full grid-cols-[72px_minmax(220px,1.6fr)_minmax(130px,0.9fr)_minmax(170px,1.3fr)_minmax(140px,1.2fr)_24px] items-center gap-x-3 gap-y-0 rounded-lg px-3 py-3 text-left transition-colors hover:bg-[var(--nimi-surface-panel)]/40"
      >
        <span
          title={event.occurredAt}
          className={cn('block truncate text-left text-xs', TOKEN_TEXT_SECONDARY)}
        >
          {i18n.formatRelativeTime(event.occurredAt)}
        </span>
        <span className={cn('inline-flex max-w-full items-center gap-1 justify-self-start self-center truncate rounded-md border px-2 py-0.5 font-mono text-[length:var(--nimi-type-caption-size)] font-medium', colorClass)}>
          <span className="truncate">{event.eventType}</span>
        </span>
        <span className={cn('block truncate text-left font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_SECONDARY)} title={source}>
          {source}
        </span>
        <span className={cn('block truncate text-left font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_SECONDARY)} title={target}>
          {target}
        </span>
        <span className={cn('block truncate text-left text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_SECONDARY)} title={reasonDisplay}>
          {reasonDisplay}
        </span>
        <span className={cn('text-[var(--nimi-text-muted)]')}>
          <ChevronIcon expanded={expanded} />
        </span>
      </button>
      {expanded ? (
        <div className="mx-3 mb-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[length:var(--nimi-type-caption-size)] sm:grid-cols-2">
            {extraMeta.map((row) => (
              <div key={`${event.id}-${row.label}`} className="min-w-0">
                <dt className={cn('text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
                  {row.label}
                </dt>
                <dd className={cn('mt-0.5 truncate font-mono', TOKEN_TEXT_PRIMARY)} title={row.value}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {event.payload && Object.keys(event.payload).length > 0 ? (
            <div className="mt-3">
              <p className={cn('text-[length:var(--nimi-type-caption-size)] font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.runtime.auditPayload', { defaultValue: 'payload' })}
              </p>
              <pre className={cn('mt-1 whitespace-pre-wrap break-all rounded-md bg-[var(--nimi-surface-card)] px-2.5 py-2 font-mono text-[length:var(--nimi-type-caption-size)] leading-relaxed', TOKEN_TEXT_SECONDARY)}>
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
