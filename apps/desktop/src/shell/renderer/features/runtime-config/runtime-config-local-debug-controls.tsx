import { useMemo, useState } from 'react';
import type { LocalRuntimeAuditEvent } from '@nimiplatform/sdk/runtime';
import { useTranslation } from 'react-i18next';
import { Tooltip, cn } from '@nimiplatform/kit/ui';
import { formatRelativeLocaleTime } from '@renderer/i18n';
import {
  resolveAuditDetail,
  resolveAuditModality,
  resolveAuditPolicyGate,
  resolveAuditReasonCode,
  resolveAuditSource,
} from './runtime-config-audit-view-model.js';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';

export function auditEventTypeColor(eventType: string): string {
  if (eventType.endsWith('_failed')) return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)] border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,transparent)]';
  if (eventType.endsWith('_completed') || eventType.endsWith('_ready') || eventType.endsWith('_after_install'))
    return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)] border-[color-mix(in_srgb,var(--nimi-status-success)_28%,transparent)]';
  if (eventType.endsWith('_started') || eventType.endsWith('_invoked') || eventType.endsWith('_listed'))
    return 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)] border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)]';
  if (eventType.startsWith('fallback_')) return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)] border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)] border-[var(--nimi-border-subtle)]';
}

export function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'animate-spin' : ''}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
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

export function IconButton({
  icon,
  title,
  disabled,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'success';
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          tone === 'success'
            ? 'text-[var(--nimi-status-success)] hover:bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,transparent)]'
            : 'text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)]',
        )}
      >
        {icon}
      </button>
    </Tooltip>
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
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
        'rounded-full px-1.5 text-[10px] font-semibold',
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
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
          : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]',
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' ? (
        <span className={cn(
          'rounded-full px-1.5 text-[10px] font-semibold',
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

export function AuditTableRow({ event }: { event: LocalRuntimeAuditEvent }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const source = resolveAuditSource(event);
  const modality = resolveAuditModality(event);
  const reasonCode = resolveAuditReasonCode(event);
  const detail = resolveAuditDetail(event);
  const policyGate = resolveAuditPolicyGate(event);
  const target = event.modelId || event.localModelId || (detail !== '-' ? detail : '—');
  const reasonDisplay = reasonCode !== '-' ? reasonCode : detail !== '-' ? detail : '—';

  const colorClass = auditEventTypeColor(event.eventType);

  const extraMeta = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    if (event.modelId) rows.push({ label: 'modelId', value: event.modelId });
    if (event.localModelId) rows.push({ label: 'localModelId', value: event.localModelId });
    if (detail !== '-' && detail !== event.modelId && detail !== event.localModelId) {
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
          {formatRelativeLocaleTime(event.occurredAt)}
        </span>
        <span className={cn('inline-flex max-w-full items-center gap-1 justify-self-start self-center truncate rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium', colorClass)}>
          <span className="truncate">{event.eventType}</span>
        </span>
        <span className={cn('block truncate text-left font-mono text-[11px]', TOKEN_TEXT_SECONDARY)} title={source}>
          {source}
        </span>
        <span className={cn('block truncate text-left font-mono text-[11px]', TOKEN_TEXT_SECONDARY)} title={target}>
          {target}
        </span>
        <span className={cn('block truncate text-left text-[11px]', TOKEN_TEXT_SECONDARY)} title={reasonDisplay}>
          {reasonDisplay}
        </span>
        <span className={cn('text-[var(--nimi-text-muted)]')}>
          <ChevronIcon expanded={expanded} />
        </span>
      </button>
      {expanded ? (
        <div className="mx-3 mb-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-3">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
            {extraMeta.map((row) => (
              <div key={`${event.id}-${row.label}`} className="min-w-0">
                <dt className={cn('text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
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
              <p className={cn('text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
                {t('runtimeConfig.runtime.auditPayload', { defaultValue: 'payload' })}
              </p>
              <pre className={cn('mt-1 whitespace-pre-wrap break-all rounded-md bg-[var(--nimi-surface-card)] px-2.5 py-2 font-mono text-[11px] leading-relaxed', TOKEN_TEXT_SECONDARY)}>
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
