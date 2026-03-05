import { useState } from 'react';
import type { AuditEventRecord } from '@nimiplatform/sdk/runtime';
import { CallerKind } from '@nimiplatform/sdk/runtime';
import { Button, Card, RuntimeSelect } from '../../primitives.js';
import {
  callerKindLabel,
  timestampToIso,
  relativeTimeShort,
  structToRecord,
} from '../../../domain/diagnostics/global-audit-view-model.js';

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
          <Button variant="secondary" size="sm" disabled={loading} onClick={onRefresh}>
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onExport('json')}>
            Export
          </Button>
        </div>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filters.domain}
          onChange={(e) => onUpdateFilters({ domain: e.target.value })}
          placeholder="Filter domain..."
          className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
        />
        <RuntimeSelect
          value={String(filters.callerKind)}
          onChange={(nextCallerKind) => onUpdateFilters({ callerKind: Number(nextCallerKind) })}
          size="sm"
          className="w-40"
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
          className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
        />
        <input
          type="datetime-local"
          value={filters.timeTo}
          onChange={(e) => onUpdateFilters({ timeTo: e.target.value })}
          className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800"
        />
      </div>

      {/* Event List */}
      <div className="max-h-[calc(100vh-32rem)] overflow-y-auto rounded-lg border border-gray-100">
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
    <div className="border-b border-gray-50 last:border-b-0">
      <div
        className="flex items-start justify-between gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded((p) => !p)}
      >
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-gray-400">{expanded ? '\u25BC' : '\u25B6'}</span>
          <span className="font-mono text-gray-400">{event.auditId.slice(0, 8)}...</span>
          <span className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
            {event.domain}
          </span>
          <span className="text-gray-700">{event.operation}</span>
          <span className="text-gray-500">{callerKindLabel(event.callerKind)}</span>
          {event.reasonCode ? (
            <span className="text-gray-400">reason={event.reasonCode}</span>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-gray-400" title={ts}>
          {ts !== '-' ? relativeTimeShort(ts) : '-'}
        </span>
      </div>
      {expanded ? (
        <div className="bg-gray-50/50 px-4 py-3 space-y-2">
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
              <pre className="rounded-md bg-gray-100 p-2 text-[10px] text-gray-700 overflow-x-auto max-h-40">
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
