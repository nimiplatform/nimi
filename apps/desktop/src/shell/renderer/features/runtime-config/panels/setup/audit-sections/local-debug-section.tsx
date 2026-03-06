import type { LocalAiAuditEvent } from '@runtime/local-ai-runtime';
import { formatLocaleDateTime } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import {
  buildAuditDiagnosticsText,
  resolveAuditDetail,
  resolveAuditModality,
  resolveAuditPolicyGate,
  resolveAuditReasonCode,
  resolveAuditSource,
} from '../../../domain/diagnostics/audit-view-model.js';
import { Button, RuntimeSelect } from '../../primitives.js';
import { useAuditPageData } from '../use-audit-page-data.js';

function auditEventTypeColor(eventType: string): string {
  if (eventType.endsWith('_failed')) return 'bg-red-50 text-red-700 border-red-200';
  if (eventType.endsWith('_completed') || eventType.endsWith('_ready') || eventType.endsWith('_after_install'))
    return 'bg-green-50 text-green-700 border-green-200';
  if (eventType.endsWith('_started') || eventType.endsWith('_invoked'))
    return 'bg-blue-50 text-blue-700 border-blue-200';
  if (eventType.startsWith('fallback_')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return isoString;
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// SurfaceCard component matching Overview page style
function SurfaceCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04] ${className}`}>{children}</div>;
}

type LocalDebugSectionProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function LocalDebugSection({ collapsed, onToggle }: LocalDebugSectionProps) {
  return (
    <section>
      <SectionTitle description="Local-only events (5k limit, for debugging)">Local AI Debug Audit</SectionTitle>
      <SurfaceCard className="mt-3 overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Audit Events</h3>
            <p className="text-xs text-gray-500 mt-0.5">Click to {collapsed ? 'expand' : 'collapse'}</p>
          </div>
          <span className="text-gray-400 text-sm">{collapsed ? '\u25B6' : '\u25BC'}</span>
        </button>
        {!collapsed ? <LocalDebugContent /> : null}
      </SurfaceCard>
    </section>
  );
}

function LocalDebugContent() {
  const data = useAuditPageData(true);
  const {
    filteredAudits,
    loadingAudits,
    auditEventType,
    setAuditEventType,
    auditSource,
    setAuditSource,
    auditModality,
    setAuditModality,
    auditReasonCodeQuery,
    setAuditReasonCodeQuery,
    auditTimeFrom,
    setAuditTimeFrom,
    auditTimeTo,
    setAuditTimeTo,
    loadAudits,
    eventTypeCounts,
    sourceCounts,
    modalityCounts,
    reasonBuckets,
  } = data;

  const latestEvent = filteredAudits.length > 0 ? filteredAudits[0] : null;

  return (
    <div className="border-t border-gray-100 p-5 space-y-5">
      {/* Summary */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span className="font-medium">{filteredAudits.length} events</span>
            {latestEvent ? <span className="text-gray-400">|</span> : null}
            {latestEvent ? <span>latest: {formatLocaleDateTime(latestEvent.occurredAt)}</span> : null}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">Event Types</p>
            <div className="flex flex-wrap gap-1.5">
              {eventTypeCounts.length === 0 ? (
                <span className="text-xs text-gray-400">-</span>
              ) : (
                eventTypeCounts.map((item) => (
                  <span
                    key={item.eventType}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-medium ${auditEventTypeColor(item.eventType)}`}
                  >
                    {item.eventType}
                    <span className="rounded-full bg-white/60 px-1 text-[9px]">{item.count}</span>
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {sourceCounts.length === 0 ? (
                <span className="text-xs text-gray-400">-</span>
              ) : (
                sourceCounts.map((item) => (
                  <span
                    key={item.source}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-700"
                  >
                    {item.source}
                    <span className="rounded-full bg-gray-100 px-1 text-[9px]">{item.count}</span>
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">Modalities</p>
            <div className="flex flex-wrap gap-1.5">
              {modalityCounts.length === 0 ? (
                <span className="text-xs text-gray-400">-</span>
              ) : (
                modalityCounts.map((item) => (
                  <span
                    key={item.modality}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-700"
                  >
                    {item.modality}
                    <span className="rounded-full bg-gray-100 px-1 text-[9px]">{item.count}</span>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
        {reasonBuckets.length > 0 ? (
          <p className="text-xs text-gray-600">
            Reason Codes: {reasonBuckets.map((item) => `${item.reasonCode}(${item.count})`).join(', ')}
          </p>
        ) : null}
      </div>

      {/* Filter bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <RuntimeSelect
            value={auditEventType}
            onChange={(next) => {
              setAuditEventType(next);
              void loadAudits({ eventType: next });
            }}
            className="w-64"
            options={[
              { value: 'all', label: 'all event types' },
              { value: 'inference_invoked', label: 'inference_invoked' },
              { value: 'inference_failed', label: 'inference_failed' },
              { value: 'fallback_to_token_api', label: 'fallback_to_token_api' },
              { value: 'engine_started', label: 'engine_started' },
              { value: 'engine_stopped', label: 'engine_stopped' },
              { value: 'model_catalog_search_invoked', label: 'model_catalog_search_invoked' },
              { value: 'model_catalog_search_failed', label: 'model_catalog_search_failed' },
              { value: 'engine_pack_download_started', label: 'engine_pack_download_started' },
              { value: 'engine_pack_download_completed', label: 'engine_pack_download_completed' },
              { value: 'engine_pack_download_failed', label: 'engine_pack_download_failed' },
              { value: 'runtime_model_ready_after_install', label: 'runtime_model_ready_after_install' },
              { value: 'dependency_resolve_invoked', label: 'dependency_resolve_invoked' },
              { value: 'dependency_resolve_failed', label: 'dependency_resolve_failed' },
              { value: 'dependency_apply_started', label: 'dependency_apply_started' },
              { value: 'dependency_apply_completed', label: 'dependency_apply_completed' },
              { value: 'dependency_apply_failed', label: 'dependency_apply_failed' },
              { value: 'service_install_started', label: 'service_install_started' },
              { value: 'service_install_completed', label: 'service_install_completed' },
              { value: 'service_install_failed', label: 'service_install_failed' },
              { value: 'node_catalog_listed', label: 'node_catalog_listed' },
            ]}
          />
          <RuntimeSelect
            value={auditSource}
            onChange={(next) => {
              setAuditSource(next);
              void loadAudits({ source: next });
            }}
            className="w-44"
            options={[
              { value: 'all', label: 'all sources' },
              { value: 'local-runtime', label: 'local-runtime' },
              { value: 'token-api', label: 'token-api' },
            ]}
          />
          <RuntimeSelect
            value={auditModality}
            onChange={(next) => {
              setAuditModality(next);
              void loadAudits({ modality: next });
            }}
            className="w-44"
            options={[
              { value: 'all', label: 'all modalities' },
              { value: 'chat', label: 'chat' },
              { value: 'image', label: 'image' },
              { value: 'video', label: 'video' },
              { value: 'tts', label: 'tts' },
              { value: 'stt', label: 'stt' },
              { value: 'embedding', label: 'embedding' },
            ]}
          />
          <Button variant="secondary" size="sm" disabled={loadingAudits} onClick={() => void loadAudits()}>
            {loadingAudits ? 'Loading...' : 'Refresh'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const text = buildAuditDiagnosticsText(filteredAudits);
              if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                void navigator.clipboard.writeText(text);
              }
            }}
          >
            Copy
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (typeof document === 'undefined') return;
              const text = JSON.stringify(filteredAudits, null, 2);
              const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `local-ai-audits-${new Date().toISOString()}.json`;
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            Export
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input
            value={auditReasonCodeQuery}
            onChange={(event) => {
              const next = event.target.value;
              setAuditReasonCodeQuery(next);
              void loadAudits({ reasonCode: next });
            }}
            placeholder="Filter reasonCode..."
            className="h-9 rounded-xl border border-mint-100 bg-[#F4FBF8] px-3 text-xs text-gray-800 focus:border-mint-300 focus:bg-white focus:ring-2 focus:ring-mint-100"
          />
          <input
            type="datetime-local"
            value={auditTimeFrom}
            onChange={(event) => {
              const next = event.target.value;
              setAuditTimeFrom(next);
              void loadAudits({ timeFrom: next });
            }}
            className="h-9 rounded-xl border border-mint-100 bg-[#F4FBF8] px-3 text-xs text-gray-800 focus:border-mint-300 focus:bg-white focus:ring-2 focus:ring-mint-100"
          />
          <input
            type="datetime-local"
            value={auditTimeTo}
            onChange={(event) => {
              const next = event.target.value;
              setAuditTimeTo(next);
              void loadAudits({ timeTo: next });
            }}
            className="h-9 rounded-xl border border-mint-100 bg-[#F4FBF8] px-3 text-xs text-gray-800 focus:border-mint-300 focus:bg-white focus:ring-2 focus:ring-mint-100"
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="max-h-[calc(100vh-30rem)] overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/50">
        {filteredAudits.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">No local audit events matching current filters.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredAudits.map((event) => (
              <LocalAuditEventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LocalAuditEventCard({ event }: { event: LocalAiAuditEvent }) {
  const source = resolveAuditSource(event);
  const modality = resolveAuditModality(event);
  const reasonCode = resolveAuditReasonCode(event);
  const detail = resolveAuditDetail(event);
  const policyGate = resolveAuditPolicyGate(event);
  const colorClass = auditEventTypeColor(event.eventType);

  return (
    <div className="px-5 py-3 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`rounded-lg border px-2 py-0.5 text-[11px] font-medium ${colorClass}`}>{event.eventType}</span>
          <span className="text-[11px] text-gray-500">{source}</span>
          <span className="text-[11px] text-gray-400">{modality}</span>
        </div>
        <span className="shrink-0 text-[11px] text-gray-400" title={event.occurredAt}>
          {relativeTime(event.occurredAt)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
        {event.modelId ? <span>model={event.modelId}</span> : null}
        {event.localModelId ? <span>localModelId={event.localModelId}</span> : null}
        {detail !== '-' ? <span>detail={detail}</span> : null}
        {reasonCode !== '-' ? <span>reasonCode={reasonCode}</span> : null}
        {policyGate !== '-' ? <span>policyGate={policyGate}</span> : null}
      </div>
    </div>
  );
}
