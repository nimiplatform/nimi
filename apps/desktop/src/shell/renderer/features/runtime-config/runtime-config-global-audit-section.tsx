import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEventRecord } from '@nimiplatform/sdk/runtime';
import { CallerKind } from '@nimiplatform/sdk/runtime';
import { ScrollArea, Surface, Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { Button, RuntimeSelect } from './runtime-config-primitives.js';
import {
  callerKindLabel,
  timestampToIso,
  relativeTimeShort,
  structToRecord,
} from './runtime-config-global-audit-view-model.js';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';

const FILTER_INPUT_CLASS =
  'h-8 rounded-lg border border-[var(--nimi-border-subtle)] bg-transparent px-2.5 text-xs text-[var(--nimi-text-primary)] outline-none transition-colors focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]';

type ReasonTone = 'success' | 'warning' | 'danger' | 'neutral';

const REASON_BADGE_CLASS: Record<ReasonTone, string> = {
  success: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
  warning: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
  danger: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
  neutral: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,transparent)] text-[var(--nimi-text-secondary)]',
};

function reasonTone(reasonCode: unknown): ReasonTone {
  const code = String(reasonCode || '').toLowerCase().trim();
  if (!code) return 'neutral';
  if (code === 'allowed' || code === 'ok' || code === 'success' || code === '0' || code === 'action_executed') return 'success';
  if (code.includes('denied') || code.includes('error') || code.includes('failed') || code.includes('timeout') || code.includes('refused') || code.includes('invalid') || code.includes('conflict')) {
    return 'danger';
  }
  if (code.includes('warn') || code.includes('stale') || code.includes('degraded') || code.includes('retry') || code.includes('not_registered') || code.includes('expired')) {
    return 'warning';
  }
  return 'neutral';
}

function IconButton({
  icon,
  title,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
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

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

type GlobalAuditSectionProps = {
  events: AuditEventRecord[];
  loading: boolean;
  error: string | null;
  hasNextPage: boolean;
  filters: {
    domain: string;
    callerKind: number;
    timeFrom: string;
    timeTo: string;
  };
  onUpdateFilters: (patch: Partial<{ domain: string; callerKind: number; timeFrom: string; timeTo: string }>) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onExport: (format: string) => void;
};

export function GlobalAuditSection({
  events,
  loading,
  error,
  hasNextPage,
  filters,
  onUpdateFilters,
  onRefresh,
  onLoadMore,
  onExport,
}: GlobalAuditSectionProps) {
  const { t } = useTranslation();
  return (
    <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
          {t('runtimeConfig.runtime.globalAuditTitle', { defaultValue: 'Global Audit Events' })}
        </h3>
        <div className="flex items-center gap-1">
          <IconButton
            icon={<RefreshIcon spinning={loading} />}
            title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
            disabled={loading}
            onClick={onRefresh}
          />
          <IconButton
            icon={<ExportIcon />}
            title={t('runtimeConfig.runtime.exportJson', { defaultValue: 'Export JSON' })}
            onClick={() => onExport('json')}
          />
        </div>
      </div>

      {error ? <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{error}</p> : null}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={filters.domain}
          onChange={(e) => onUpdateFilters({ domain: e.target.value })}
          placeholder={t('runtimeConfig.runtime.filterDomain', { defaultValue: 'Filter domain…' })}
          className={cn(FILTER_INPUT_CLASS, 'w-44')}
        />
        <RuntimeSelect
          value={String(filters.callerKind)}
          onChange={(next) => onUpdateFilters({ callerKind: Number(next) })}
          size="sm"
          className="w-44"
          options={[
            { value: String(0), label: t('runtimeConfig.runtime.allCallers', { defaultValue: 'All callers' }) },
            { value: String(CallerKind.DESKTOP_CORE), label: t('runtimeConfig.runtime.desktopCore', { defaultValue: 'Desktop Core' }) },
            { value: String(CallerKind.DESKTOP_MOD), label: t('runtimeConfig.runtime.desktopMod', { defaultValue: 'Desktop Mod' }) },
            { value: String(CallerKind.THIRD_PARTY_APP), label: t('runtimeConfig.runtime.thirdPartyApp', { defaultValue: 'Third-Party App' }) },
            { value: String(CallerKind.THIRD_PARTY_SERVICE), label: t('runtimeConfig.runtime.thirdPartyService', { defaultValue: 'Third-Party Service' }) },
          ]}
        />
        <input
          type="datetime-local"
          value={filters.timeFrom}
          onChange={(e) => onUpdateFilters({ timeFrom: e.target.value })}
          aria-label={t('runtimeConfig.runtime.fromTime', { defaultValue: 'From' })}
          className={FILTER_INPUT_CLASS}
        />
        <input
          type="datetime-local"
          value={filters.timeTo}
          onChange={(e) => onUpdateFilters({ timeTo: e.target.value })}
          aria-label={t('runtimeConfig.runtime.toTime', { defaultValue: 'To' })}
          className={FILTER_INPUT_CLASS}
        />
      </div>

      {/* Event List */}
      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40">
        <ScrollArea
          className="max-h-[calc(100vh-34rem)]"
          viewportClassName="max-h-[calc(100vh-34rem)]"
        >
          {events.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
              <p className={cn('text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
                {loading
                  ? t('runtimeConfig.runtime.loadingAuditEvents', { defaultValue: 'Loading audit events…' })
                  : t('runtimeConfig.runtime.noAuditEvents', { defaultValue: 'No audit events match the current filters.' })}
              </p>
              {!loading ? (
                <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.runtime.noAuditEventsHint', {
                    defaultValue: 'Events appear here as mods and apps make authorized runtime calls.',
                  })}
                </p>
              ) : null}
            </div>
          ) : (
            events.map((event) => <AuditEventRow key={event.auditId} event={event} />)
          )}
        </ScrollArea>
      </div>

      {/* Load More */}
      {hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading
              ? t('runtimeConfig.runtime.loading', { defaultValue: 'Loading…' })
              : t('runtimeConfig.runtime.loadMore', { defaultValue: 'Load more' })}
          </Button>
        </div>
      ) : null}
    </Surface>
  );
}

