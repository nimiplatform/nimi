import { Button, IconButton, Surface, Timeline, TimelineGroup } from '@nimiplatform/nimi-kit/ui';
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { deleteFitnessEvent, getHealthRecordEvents, getHealthRecordValues } from '../../bridge/sqlite-bridge.js';
import type { HealthRecordEventRow, HealthRecordValueRow } from '../../bridge/sqlite-bridge.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';
import { DentalRecordActionMenu } from './dental-record-action-menu.js';
import {
  FitnessAssessmentModal,
  ageTier,
  makeEntry,
  STANDARD_METRIC_IDS,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CATEGORY_EMOJI,
  INTENSITY_LABELS,
  type FitnessEditTarget,
  type FitnessEventEntry,
} from './fitness-assessment-form.js';
import { formatDateLabel } from '../journal/journal-page-helpers.js';

const AGE_TIER_LABELS: Record<string, string> = {
  preschool: '学龄前',
  grade12: '1-2年级',
  grade34: '3-4年级',
  grade56: '5-6年级',
  grade7plus: '初中及以上',
};

const FOOT_ARCH_LABELS: Record<string, string> = {
  normal: '正常',
  flat: '扁平足',
  'high-arch': '高弓足',
  monitoring: '观察中',
};

const SOURCE_LABELS: Record<string, string> = {
  'school-pe': '学校体育',
  'sports-club': '体育俱乐部',
  clinic: '医疗机构',
  self: '自测',
};

// National-standard test metrics, grouped for the card body. Each tuple is
// [metricId, label, unit]; only metrics with a recorded value render a chip.
const SPEED_METRICS: [string, string, string][] = [
  ['fitness.run_10m_shuttle', '10米折返跑', 's'],
  ['fitness.run_50m', '50米跑', 's'],
  ['fitness.run_800m', '800米跑', 's'],
  ['fitness.run_1000m', '1000米跑', 's'],
  ['fitness.run_50x8', '50m×8', 's'],
];
const STRENGTH_METRICS: [string, string, string][] = [
  ['fitness.standing_long_jump', '立定跳远', 'cm'],
  ['fitness.tennis_ball_throw', '网球掷远', 'm'],
  ['fitness.double_foot_jump', '双脚连续跳', 's'],
  ['fitness.sit_and_reach', '坐位体前屈', 'cm'],
  ['fitness.sit_ups', '仰卧起坐', '次/分'],
  ['fitness.pull_ups', '引体向上', '次'],
];
const CARDIO_METRICS: [string, string, string][] = [
  ['fitness.balance_beam', '走平衡木', 's'],
  ['fitness.rope_skipping', '跳绳', '次/分'],
  ['fitness.vital_capacity', '肺活量', 'mL'],
];

interface FitnessEntry {
  eventId: string;
  date: string;
  ageMonths: number;
  kind: 'standard' | 'activity';
  source: string | null;
  notes: string | null;
  valuesByMetric: Map<string, HealthRecordValueRow>;
}

function parseSource(metadataJson: string | null): string | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as { assessmentSource?: unknown };
    return typeof parsed.assessmentSource === 'string' ? parsed.assessmentSource : null;
  } catch {
    return null;
  }
}

// Reconstruct a form-ready entry from a stored record, for the edit modal.
function buildEditTarget(entry: FitnessEntry): FitnessEditTarget {
  let formEntry: FitnessEventEntry;
  if (entry.kind === 'standard') {
    formEntry = makeEntry('standard');
    (Object.keys(STANDARD_METRIC_IDS) as (keyof typeof STANDARD_METRIC_IDS)[]).forEach((key) => {
      const v = entry.valuesByMetric.get(STANDARD_METRIC_IDS[key])?.valueNumber;
      if (v != null) formEntry.standardValues[key] = String(v);
    });
  } else {
    const category = entry.valuesByMetric.get('fitness.activity_category')?.valueText ?? 'other';
    const duration = entry.valuesByMetric.get('fitness.activity_duration')?.valueNumber;
    const distance = entry.valuesByMetric.get('fitness.activity_distance')?.valueNumber;
    const intensity = entry.valuesByMetric.get('fitness.activity_intensity')?.valueText ?? '';
    formEntry = {
      category,
      standardValues: {},
      duration: duration != null ? String(duration) : '',
      distance: distance != null ? String(distance) : '',
      intensity,
    };
  }
  return {
    eventId: entry.eventId,
    date: entry.date,
    source: entry.source ?? 'self',
    notes: entry.notes ?? '',
    entry: formEntry,
  };
}

