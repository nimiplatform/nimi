import type { LocalAiAuditEvent } from '@runtime/local-ai-runtime';
import { useTranslation } from 'react-i18next';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { Tooltip } from '@renderer/components/tooltip.js';
import { formatLocaleDateTime, formatRelativeLocaleTime } from '@renderer/i18n';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import {
  buildAuditDiagnosticsText,
  resolveAuditDetail,
  resolveAuditModality,
  resolveAuditPolicyGate,
  resolveAuditReasonCode,
  resolveAuditSource,
} from './runtime-config-audit-view-model.js';
import { Button, RuntimeSelect } from './runtime-config-primitives.js';
import { useAuditPageData } from './runtime-config-use-audit-page-data.js';

function auditEventTypeColor(eventType: string): string {
  if (eventType.endsWith('_failed')) return 'bg-red-50 text-red-700 border-red-200';
  if (eventType.endsWith('_completed') || eventType.endsWith('_ready') || eventType.endsWith('_after_install'))
    return 'bg-green-50 text-green-700 border-green-200';
  if (eventType.endsWith('_started') || eventType.endsWith('_invoked'))
    return 'bg-blue-50 text-blue-700 border-blue-200';
  if (eventType.startsWith('fallback_')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
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
  const { t } = useTranslation();
  return (
    <section>
      <SectionTitle description={t('runtimeConfig.runtime.localDebugDescription', { defaultValue: 'Local-only events (5k limit, for debugging)' })}>
        {t('runtimeConfig.runtime.localDebugTitle', { defaultValue: 'Local AI Debug Audit' })}
      </SectionTitle>
      <SurfaceCard className="mt-3 overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{t('runtimeConfig.runtime.auditEvents', { defaultValue: 'Audit Events' })}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {collapsed
                ? t('runtimeConfig.runtime.clickToExpand', { defaultValue: 'Click to expand' })
                : t('runtimeConfig.runtime.clickToCollapse', { defaultValue: 'Click to collapse' })}
            </p>
          </div>
          <span className="text-gray-400 text-sm">{collapsed ? '\u25B6' : '\u25BC'}</span>
        </button>
        {!collapsed ? <LocalDebugContent /> : null}
      </SurfaceCard>
    </section>
  );
}

function LocalDebugContent() {
  const { t } = useTranslation();
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
            {latestEvent ? (
              <span>
                {t('runtimeConfig.runtime.latestEvent', {
                  value: formatLocaleDateTime(latestEvent.occurredAt),
                  defaultValue: 'latest: {{value}}',
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">{t('runtimeConfig.runtime.eventTypes', { defaultValue: 'Event Types' })}</p>
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
            <p className="text-xs font-medium text-gray-500">{t('runtimeConfig.runtime.sources', { defaultValue: 'Sources' })}</p>
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
            <p className="text-xs font-medium text-gray-500">{t('runtimeConfig.runtime.modalities', { defaultValue: 'Modalities' })}</p>
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
            {t('runtimeConfig.runtime.reasonCodes', {
              value: reasonBuckets.map((item) => `${item.reasonCode}(${item.count})`).join(', '),
              defaultValue: 'Reason Codes: {{value}}',
            })}
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
              { value: 'all', label: t('runtimeConfig.runtime.allEventTypes', { defaultValue: 'all event types' }) },
              { value: 'inference_invoked', label: 'inference_invoked' },
              { value: 'inference_failed', label: 'inference_failed' },
              { value: 'fallback_to_cloud', label: 'fallback_to_cloud' },
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
              { value: 'all', label: t('runtimeConfig.runtime.allSources', { defaultValue: 'all sources' }) },
              { value: 'local', label: t('runtimeConfig.runtime.localSource', { defaultValue: 'local' }) },
              { value: 'cloud', label: t('runtimeConfig.runtime.cloudSource', { defaultValue: 'cloud' }) },
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
              { value: 'all', label: t('runtimeConfig.runtime.allModalities', { defaultValue: 'all modalities' }) },
              { value: 'chat', label: 'chat' },
              { value: 'image', label: 'image' },
              { value: 'video', label: 'video' },
              { value: 'tts', label: 'tts' },
              { value: 'stt', label: 'stt' },
              { value: 'embedding', label: 'embedding' },
            ]}
          />
          <Button variant="secondary" size="sm" disabled={loadingAudits} onClick={() => void loadAudits()}>
            {loadingAudits
              ? t('runtimeConfig.runtime.loading', { defaultValue: 'Loading...' })
              : t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
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
            {t('runtimeConfig.runtime.copy', { defaultValue: 'Copy' })}
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
            {t('runtimeConfig.runtime.export', { defaultValue: 'Export' })}
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
            placeholder={t('runtimeConfig.runtime.filterReasonCode', { defaultValue: 'Filter reasonCode...' })}
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
      <ScrollShell
        className="max-h-[calc(100vh-30rem)] rounded-xl border border-gray-100 bg-gray-50/50"
        viewportClassName="max-h-[calc(100vh-30rem)]"
      >
        {filteredAudits.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            {t('runtimeConfig.runtime.noLocalAuditEvents', {
              defaultValue: 'No local audit events matching current filters.',
            })}
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredAudits.map((event) => (
              <LocalAuditEventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </ScrollShell>
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
        <Tooltip content={event.occurredAt} placement="top">
          <span className="shrink-0 text-[11px] text-gray-400">
            {formatRelativeLocaleTime(event.occurredAt)}
          </span>
        </Tooltip>
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
