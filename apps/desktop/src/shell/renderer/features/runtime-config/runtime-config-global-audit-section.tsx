import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditEventRecord } from '@nimiplatform/sdk/runtime';
import { CallerKind } from '@nimiplatform/sdk/runtime';
import { ScrollArea, Tooltip } from '@nimiplatform/nimi-kit/ui';
import { Button, Card, RuntimeSelect } from './runtime-config-primitives.js';
import {
  callerKindLabel,
  timestampToIso,
  relativeTimeShort,
  structToRecord,
} from './runtime-config-global-audit-view-model.js';

// Icon Button Component
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
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// Refresh Icon
function RefreshIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

// Export Icon
function ExportIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {t('runtimeConfig.runtime.globalAuditTitle', { defaultValue: 'Global Audit Events' })}
        </h3>
        <div className="flex items-center gap-2">
          <IconButton
            icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
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

      {error ? <p className="text-xs text-[var(--nimi-status-danger)]">{error}</p> : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.domain}
          onChange={(e) => onUpdateFilters({ domain: e.target.value })}
          placeholder={t('runtimeConfig.runtime.filterDomain', { defaultValue: 'Filter domain...' })}
          className="h-8 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 text-xs text-[var(--nimi-text-primary)] outline-none transition-all focus:border-[var(--nimi-field-focus)] focus:bg-[var(--nimi-surface-card)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
        />
        <RuntimeSelect
          value={String(filters.callerKind)}
          onChange={(nextCallerKind) => onUpdateFilters({ callerKind: Number(nextCallerKind) })}
          size="sm"
          className="w-52"
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
          className="h-8 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 text-xs text-[var(--nimi-text-primary)] outline-none transition-all focus:border-[var(--nimi-field-focus)] focus:bg-[var(--nimi-surface-card)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
        />
        <input
          type="datetime-local"
          value={filters.timeTo}
          onChange={(e) => onUpdateFilters({ timeTo: e.target.value })}
          className="h-8 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-2 text-xs text-[var(--nimi-text-primary)] outline-none transition-all focus:border-[var(--nimi-field-focus)] focus:bg-[var(--nimi-surface-card)] focus:ring-[length:var(--nimi-focus-ring-width)] focus:ring-[var(--nimi-focus-ring-color)]"
        />
      </div>

      {/* Event List */}
      <ScrollArea
        className="max-h-[calc(100vh-32rem)] rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]"
        viewportClassName="max-h-[calc(100vh-32rem)]"
      >
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--nimi-text-muted)]">
            {loading
              ? t('runtimeConfig.runtime.loadingAuditEvents', { defaultValue: 'Loading audit events...' })
              : t('runtimeConfig.runtime.noAuditEvents', { defaultValue: 'No audit events matching current filters.' })}
          </p>
        ) : (
          events.map((event) => (
            <AuditEventRow key={event.auditId} event={event} />
          ))
        )}
      </ScrollArea>

      {/* Load More */}
      {hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading
              ? t('runtimeConfig.runtime.loading', { defaultValue: 'Loading...' })
              : t('runtimeConfig.runtime.loadMore', { defaultValue: 'Load More' })}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function AuditEventRow({ event }: { event: AuditEventRecord }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const ts = timestampToIso(event.timestamp);

  return (
    <div className="border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_80%,transparent)] last:border-b-0">
      <div
        className="flex cursor-pointer items-start justify-between gap-3 px-4 py-2.5 hover:bg-[var(--nimi-surface-card)]"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-[var(--nimi-text-muted)]">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="font-mono text-[var(--nimi-text-muted)]">{event.auditId.slice(0, 8)}...</span>
          <span className="rounded-md border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] px-1.5 py-0.5 font-medium text-[var(--nimi-action-primary-bg)]">
            {event.domain}
          </span>
          <span className="text-[var(--nimi-text-secondary)]">{event.operation}</span>
          <span className="text-[var(--nimi-text-muted)]">{callerKindLabel(event.callerKind)}</span>
          {event.reasonCode ? (
            <span className="text-[var(--nimi-text-muted)]">reason={event.reasonCode}</span>
          ) : null}
        </div>
        <Tooltip content={ts} placement="top">
          <span className="shrink-0 text-[11px] text-[var(--nimi-text-muted)]">
            {ts !== '-' ? relativeTimeShort(ts) : '-'}
          </span>
        </Tooltip>
      </div>
      {expanded ? (
        <div className="space-y-2 bg-[var(--nimi-surface-panel)] px-4 py-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <FieldRow label={t('runtimeConfig.runtime.auditId', { defaultValue: 'Audit ID' })} value={event.auditId} />
            <FieldRow label={t('runtimeConfig.runtime.appId', { defaultValue: 'App ID' })} value={event.appId} />
            <FieldRow label={t('runtimeConfig.runtime.subjectUser', { defaultValue: 'Subject User' })} value={event.subjectUserId} />
            <FieldRow label={t('runtimeConfig.runtime.domain', { defaultValue: 'Domain' })} value={event.domain} />
            <FieldRow label={t('runtimeConfig.runtime.operation', { defaultValue: 'Operation' })} value={event.operation} />
            <FieldRow label={t('runtimeConfig.runtime.reasonCode', { defaultValue: 'Reason Code' })} value={String(event.reasonCode)} />
            <FieldRow label={t('runtimeConfig.runtime.traceId', { defaultValue: 'Trace ID' })} value={event.traceId} />
            <FieldRow label={t('runtimeConfig.runtime.timestamp', { defaultValue: 'Timestamp' })} value={ts} />
            <FieldRow label={t('runtimeConfig.runtime.callerKind', { defaultValue: 'Caller Kind' })} value={callerKindLabel(event.callerKind)} />
            <FieldRow label={t('runtimeConfig.runtime.callerId', { defaultValue: 'Caller ID' })} value={event.callerId} />
            <FieldRow label={t('runtimeConfig.runtime.surfaceId', { defaultValue: 'Surface ID' })} value={event.surfaceId} />
            <FieldRow label={t('runtimeConfig.runtime.principalId', { defaultValue: 'Principal ID' })} value={event.principalId} />
            <FieldRow label={t('runtimeConfig.runtime.principalType', { defaultValue: 'Principal Type' })} value={event.principalType} />
            <FieldRow label={t('runtimeConfig.runtime.externalPrincipalType', { defaultValue: 'Ext. Principal Type' })} value={event.externalPrincipalType} />
            <FieldRow label={t('runtimeConfig.runtime.capability', { defaultValue: 'Capability' })} value={event.capability} />
            <FieldRow label={t('runtimeConfig.runtime.tokenId', { defaultValue: 'Token ID' })} value={event.tokenId} />
            <FieldRow label={t('runtimeConfig.runtime.parentTokenId', { defaultValue: 'Parent Token ID' })} value={event.parentTokenId} />
            <FieldRow label={t('runtimeConfig.runtime.consentId', { defaultValue: 'Consent ID' })} value={event.consentId} />
            <FieldRow label={t('runtimeConfig.runtime.consentVersion', { defaultValue: 'Consent Version' })} value={event.consentVersion} />
            <FieldRow label={t('runtimeConfig.runtime.policyVersion', { defaultValue: 'Policy Version' })} value={event.policyVersion} />
            <FieldRow label={t('runtimeConfig.runtime.resourceSelectorHash', { defaultValue: 'Resource Selector Hash' })} value={event.resourceSelectorHash} />
            <FieldRow label={t('runtimeConfig.runtime.scopeCatalogVersion', { defaultValue: 'Scope Catalog Version' })} value={event.scopeCatalogVersion} />
          </div>
          {event.payload ? (
            <div>
              <p className="mb-1 text-[11px] font-medium text-[var(--nimi-text-muted)]">{t('runtimeConfig.runtime.payload', { defaultValue: 'Payload' })}</p>
              <pre className="max-h-40 overflow-x-auto rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-2 text-[10px] text-[var(--nimi-text-secondary)]">
                {JSON.stringify(structToRecord(event.payload as { fields: Record<string, unknown> }), null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-[var(--nimi-text-muted)]">{label}:</span>
      <span className="font-mono break-all text-[var(--nimi-text-primary)]">{value}</span>
    </div>
  );
}