// Short human-readable summary of an entry, used as AI advisor context.
function summarizeEntry(entry: FitnessEntry): { topic: string; desc: string } {
  if (entry.kind === 'standard') {
    const parts: string[] = [];
    for (const [metricId, label, unit] of [...SPEED_METRICS, ...STRENGTH_METRICS, ...CARDIO_METRICS]) {
      const v = entry.valuesByMetric.get(metricId)?.valueNumber;
      if (v != null) parts.push(`${label} ${v}${unit}`);
    }
    return { topic: '国标体测', desc: [`日期：${entry.date}`, ...parts].join('；') };
  }
  const category = entry.valuesByMetric.get('fitness.activity_category')?.valueText ?? 'other';
  const duration = entry.valuesByMetric.get('fitness.activity_duration')?.valueNumber;
  const distance = entry.valuesByMetric.get('fitness.activity_distance')?.valueNumber;
  const intensity = entry.valuesByMetric.get('fitness.activity_intensity')?.valueText ?? null;
  const topic = ACTIVITY_CATEGORY_LABELS[category] ?? '运动记录';
  const parts = [`日期：${entry.date}`];
  if (duration != null) parts.push(`时长 ${duration} 分钟`);
  if (distance != null) parts.push(`距离 ${distance} 米`);
  if (intensity) parts.push(`强度 ${INTENSITY_LABELS[intensity] ?? intensity}`);
  return { topic, desc: parts.join('；') };
}

