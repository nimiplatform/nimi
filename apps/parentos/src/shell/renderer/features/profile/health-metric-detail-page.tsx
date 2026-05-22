import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CalendarClock, Plus } from 'lucide-react';
import { IconButton, Surface } from '@nimiplatform/nimi-kit/ui';
import { GenericMetricDetailShell } from './_shared/generic-metric-detail-shell.js';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
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
  type HealthMetricId,
} from '../../knowledge-base/index.js';
import { HealthCaptureModal } from './health-capture-modal.js';
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

  const hasCaptureProtocol = (metric?.captureProtocolIds.length ?? 0) > 0;

  if (!metricId || !metric) {
    return <Navigate to="/profile" replace />;
  }

  if (!activeChild) {
    return (
      <GenericMetricDetailShell>
        <div className="flex h-full items-center justify-center text-[var(--nimi-text-muted)]">
          {t('Profile.empty.noActiveChild', { defaultValue: 'Add a child profile first' })}
        </div>
      </GenericMetricDetailShell>
    );
  }

  const groupText = groupLabel(metric.groupId, metric.groupId, t);
  const statusKey = metricSnapshot ? STATUS_LABEL_KEYS[metricSnapshot.evaluation.status] : null;
  const freshnessKey = metricSnapshot ? FRESHNESS_LABEL_KEYS[metricSnapshot.freshness] : null;

  return (
    <GenericMetricDetailShell
      topAction={hasCaptureProtocol ? (
        <IconButton
          tone="primary"
          size="md"
          onClick={() => setCaptureOpen(true)}
          className="h-10 w-10 rounded-full shadow-[var(--nimi-elevation-base)]"
          aria-label={t('Profile.detail.addRecord', { defaultValue: 'Add record' })}
          title={t('Profile.detail.addRecord', { defaultValue: 'Add record' })}
          icon={<Plus size={18} />}
        />
      ) : null}
    >
      <Surface as="section" material="glass-thick" padding="none" tone="card" className="mb-5 overflow-hidden rounded-2xl p-6 shadow-[var(--nimi-elevation-base)]">
          <p className="text-[13px] font-medium text-[var(--nimi-text-muted)]">{groupText}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[var(--nimi-text-primary)]">
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

        <Surface as="section" material="glass-regular" padding="none" tone="card" className="overflow-hidden rounded-2xl shadow-[var(--nimi-elevation-base)]">
          <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--nimi-border-subtle)_55%,transparent)] px-5 py-4">
            <h2 className="text-[15px] font-semibold tracking-normal text-[var(--nimi-text-primary)]">
              {t('Profile.detail.history', { defaultValue: 'History' })}
            </h2>
            <span className="text-[12px] text-[var(--nimi-text-muted)]">{historyRows.length}</span>
          </div>
          {error ? (
            <div className="px-5 py-6 text-[14px] text-[var(--nimi-status-danger)]">
              {t('Profile.errors.loadFailed', { defaultValue: 'Health record could not load' })}
            </div>
          ) : loading ? (
            <div className="flex h-32 items-center justify-center text-[14px] text-[var(--nimi-text-muted)]">
              {t('Profile.loading', { defaultValue: 'Loading...' })}
            </div>
          ) : historyRows.length === 0 ? (
            <div className="px-5 py-8 text-[14px] text-[var(--nimi-text-muted)]">
              {t('Profile.detail.noHistory', { defaultValue: 'No history yet' })}
            </div>
          ) : (
            <div className="divide-y divide-[color-mix(in_srgb,var(--nimi-border-subtle)_45%,transparent)]">
              {historyRows.map((row) => (
                <div key={row.value.valueId} className="grid grid-cols-1 gap-2 px-5 py-3.5 md:grid-cols-[130px_minmax(120px,1fr)_140px_minmax(160px,1fr)] md:items-center md:gap-3">
                  <div className="inline-flex items-center gap-1.5 text-[13px] text-[var(--nimi-text-muted)]">
                    <CalendarClock size={13} />
                    {formatDate(row.event.effectiveDate, t)}
                  </div>
                  <div className="text-[14px] font-medium text-[var(--nimi-text-primary)]">
                    {formatHealthValue(row.value, metric, t)}
                  </div>
                  <div className="text-[13px] text-[var(--nimi-text-muted)]">
                    {sourceLabel(row.event.sourceSurface, t)}
                  </div>
                  <div className="truncate text-[13px] text-[var(--nimi-text-muted)]">
                    {row.event.notes || t('Profile.empty.noDate', { defaultValue: 'None' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>

        {hasCaptureProtocol && captureOpen ? (
          <HealthCaptureModal
            open
            hideSidebar
            childId={activeChild.childId}
            childBirthDate={activeChild.birthDate}
            initialGroupId={metric.groupId}
            initialMetricId={metric.metricId}
            onClose={() => setCaptureOpen(false)}
            onSaved={(_: SaveHealthRecordCaptureResult) => {
              void loadRecords(activeChild.childId);
            }}
          />
        ) : null}
    </GenericMetricDetailShell>
  );
}

function MetricSummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-border-subtle)_62%,transparent)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_68%,transparent)] px-4 py-3">
      <p className="text-[12px] text-[var(--nimi-text-muted)]">{label}</p>
      <p className="mt-1 truncate text-[15px] font-semibold text-[var(--nimi-text-primary)]">{value}</p>
    </div>
  );
}
