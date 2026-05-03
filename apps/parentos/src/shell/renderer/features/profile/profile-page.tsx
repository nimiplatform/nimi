import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, CalendarClock, Pencil, Plus, RefreshCw } from 'lucide-react';
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
  type HealthGroupSnapshot,
  type HealthMetricSnapshot,
  type HealthRecordEvent,
  type HealthRecordValue,
} from '../../engine/health-record-domain.js';
import type { HealthStatusColorAlias } from '../../knowledge-base/index.js';
import { ChildAvatar } from '../../shared/child-avatar.js';
import { HealthCaptureModal } from './health-capture-modal.js';
import {
  FRESHNESS_LABEL_KEYS,
  STATUS_LABEL_KEYS,
  formatAgeText,
  formatDate,
  formatMetricSnapshotValue,
  groupLabel,
  metricLabel,
} from './health-record-display.js';
import { eventRowToDomain, valueRowToDomain } from './health-record-row-mappers.js';

const COLOR_ALIAS_STYLE: Record<HealthStatusColorAlias, { bg: string; fg: string; dot: string }> = {
  green: { bg: 'rgba(34,197,94,0.10)', fg: '#15803d', dot: '#22c55e' },
  yellow: { bg: 'rgba(234,179,8,0.12)', fg: '#a16207', dot: '#eab308' },
  red: { bg: 'rgba(239,68,68,0.10)', fg: '#b91c1c', dot: '#ef4444' },
  neutral: { bg: 'rgba(100,116,139,0.10)', fg: '#475569', dot: '#94a3b8' },
  error: { bg: 'rgba(127,29,29,0.10)', fg: '#7f1d1d', dot: '#991b1b' },
};

function profileCompleteness(child: {
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  allergies: string[] | null;
  medicalNotes: string[] | null;
  recorderProfiles: Array<{ id: string; name: string }> | null;
}) {
  const fields = [
    child.birthWeightKg,
    child.birthHeightCm,
    child.birthHeadCircCm,
    child.avatarPath,
    child.allergies,
    child.medicalNotes,
    child.recorderProfiles,
  ];
  return Math.round((fields.filter((value) => value != null).length / fields.length) * 100);
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const activeChildId = useAppStore((state) => state.activeChildId);
  const children = useAppStore((state) => state.children);
  const activeChild = children.find((child) => child.childId === activeChildId);
  const [events, setEvents] = useState<HealthRecordEvent[]>([]);
  const [values, setValues] = useState<HealthRecordValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);

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
  const snapshot = useMemo(() => {
    if (!activeChild) return null;
    return buildHealthRecordSnapshot({
      childId: activeChild.childId,
      ageMonths,
      events,
      values,
      nowIso: new Date().toISOString(),
      sex: activeChild.gender,
    });
  }, [activeChild, ageMonths, events, values]);

  if (!activeChild) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: S.sub }}>
        {t('Profile.empty.noActiveChild', { defaultValue: 'Add a child profile first' })}
      </div>
    );
  }

  const completeness = profileCompleteness(activeChild);

  return (
    <div className="h-full overflow-y-auto hide-scrollbar" style={{ background: 'transparent' }}>
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-5">
        <Surface as="section" material="glass-thick" padding="none" tone="card" className="mb-5 overflow-hidden rounded-[var(--nimi-radius-xl)] p-6 shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
          <div className="flex flex-wrap items-center gap-5">
            <ChildAvatar
              child={activeChild}
              ageMonths={ageMonths}
              className="h-[72px] w-[72px] rounded-full border-2 object-cover"
              style={{ borderColor: 'rgba(226,232,240,0.35)', boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }}
            />
            <div className="min-w-[220px] flex-1">
              <h1 className="text-xl font-semibold tracking-normal" style={{ color: S.text, letterSpacing: 0 }}>
                {activeChild.displayName}
              </h1>
              <p className="mt-1 text-[14px]" style={{ color: S.sub }}>
                {formatAgeText(ageMonths, t)} / {t(activeChild.gender === 'male' ? 'Profile.gender.male' : 'Profile.gender.female', { defaultValue: activeChild.gender })} / {t('Profile.birthPrefix', { defaultValue: 'Born' })} {activeChild.birthDate}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-[5px] flex-1 overflow-hidden rounded-full" style={{ background: '#eef2f7' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${completeness}%`, background: S.accent }} />
                </div>
                <span className="text-[12px]" style={{ color: S.sub }}>{completeness}%</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCaptureOpen(true)}
                aria-label={t('Profile.actions.addHealthData', { defaultValue: 'Add health data' })}
                title={t('Profile.actions.addHealthData', { defaultValue: 'Add health data' })}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform hover:-translate-y-0.5"
                style={{ background: S.accent, boxShadow: '0 4px 14px rgba(78,204,163,0.22)' }}
              >
                <Plus size={18} />
              </button>
              <Link
                to="/settings/children"
                state={{ from: 'profile' }}
                aria-label={t('Profile.actions.editChild', { defaultValue: 'Edit child profile' })}
                title={t('Profile.actions.editChild', { defaultValue: 'Edit child profile' })}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform hover:-translate-y-0.5"
                style={{ background: S.text, boxShadow: '0 4px 14px rgba(15,23,42,0.14)' }}
              >
                <Pencil size={16} />
              </Link>
            </div>
          </div>
        </Surface>

        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-normal" style={{ color: S.text, letterSpacing: 0 }}>
              {t('Profile.title', { defaultValue: 'Health record' })}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void loadRecords(activeChild.childId)}
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-white/60"
            style={{ color: S.sub, background: 'rgba(255,255,255,0.35)' }}
          >
            <RefreshCw size={14} />
            {t('Profile.actions.refresh', { defaultValue: 'Refresh' })}
          </button>
        </div>

        {error ? (
          <div className="mb-4 flex items-center justify-between rounded-[16px] px-4 py-3" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
            <span className="text-[14px]">{t('Profile.errors.loadFailed', { defaultValue: 'Health record could not load' })}</span>
            <button type="button" onClick={() => void loadRecords(activeChild.childId)} className="rounded-full px-3 py-1 text-[13px]" style={{ background: '#fee2e2' }}>
              {t('Profile.actions.retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        ) : null}

        {loading || !snapshot ? (
          <div className="flex h-40 items-center justify-center text-[14px]" style={{ color: S.sub }}>{t('Profile.loading', { defaultValue: 'Loading...' })}</div>
        ) : (
          <div className="space-y-4">
            {snapshot.groups.map((group) => (
              <HealthGroupTable key={group.group.groupId} group={group} />
            ))}
          </div>
        )}
      </div>

        <HealthCaptureModal
        open={captureOpen}
        childId={activeChild.childId}
        childBirthDate={activeChild.birthDate}
        onClose={() => setCaptureOpen(false)}
        onSaved={(_: SaveHealthRecordCaptureResult) => {
          void loadRecords(activeChild.childId);
        }}
      />
    </div>
  );
}

function HealthGroupTable({ group }: { group: HealthGroupSnapshot }) {
  const { t } = useTranslation();
  const visibleMetrics = group.metrics.filter((snapshot) => snapshot.metric.sourceSupport.includes('manual') || snapshot.latestValue);
  if (visibleMetrics.length === 0) return null;

  const recordedCount = visibleMetrics.filter((snapshot) => snapshot.latestValue).length;
  return (
    <Surface as="section" material="glass-regular" padding="none" tone="card" className="overflow-hidden rounded-[var(--nimi-radius-xl)] shadow-[0_8px_32px_rgba(31,38,135,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: 'rgba(226,232,240,0.55)' }}>
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(78,204,163,0.10)', color: S.accent }}>
            <Activity size={17} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold tracking-normal" style={{ color: S.text, letterSpacing: 0 }}>
              {groupLabel(group.group.groupId, group.group.displayName, t)}
            </h3>
            <p className="text-[12px]" style={{ color: S.sub }}>{recordedCount}/{visibleMetrics.length}</p>
          </div>
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: 'rgba(226,232,240,0.45)' }}>
        {visibleMetrics.map((snapshot) => (
          <HealthMetricRow key={snapshot.metric.metricId} snapshot={snapshot} />
        ))}
      </div>
    </Surface>
  );
}

