import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowLeft, CalendarClock, Plus } from 'lucide-react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import {
  getHealthRecordEvents,
  getHealthRecordValues,
  type SaveHealthRecordCaptureResult,
} from '../../bridge/sqlite-bridge.js';
import {
  buildHealthRecordSnapshot,
  getHealthMetricDefinition,
  recomputeDerivedHealthRecordValues,
  type HealthMetricSnapshot,
  type HealthRecordEvent,
  type HealthRecordValue,
} from '../../engine/health-record-domain.js';
import {
  HEALTH_METRIC_IDS,
  type HealthCaptureProtocolId,
  type HealthMetricId,
} from '../../knowledge-base/index.js';
import { HealthCaptureModal } from './health-capture-modal.js';
import { createDefaultHealthCaptureIntent, type HealthCaptureIntent } from './health-capture-orchestrator.js';
import {
  FRESHNESS_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  formatDate,
  formatHealthValue,
  groupLabel,
  metricLabel,
} from './health-record-display.js';
import { eventRowToDomain, valueRowToDomain } from './health-record-row-mappers.js';

interface MetricHistoryRow {
  value: HealthRecordValue;
  event: HealthRecordEvent;
}

const SOURCE_LABEL_KEYS: Record<HealthRecordEvent['sourceSurface'], string> = {
  profile_console: 'Profile.detail.sources.profileConsole',
  profile_detail: 'Profile.detail.sources.profileDetail',
  reminder: 'Profile.detail.sources.reminder',
  ocr_tool: 'Profile.detail.sources.ocrTool',
  import: 'Profile.detail.sources.import',
};

function isHealthMetricId(value: string | undefined): value is HealthMetricId {
  return Boolean(value && (HEALTH_METRIC_IDS as readonly string[]).includes(value));
}

function sourceLabel(source: HealthRecordEvent['sourceSurface'], t: TFunction) {
  return t(SOURCE_LABEL_KEYS[source] ?? source, { defaultValue: source });
}