export default function FitnessPage() {
  const navigate = useNavigate();
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [events, setEvents] = useState<HealthRecordEventRow[]>([]);
  const [values, setValues] = useState<HealthRecordValueRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<FitnessEditTarget | null>(null);

  const reload = (childId: string) => {
    getHealthRecordEvents(childId).then(setEvents).catch(catchLog('fitness', 'action:load-health-record-events-failed'));
    getHealthRecordValues(childId).then(setValues).catch(catchLog('fitness', 'action:load-health-record-values-failed'));
  };

  useEffect(() => {
    if (activeChildId) reload(activeChildId);
  }, [activeChildId]);

  // Merge events + values into date-sorted fitness entries (newest first).
  const entries = useMemo<FitnessEntry[]>(() => {
    const valuesByEvent = new Map<string, HealthRecordValueRow[]>();
    for (const v of values) {
      const list = valuesByEvent.get(v.eventId);
      if (list) list.push(v);
      else valuesByEvent.set(v.eventId, [v]);
    }
    return events
      .filter((e) => e.groupId === 'fitness')
      .map((e) => {
        const byMetric = new Map<string, HealthRecordValueRow>();
        for (const v of valuesByEvent.get(e.eventId) ?? []) byMetric.set(v.metricId, v);
        return {
          eventId: e.eventId,
          date: e.effectiveDate.split('T')[0]!,
          ageMonths: e.ageMonths,
          kind: e.protocolId === 'fitness-sport-activity' ? 'activity' : 'standard',
          source: parseSource(e.metadataJson),
          notes: e.notes,
          valuesByMetric: byMetric,
        } satisfies FitnessEntry;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [events, values]);

  // One TimelineGroup per calendar date, matching the vision archive timeline.
  const dateGroups = useMemo(() => {
    const groups: { date: string; items: FitnessEntry[] }[] = [];
    for (const entry of entries) {
      const last = groups[groups.length - 1];
      if (last && last.date === entry.date) last.items.push(entry);
      else groups.push({ date: entry.date, items: [entry] });
    }
    return groups;
  }, [entries]);

  if (!child) {
    return (
      <ProfileDetailShell title="体能评估">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);
  const latestEntryId = entries[0]?.eventId;

  const handleAskAi = (entry: FitnessEntry) => {
    const { topic, desc } = summarizeEntry(entry);
    const params = new URLSearchParams({ topic, desc, record: 'fitness' });
    navigate(`/advisor?${params.toString()}`);
  };

  const handleDelete = async (entry: FitnessEntry) => {
    if (!window.confirm('确定删除这条体能记录？操作不可撤销。')) return;
    try {
      await deleteFitnessEvent(entry.eventId);
      reload(child.childId);
    } catch (error) {
      catchLog('fitness', 'action:delete-fitness-event-failed')(error);
    }
  };

  return (
    <ProfileDetailShell
      title="体能评估"
      actions={!showForm && !editTarget ? (
        <Button tone="primary" size="sm" onClick={() => setShowForm(true)} className="rounded-2xl">
          添加记录
        </Button>
      ) : null}
      aiSummary={
        <AISummaryCard domain="fitness" childName={child.displayName} childId={child.childId}
          ageLabel={`${Math.floor(ageMonths/12)}岁${ageMonths%12}个月`} gender={child.gender}
          dataContext={entries.length > 0 ? `共 ${entries.length} 条体能记录` : ''}
        />
      }
    >
      {/* Add Form */}
      {showForm && (
        <FitnessAssessmentModal
          child={{ childId: child.childId, birthDate: child.birthDate, gender: child.gender }}
          ageMonths={ageMonths}
          onSaved={() => reload(child.childId)}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Edit Form */}
      {editTarget && (
        <FitnessAssessmentModal
          child={{ childId: child.childId, birthDate: child.birthDate, gender: child.gender }}
          ageMonths={ageMonths}
          editTarget={editTarget}
          onSaved={() => reload(child.childId)}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Assessment Timeline */}
      <section>
        {entries.length === 0 ? (
          <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="rounded-3xl p-8 text-center">
            <span className="text-[24px]">🏃</span>
            <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">还没有体能记录</p>
            <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">选择运动类目，记录成绩与运动量</p>
          </Surface>
        ) : (
          <Timeline>
            {dateGroups.map((group, gi) => (
              <TimelineGroup
                key={group.date}
                variant="past"
                tone={gi === 0 ? 'success' : 'neutral'}
                date={formatDateLabel(group.date)}
                secondaryLabel={`${group.items.length} 条`}
                isLast={gi === dateGroups.length - 1}
              >
                {group.items.map((entry) => (
                  <FitnessEntryCard
                    key={entry.eventId}
                    entry={entry}
                    isLatest={entry.eventId === latestEntryId}
                    onAskAi={() => handleAskAi(entry)}
                    onEdit={() => setEditTarget(buildEditTarget(entry))}
                    onDelete={() => void handleDelete(entry)}
                  />
                ))}
              </TimelineGroup>
            ))}
          </Timeline>
        )}
      </section>
    </ProfileDetailShell>
  );
}

function LatestPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,transparent)] px-2 py-[3px] text-[11px] font-semibold text-[var(--nimi-status-success)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-success)]" />
      最新
    </span>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[14px]">
      <span className="text-[var(--nimi-text-muted)]">{label}</span>
      <span className="font-medium text-[var(--nimi-text-primary)]">{value}</span>
    </span>
  );
}

function MetricRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[13px] w-8 text-[var(--nimi-text-muted)]">{label}</span>
      {children}
    </div>
  );
}

// AI ✨ + edit/delete ⋮ cluster — mirrors the orthodontic journey timeline so
// the two timelines feel like one surface. The ⋮ menu fades in on card hover.
function CardActions({
  onAskAi,
  onEdit,
  onDelete,
}: {
  onAskAi: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton
        size="sm"
        tone="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onAskAi();
        }}
        aria-label="和 AI 聊这条记录"
        title="和 AI 聊这条记录"
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
            <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
          </svg>
        }
      />
      <div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <DentalRecordActionMenu onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

