import { useState } from 'react';
import type { AuditEventRecord } from '@nimiplatform/sdk/runtime';
import { CallerKind } from '@nimiplatform/sdk/runtime';
import { Tooltip } from '@renderer/components/tooltip.js';
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
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white/90 text-gray-600 transition-colors hover:bg-white hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
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
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Global Audit Events</h3>
        <div className="flex items-center gap-2">
          <IconButton
            icon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
            title="Refresh"
            disabled={loading}
            onClick={onRefresh}
          />
          <IconButton
            icon={<ExportIcon />}
            title="Export JSON"
            onClick={() => onExport('json')}
          />
        </div>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.domain}
          onChange={(e) => onUpdateFilters({ domain: e.target.value })}
          placeholder="Filter domain..."
          className="h-8 rounded-md border border-mint-100 bg-[#F4FBF8] px-2 text-xs text-gray-800 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
        />
        <RuntimeSelect
          value={String(filters.callerKind)}
          onChange={(nextCallerKind) => onUpdateFilters({ callerKind: Number(nextCallerKind) })}
          size="sm"
          className="w-52"
          options={[
            { value: String(0), label: 'All callers' },
            { value: String(CallerKind.DESKTOP_CORE), label: 'Desktop Core' },
            { value: String(CallerKind.DESKTOP_MOD), label: 'Desktop Mod' },
            { value: String(CallerKind.THIRD_PARTY_APP), label: 'Third-Party App' },
            { value: String(CallerKind.THIRD_PARTY_SERVICE), label: 'Third-Party Service' },
          ]}
        />
        <input
          type="datetime-local"
          value={filters.timeFrom}
          onChange={(e) => onUpdateFilters({ timeFrom: e.target.value })}
          className="h-8 rounded-md border border-mint-100 bg-[#F4FBF8] px-2 text-xs text-gray-800 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
        />
        <input
          type="datetime-local"
          value={filters.timeTo}
          onChange={(e) => onUpdateFilters({ timeTo: e.target.value })}
          className="h-8 rounded-md border border-mint-100 bg-[#F4FBF8] px-2 text-xs text-gray-800 outline-none transition-all focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
        />
      </div>

      {/* Event List */}
      <div className="max-h-[calc(100vh-32rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white/60">
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500">
            {loading ? 'Loading audit events...' : 'No audit events matching current filters.'}
          </p>
        ) : (
          events.map((event) => (
            <AuditEventRow key={event.auditId} event={event} />
          ))
        )}
      </div>

      {/* Load More */}
      {hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="secondary" size="sm" disabled={loading} onClick={onLoadMore}>
            {loading ? 'Loading...' : 'Load More'}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function AuditEventRow({ event }: { event: AuditEventRecord }) {
  const [expanded, setExpanded] = useState(false);
  const ts = timestampToIso(event.timestamp);

  return (
    <div className="border-b border-gray-200/70 last:border-b-0">
      <div
        className="flex cursor-pointer items-start justify-between gap-3 px-4 py-2.5 hover:bg-white/80"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-gray-400">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="font-mono text-gray-400">{event.auditId.slice(0, 8)}...</span>
          <span className="rounded-md border border-mint-200 bg-mint-50 px-1.5 py-0.5 font-medium text-mint-700">
            {event.domain}
          </span>
          <span className="text-gray-700">{event.operation}</span>
          <span className="text-gray-500">{callerKindLabel(event.callerKind)}</span>
          {event.reasonCode ? (
            <span className="text-gray-400">reason={event.reasonCode}</span>
          ) : null}
        </div>
        <Tooltip content={ts} placement="top">
          <span className="shrink-0 text-[11px] text-gray-400">
            {ts !== '-' ? relativeTimeShort(ts) : '-'}
          </span>
        </Tooltip>
      </div>
      {expanded ? (
        <div className="space-y-2 bg-white/60 px-4 py-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <FieldRow label="Audit ID" value={event.auditId} />
            <FieldRow label="App ID" value={event.appId} />
            <FieldRow label="Subject User" value={event.subjectUserId} />
            <FieldRow label="Domain" value={event.domain} />
            <FieldRow label="Operation" value={event.operation} />
            <FieldRow label="Reason Code" value={String(event.reasonCode)} />
            <FieldRow label="Trace ID" value={event.traceId} />
            <FieldRow label="Timestamp" value={ts} />
            <FieldRow label="Caller Kind" value={callerKindLabel(event.callerKind)} />
            <FieldRow label="Caller ID" value={event.callerId} />
            <FieldRow label="Surface ID" value={event.surfaceId} />
            <FieldRow label="Principal ID" value={event.principalId} />
            <FieldRow label="Principal Type" value={event.principalType} />
            <FieldRow label="Ext. Principal Type" value={event.externalPrincipalType} />
            <FieldRow label="Capability" value={event.capability} />
            <FieldRow label="Token ID" value={event.tokenId} />
            <FieldRow label="Parent Token ID" value={event.parentTokenId} />
            <FieldRow label="Consent ID" value={event.consentId} />
            <FieldRow label="Consent Version" value={event.consentVersion} />
            <FieldRow label="Policy Version" value={event.policyVersion} />
            <FieldRow label="Resource Selector Hash" value={event.resourceSelectorHash} />
            <FieldRow label="Scope Catalog Version" value={event.scopeCatalogVersion} />
          </div>
          {event.payload ? (
            <div>
              <p className="text-[11px] font-medium text-gray-500 mb-1">Payload</p>
              <pre className="max-h-40 overflow-x-auto rounded-md border border-gray-200 bg-white/80 p-2 text-[10px] text-gray-700">
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
      <span className="text-gray-500 shrink-0">{label}:</span>
      <span className="text-gray-800 font-mono break-all">{value}</span>
    </div>
  );
}