export default function HealthMetricDetailPage() {
  const { metricId: routeMetricId } = useParams();
  const { t } = useTranslation();
  const activeChildId = useAppStore((state) => state.activeChildId);
  const children = useAppStore((state) => state.children);
  const activeChild = children.find((child) => child.childId === activeChildId);
  const [events, setEvents] = useState<HealthRecordEvent[]>([]);
  const [values, setValues] = useState<HealthRecordValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);

  const metricId = isHealthMetricId(routeMetricId) ? routeMetricId : null;
  const metric = useMemo(() => (metricId ? getHealthMetricDefinition(metricId) : null), [metricId]);

  const loadRecords = useCallback(async (childId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [eventRows, valueRows] = await Promise.all([
        getHealthRecordEvents(childId),
        getHealthRecordValues(childId),
      ]);
      setEvents(eventRows.map(eventRowToDomain));
      setValues(valueRows.map(valueRowToDomain));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeChildId) {
      setEvents([]);
      setValues([]);
      setLoading(false);
      return;
    }
    void loadRecords(activeChildId);
  }, [activeChildId, loadRecords]);

  const ageMonths = activeChild ? computeAgeMonths(activeChild.birthDate) : 0;
  const nowIso = useMemo(() => new Date().toISOString(), []);
  const metricSnapshot = useMemo<HealthMetricSnapshot | null>(() => {
    if (!activeChild || !metricId) return null;
    const snapshot = buildHealthRecordSnapshot({
      childId: activeChild.childId,
      ageMonths,
      events,
      values,
      nowIso,
      sex: activeChild.gender,
    });
    return snapshot.groups.flatMap((group) => group.metrics).find((item) => item.metric.metricId === metricId) ?? null;
  }, [activeChild, ageMonths, events, metricId, nowIso, values]);

  const historyRows = useMemo<MetricHistoryRow[]>(() => {
    if (!activeChild || !metricId) return [];
    const childEvents = events.filter((event) => event.childId === activeChild.childId);
    const eventById = new Map(childEvents.map((event) => [event.eventId, event]));
    const allValues = recomputeDerivedHealthRecordValues(
      childEvents,
      values.filter((value) => value.childId === activeChild.childId),
      {
        nowIso,
        makeValueId: (event, nextMetricId, sourceValueIds) =>
          `${event.eventId}:${nextMetricId}:${sourceValueIds.join('+')}`,
      },
    );
    return allValues
      .filter((value) => value.metricId === metricId)
      .map((value) => {
        const event = eventById.get(value.eventId);
        return event ? { value, event } : null;
      })
      .filter((row): row is MetricHistoryRow => row != null)
      .sort((left, right) => {
        const dateOrder = right.event.effectiveDate.localeCompare(left.event.effectiveDate);
        return dateOrder !== 0 ? dateOrder : right.value.createdAt.localeCompare(left.value.createdAt);
      });
  }, [activeChild, events, metricId, nowIso, values]);

  const initialIntent = useMemo<HealthCaptureIntent | null>(() => {
    const protocolId = metric?.captureProtocolIds[0] as HealthCaptureProtocolId | undefined;
    return protocolId ? createDefaultHealthCaptureIntent(protocolId, 'manual', new Date().toISOString().slice(0, 10)) : null;
  }, [metric]);

  if (!metricId || !metric) {
    return <Navigate to="/profile" replace />;
  }

  if (!activeChild) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: S.sub }}>
        {t('Profile.empty.noActiveChild', { defaultValue: 'Add a child profile first' })}
      </div>
    );
  }

  const groupText = groupLabel(metric.groupId, metric.groupId, t);
  const statusKey = metricSnapshot ? STATUS_LABEL_KEYS[metricSnapshot.evaluation.status] : null;
  const freshnessKey = metricSnapshot ? FRESHNESS_LABEL_KEYS[metricSnapshot.freshness] : null;

  return (
    <div className="h-full overflow-y-auto hide-scrollbar" style={{ background: 'transparent' }}>
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            to="/profile"
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-white/60"
            style={{ color: S.sub, background: 'rgba(255,255,255,0.35)' }}
          >
            <ArrowLeft size={14} />
            {t('Profile.detail.back', { defaultValue: 'Back' })}
          </Link>
          {initialIntent ? (
            <button
              type="button"
              onClick={() => setCaptureOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform hover:-translate-y-0.5"
              style={{ background: S.accent, boxShadow: '0 4px 14px rgba(78,204,163,0.22)' }}
              aria-label={t('Profile.detail.addRecord', { defaultValue: 'Add record' })}
              title={t('Profile.detail.addRecord', { defaultValue: 'Add record' })}
            >
              <Plus size={18} />
            </button>
          ) : null}
        </div>

        <Surface as="section" material="glass-thick" padding="none" tone="card" className="mb-5 overflow-hidden rounded-[var(--nimi-radius-xl)] p-6 shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
          <p className="text-[13px] font-medium" style={{ color: S.sub }}>{groupText}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal" style={{ color: S.text, letterSpacing: 0 }}>
            {metricLabel(metric, t)}
          </h1>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <MetricSummaryCell
              label={t('Profile.detail.latestValue', { defaultValue: 'Latest value' })}
              value={metricSnapshot ? formatHealthValue(metricSnapshot.latestValue, metric, t) : t('Profile.empty.noData', { defaultValue: 'No data' })}
            />
            <MetricSummaryCell
              label={t('Profile.detail.recordDate', { defaultValue: 'Record date' })}
              value={formatDate(metricSnapshot?.latestEvent?.effectiveDate, t)}
            />
            <MetricSummaryCell
              label={t('Profile.detail.nextRecordDate', { defaultValue: 'Next record' })}
              value={formatDate(metricSnapshot?.nextRecordAt, t)}
            />
            <MetricSummaryCell
              label={t('Profile.detail.status', { defaultValue: 'Status' })}
              value={
                metricSnapshot
                  ? `${t(statusKey ?? metricSnapshot.evaluation.status, { defaultValue: metricSnapshot.evaluation.status })} / ${t(freshnessKey ?? metricSnapshot.freshness, { defaultValue: metricSnapshot.freshness })}`
                  : t('Profile.status.missing', { defaultValue: 'Missing' })
              }
            />
          </div>
        </Surface>

        <Surface as="section" material="glass-regular" padding="none" tone="card" className="overflow-hidden rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
          <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'rgba(226,232,240,0.55)' }}>
            <h2 className="text-[15px] font-semibold tracking-normal" style={{ color: S.text, letterSpacing: 0 }}>
              {t('Profile.detail.history', { defaultValue: 'History' })}
            </h2>
            <span className="text-[12px]" style={{ color: S.sub }}>{historyRows.length}</span>
          </div>
          {error ? (
            <div className="px-5 py-6 text-[14px]" style={{ color: '#b91c1c' }}>
              {t('Profile.errors.loadFailed', { defaultValue: 'Health record could not load' })}
            </div>
          ) : loading ? (
            <div className="flex h-32 items-center justify-center text-[14px]" style={{ color: S.sub }}>
              {t('Profile.loading', { defaultValue: 'Loading...' })}
            </div>
          ) : historyRows.length === 0 ? (
            <div className="px-5 py-8 text-[14px]" style={{ color: S.sub }}>
              {t('Profile.detail.noHistory', { defaultValue: 'No history yet' })}
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'rgba(226,232,240,0.45)' }}>
              {historyRows.map((row) => (
                <div key={row.value.valueId} className="grid grid-cols-1 gap-2 px-5 py-3.5 md:grid-cols-[130px_minmax(120px,1fr)_140px_minmax(160px,1fr)] md:items-center md:gap-3">
                  <div className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: S.sub }}>
                    <CalendarClock size={13} />
                    {formatDate(row.event.effectiveDate, t)}
                  </div>
                  <div className="text-[14px] font-medium" style={{ color: S.text }}>
                    {formatHealthValue(row.value, metric, t)}
                  </div>
                  <div className="text-[13px]" style={{ color: S.sub }}>
                    {sourceLabel(row.event.sourceSurface, t)}
                  </div>
                  <div className="truncate text-[13px]" style={{ color: S.sub }}>
                    {row.event.notes || t('Profile.empty.noDate', { defaultValue: 'None' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>

      {initialIntent ? (
        <HealthCaptureModal
          open={captureOpen}
          childId={activeChild.childId}
          childBirthDate={activeChild.birthDate}
          initialIntent={initialIntent}
          onClose={() => setCaptureOpen(false)}
          onSaved={(_: SaveHealthRecordCaptureResult) => {
            void loadRecords(activeChild.childId);
          }}
        />
      ) : null}
    </div>
  );
}

function MetricSummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[14px] px-4 py-3" style={{ background: 'rgba(248,250,252,0.68)', border: '1px solid rgba(226,232,240,0.62)' }}>
      <p className="text-[12px]" style={{ color: S.sub }}>{label}</p>
      <p className="mt-1 truncate text-[15px] font-semibold" style={{ color: S.text }}>{value}</p>
    </div>
  );
}