function HealthMetricRow({ snapshot }: { snapshot: HealthMetricSnapshot }) {
  const { t } = useTranslation();
  const tone = COLOR_ALIAS_STYLE[snapshot.evaluation.colorAlias];
  const metricDetailRoute = snapshot.metric.detailRoute ?? '/profile';
  const groupText = groupLabel(snapshot.metric.groupId, snapshot.metric.groupId, t);
  return (
    <Link to={metricDetailRoute} className="grid grid-cols-1 gap-2 px-5 py-3.5 transition-colors hover:bg-white/45 md:grid-cols-[minmax(130px,1fr)_minmax(110px,0.85fr)_110px_110px_120px] md:items-center md:gap-3">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold" style={{ color: S.text }}>
          {metricLabel(snapshot.metric, t)}
        </p>
        <p className="mt-0.5 truncate text-[12px]" style={{ color: S.sub }}>{groupText}</p>
      </div>
      <div className="text-[14px] font-medium" style={{ color: S.text }}>{formatMetricSnapshotValue(snapshot, t)}</div>
      <div className="text-[13px]" style={{ color: S.sub }}>{formatDate(snapshot.latestEvent?.effectiveDate, t)}</div>
      <div className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: S.sub }}>
        <CalendarClock size={13} />
        {formatDate(snapshot.nextRecordAt, t)}
      </div>
      <div className="flex justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ background: tone.bg, color: tone.fg }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
          {t(STATUS_LABEL_KEYS[snapshot.evaluation.status] ?? snapshot.evaluation.status, { defaultValue: snapshot.evaluation.status })}
          <span style={{ color: tone.fg, opacity: 0.72 }}>· {t(FRESHNESS_LABEL_KEYS[snapshot.freshness], { defaultValue: snapshot.freshness })}</span>
        </span>
      </div>
    </Link>
  );
}