function FitnessEntryCard({
  entry,
  isLatest,
  onAskAi,
  onEdit,
  onDelete,
}: {
  entry: FitnessEntry;
  isLatest: boolean;
  onAskAi: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="group rounded-3xl p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {entry.kind === 'activity'
            ? <ActivityCardBody entry={entry} isLatest={isLatest} />
            : <StandardCardBody entry={entry} isLatest={isLatest} />}
        </div>
        <CardActions onAskAi={onAskAi} onEdit={onEdit} onDelete={onDelete} />
      </div>
      {entry.notes && (
        <p className="mt-3 border-t border-[var(--nimi-border-subtle)] pt-2 text-[14px] text-[var(--nimi-text-muted)]">
          {entry.notes}
        </p>
      )}
    </Surface>
  );
}

function StandardCardBody({ entry, isLatest }: { entry: FitnessEntry; isLatest: boolean }) {
  const chipsFor = (metrics: [string, string, string][]) =>
    metrics
      .map(([metricId, label, unit]) => {
        const v = entry.valuesByMetric.get(metricId);
        return v?.valueNumber != null ? <MetricChip key={metricId} label={label} value={`${v.valueNumber}${unit}`} /> : null;
      })
      .filter(Boolean);

  const speed = chipsFor(SPEED_METRICS);
  const strength = chipsFor(STRENGTH_METRICS);
  const cardio = chipsFor(CARDIO_METRICS);
  const footArch = entry.valuesByMetric.get('fitness.foot_arch_status')?.valueText ?? null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">
          {entry.source ? (SOURCE_LABELS[entry.source] ?? entry.source) : '国标体测'}
        </span>
        {isLatest && <LatestPill />}
        <span className="rounded bg-[var(--nimi-surface-panel)] px-1.5 py-0.5 text-[13px] text-[var(--nimi-text-muted)]">
          {AGE_TIER_LABELS[ageTier(entry.ageMonths)]}
        </span>
      </div>
      <div className="space-y-2">
        {speed.length > 0 && <MetricRow label="速度">{speed}</MetricRow>}
        {strength.length > 0 && <MetricRow label="力量">{strength}</MetricRow>}
        {cardio.length > 0 && <MetricRow label="心肺">{cardio}</MetricRow>}
        {footArch && (
          <MetricRow label="足弓">
            <span className="inline-flex items-center rounded-full bg-[var(--nimi-surface-panel)] px-2 py-0.5 text-[14px] font-medium text-[var(--nimi-text-primary)]">
              {FOOT_ARCH_LABELS[footArch] ?? footArch}
            </span>
          </MetricRow>
        )}
      </div>
    </>
  );
}

function ActivityCardBody({ entry, isLatest }: { entry: FitnessEntry; isLatest: boolean }) {
  const category = entry.valuesByMetric.get('fitness.activity_category')?.valueText ?? 'other';
  const duration = entry.valuesByMetric.get('fitness.activity_duration')?.valueNumber ?? null;
  const distance = entry.valuesByMetric.get('fitness.activity_distance')?.valueNumber ?? null;
  const intensity = entry.valuesByMetric.get('fitness.activity_intensity')?.valueText ?? null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">
          <span className="mr-1" aria-hidden="true">{ACTIVITY_CATEGORY_EMOJI[category] ?? '✨'}</span>
          {ACTIVITY_CATEGORY_LABELS[category] ?? category}
        </span>
        {isLatest && <LatestPill />}
        {entry.source && (
          <span className="rounded bg-[var(--nimi-surface-panel)] px-1.5 py-0.5 text-[13px] text-[var(--nimi-text-muted)]">
            {SOURCE_LABELS[entry.source] ?? entry.source}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {duration != null && <MetricChip label="时长" value={`${duration} 分钟`} />}
        {distance != null && <MetricChip label="距离" value={`${distance} 米`} />}
        {intensity && <MetricChip label="强度" value={INTENSITY_LABELS[intensity] ?? intensity} />}
      </div>
    </>
  );
}