function AuditEventRow({ event }: { event: AuditEventRecord }) {
  const [expanded, setExpanded] = useState(false);
  const ts = timestampToIso(event.timestamp);
  const reasonCodeText = event.reasonCode !== undefined && event.reasonCode !== null ? String(event.reasonCode) : '';
  const hasReason = reasonCodeText.length > 0 && reasonCodeText !== '0';
  const tone = reasonTone(reasonCodeText);

  return (
    <div className="border-b border-[var(--nimi-border-subtle)]/50 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-white/60"
      >
        <span className={cn('shrink-0 text-[10px]', TOKEN_TEXT_MUTED)}>{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className={cn('shrink-0 font-mono text-[11px]', TOKEN_TEXT_MUTED)}>
          {event.auditId ? `${event.auditId.slice(0, 8)}…` : '—'}
        </span>
        <span className="inline-flex shrink-0 items-center rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] px-1.5 py-0.5 text-[11px] font-medium text-[var(--nimi-action-primary-bg)]">
          {event.domain || '—'}
        </span>
        <span className={cn('shrink-0 font-mono text-[11px]', TOKEN_TEXT_SECONDARY)}>
          {event.operation || '—'}
        </span>
        <span className={cn('shrink-0 text-[11px]', TOKEN_TEXT_MUTED)}>
          {callerKindLabel(event.callerKind)}
        </span>
        {hasReason ? (
          <span
            className={cn('shrink-0 max-w-[180px] truncate rounded-full px-2 py-0.5 text-[10px] font-medium', REASON_BADGE_CLASS[tone])}
            title={reasonCodeText}
          >
            {reasonCodeText}
          </span>
        ) : null}
        <span className="ml-auto shrink-0">
          <Tooltip content={ts} placement="top">
            <span className={cn('text-[11px]', TOKEN_TEXT_MUTED)}>
              {ts !== '-' ? relativeTimeShort(ts) : '—'}
            </span>
          </Tooltip>
        </span>
      </button>
      {expanded ? <ExpandedDetails event={event} timestampIso={ts} reasonCodeText={reasonCodeText} /> : null}
    </div>
  );
}

function ExpandedDetails({ event, timestampIso, reasonCodeText }: { event: AuditEventRecord; timestampIso: string; reasonCodeText: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 border-t border-[var(--nimi-border-subtle)]/50 bg-[var(--nimi-surface-card)]/70 px-5 py-4">
      <FieldGroup
        title={t('runtimeConfig.runtime.groupWhatHappened', { defaultValue: 'What happened' })}
        items={[
          { label: t('runtimeConfig.runtime.domain', { defaultValue: 'Domain' }), value: event.domain, mono: true },
          { label: t('runtimeConfig.runtime.operation', { defaultValue: 'Operation' }), value: event.operation, mono: true },
          { label: t('runtimeConfig.runtime.capability', { defaultValue: 'Capability' }), value: event.capability, mono: true },
          { label: t('runtimeConfig.runtime.reasonCode', { defaultValue: 'Reason Code' }), value: reasonCodeText, mono: true },
        ]}
      />
      <FieldGroup
        title={t('runtimeConfig.runtime.groupWho', { defaultValue: 'Who called' })}
        items={[
          { label: t('runtimeConfig.runtime.callerKind', { defaultValue: 'Caller Kind' }), value: callerKindLabel(event.callerKind) },
          { label: t('runtimeConfig.runtime.callerId', { defaultValue: 'Caller ID' }), value: event.callerId, mono: true },
          { label: t('runtimeConfig.runtime.appId', { defaultValue: 'App ID' }), value: event.appId, mono: true },
          { label: t('runtimeConfig.runtime.subjectUser', { defaultValue: 'Subject User' }), value: event.subjectUserId, mono: true },
          { label: t('runtimeConfig.runtime.surfaceId', { defaultValue: 'Surface ID' }), value: event.surfaceId, mono: true },
          { label: t('runtimeConfig.runtime.principalId', { defaultValue: 'Principal ID' }), value: event.principalId, mono: true },
          { label: t('runtimeConfig.runtime.principalType', { defaultValue: 'Principal Type' }), value: event.principalType },
          { label: t('runtimeConfig.runtime.externalPrincipalType', { defaultValue: 'Ext. Principal Type' }), value: event.externalPrincipalType },
        ]}
      />
      <FieldGroup
        title={t('runtimeConfig.runtime.groupAuthorization', { defaultValue: 'Authorization' })}
        items={[
          { label: t('runtimeConfig.runtime.tokenId', { defaultValue: 'Token ID' }), value: event.tokenId, mono: true },
          { label: t('runtimeConfig.runtime.parentTokenId', { defaultValue: 'Parent Token' }), value: event.parentTokenId, mono: true },
          { label: t('runtimeConfig.runtime.consentId', { defaultValue: 'Consent ID' }), value: event.consentId, mono: true },
          { label: t('runtimeConfig.runtime.consentVersion', { defaultValue: 'Consent Version' }), value: event.consentVersion, mono: true },
          { label: t('runtimeConfig.runtime.policyVersion', { defaultValue: 'Policy Version' }), value: event.policyVersion, mono: true },
          { label: t('runtimeConfig.runtime.resourceSelectorHash', { defaultValue: 'Resource Selector Hash' }), value: event.resourceSelectorHash, mono: true },
          { label: t('runtimeConfig.runtime.scopeCatalogVersion', { defaultValue: 'Scope Catalog Version' }), value: event.scopeCatalogVersion, mono: true },
        ]}
      />
      <FieldGroup
        title={t('runtimeConfig.runtime.groupTracing', { defaultValue: 'Tracing' })}
        items={[
          { label: t('runtimeConfig.runtime.auditId', { defaultValue: 'Audit ID' }), value: event.auditId, mono: true },
          { label: t('runtimeConfig.runtime.traceId', { defaultValue: 'Trace ID' }), value: event.traceId, mono: true },
          { label: t('runtimeConfig.runtime.timestamp', { defaultValue: 'Timestamp' }), value: timestampIso },
        ]}
      />
      {event.payload ? (
        <div>
          <p className={cn('mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.runtime.payload', { defaultValue: 'Payload' })}
          </p>
          <pre
            className={cn(
              'max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--nimi-border-subtle)]/60 bg-[var(--nimi-surface-panel)] p-3 font-mono text-[11px] leading-relaxed',
              TOKEN_TEXT_PRIMARY,
            )}
          >
            {JSON.stringify(structToRecord(event.payload as { fields: Record<string, unknown> }), null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function FieldGroup({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string; mono?: boolean }[];
}) {
  const visible = items.filter((item) => item.value && String(item.value).trim() && item.value !== 'null' && item.value !== 'undefined' && item.value !== '0');
  if (visible.length === 0) return null;
  return (
    <div>
      <p className={cn('mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
        {title}
      </p>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
        {visible.map((item) => (
          <div key={item.label} className="flex items-baseline gap-2">
            <span className={cn('shrink-0 text-[11px]', TOKEN_TEXT_MUTED)}>{item.label}</span>
            <span
              className={cn(
                'min-w-0 break-all text-[11px]',
                item.mono ? 'font-mono' : '',
                TOKEN_TEXT_PRIMARY,
              )}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
