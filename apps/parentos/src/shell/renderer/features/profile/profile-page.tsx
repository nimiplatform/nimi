import { Button, Surface } from '@nimiplatform/kit/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
import {
  getHealthRecordEvents,
  getHealthRecordValues,
  type SaveHealthRecordCaptureResult,
} from '../../bridge/sqlite-bridge.js';
import {
  buildHealthRecordSnapshot,
  type HealthRecordEvent,
  type HealthRecordSnapshot,
  type HealthRecordValue,
} from '../../engine/health-record-domain.js';
import type { TFunction } from 'i18next';
import { HealthCaptureModal } from './health-capture-modal.js';
import { eventRowToDomain, valueRowToDomain } from './health-record-row-mappers.js';
import { ProfileHero } from './profile-page-hero.js';
import { AISummaryCard } from './ai-summary-card.js';
import { ProfileGroupCard } from './profile-page-group-card.js';
import { formatMetricSnapshotValue, groupLabel, metricLabel } from './health-record-display.js';
import { ProfilePostureCard } from './profile-page-posture-card.js';

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

function lastRecordedDaysAgo(events: readonly HealthRecordEvent[]): number | null {
  if (events.length === 0) return null;
  let mostRecent = events[0]!.effectiveDate;
  for (const ev of events) {
    if (ev.effectiveDate > mostRecent) mostRecent = ev.effectiveDate;
  }
  const ms = Date.parse(mostRecent);
  if (!Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  return Math.max(0, Math.round(diff / (24 * 60 * 60 * 1000)));
}

// Flattens the rendered console snapshot into a human-readable digest the
// shared AI summary surface consumes. Derived only from snapshot data already
// on screen — no extra bridge calls or storage (PO-PROF-025).
function buildOverviewDataContext(snapshot: HealthRecordSnapshot, t: TFunction): string {
  const lines: string[] = [];
  for (const group of snapshot.groups) {
    const recorded = group.metrics.filter((metric) => metric.latestValue != null);
    if (recorded.length === 0) continue;
    const parts = recorded.map((metric) => {
      const value = formatMetricSnapshotValue(metric, t);
      const date = metric.latestEvent?.effectiveDate?.slice(0, 10);
      const label = metricLabel(metric.metric, t);
      return date ? `${label} ${value}（${date}）` : `${label} ${value}`;
    });
    lines.push(`${groupLabel(group.group.groupId, group.group.displayName, t)}：${parts.join('；')}`);
  }
  return lines.join('\n');
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusGroupId = searchParams.get('focus');
  const activeChildId = useAppStore((state) => state.activeChildId);
  const children = useAppStore((state) => state.children);
  const activeChild = children.find((child) => child.childId === activeChildId);
  const [events, setEvents] = useState<HealthRecordEvent[]>([]);
  const [values, setValues] = useState<HealthRecordValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureGroupId, setCaptureGroupId] = useState<string | null>(null);
  const [captureMetricId, setCaptureMetricId] = useState<string | null>(null);

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

  // ?focus=<groupId> is set when the user records data from the timeline
  // dashboard; after the group card mounts we scroll it into view and clear
  // the param so a refresh / back-nav doesn't re-trigger the scroll.
  useEffect(() => {
    if (!focusGroupId || loading) return;
    const target = document.getElementById(`profile-group-${focusGroupId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setSearchParams({}, { replace: true });
  }, [focusGroupId, loading, setSearchParams]);

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
      <div className="flex h-full items-center justify-center text-[var(--nimi-text-muted)]">
        {t('Profile.empty.noActiveChild', { defaultValue: 'Add a child profile first' })}
      </div>
    );
  }

  const completeness = profileCompleteness(activeChild);
  const recordCount = events.length;
  const recencyDays = lastRecordedDaysAgo(events);

  return (
    <div className="h-full overflow-y-auto hide-scrollbar">
      <div className="mx-auto max-w-5xl px-6 pb-10 pt-5">
        <ProfileHero
          child={activeChild}
          ageMonths={ageMonths}
          completeness={completeness}
          recordCount={recordCount}
          lastRecordedDaysAgo={recencyDays}
          onAddRecord={() => {
            setCaptureGroupId(null);
            setCaptureMetricId(null);
            setCaptureOpen(true);
          }}
        />

        {error ? (
          <Surface
            tone="card"
            padding="none"
            className="mb-5 flex items-center justify-between rounded-lg border-[var(--nimi-status-danger)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] px-4 py-3 text-[var(--nimi-status-danger)]"
          >
            <span className="text-[14px]">
              {t('Profile.errors.loadFailed', { defaultValue: 'Health record could not load' })}
            </span>
            <Button
              type="button"
              onClick={() => void loadRecords(activeChild.childId)}
              tone="danger"
              size="sm"
            >
              {t('Profile.actions.retry', { defaultValue: 'Retry' })}
            </Button>
          </Surface>
        ) : null}

        {loading || !snapshot ? (
          <div className="flex h-40 items-center justify-center text-[14px] text-[var(--nimi-text-muted)]">
            {t('Profile.loading', { defaultValue: 'Loading...' })}
          </div>
        ) : (
          <>
            <AISummaryCard
              domain="overview"
              childName={activeChild.displayName}
              childId={activeChild.childId}
              ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`}
              gender={activeChild.gender}
              dataContext={buildOverviewDataContext(snapshot, t)}
            />

            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold tracking-normal text-[var(--nimi-text-primary)]">
                    {t('Profile.archive.title', { defaultValue: '她的故事，分门别类' })}
                  </h2>
                </div>
                <Button
                  type="button"
                  onClick={() => void loadRecords(activeChild.childId)}
                  tone="ghost"
                  size="sm"
                  leadingIcon={<RefreshCw size={14} />}
                >
                  {t('Profile.actions.refresh', { defaultValue: 'Refresh' })}
                </Button>
              </div>
              <div className="space-y-4">
                {snapshot.groups.map((group) => (
                  <ProfileGroupCard
                    key={group.group.groupId}
                    group={group}
                    onCapture={(groupId, metricId) => {
                      setCaptureGroupId(groupId);
                      setCaptureMetricId(metricId ?? null);
                      setCaptureOpen(true);
                    }}
                  />
                ))}
                <ProfilePostureCard childId={activeChild.childId} />
              </div>
            </section>
          </>
        )}
      </div>

      <HealthCaptureModal
        open={captureOpen}
        childId={activeChild.childId}
        childBirthDate={activeChild.birthDate}
        initialGroupId={captureGroupId}
        initialMetricId={captureMetricId}
        onClose={() => {
          setCaptureOpen(false);
          setCaptureGroupId(null);
          setCaptureMetricId(null);
        }}
        onSaved={(_: SaveHealthRecordCaptureResult) => {
          void loadRecords(activeChild.childId);
        }}
      />
    </div>
  );
}
