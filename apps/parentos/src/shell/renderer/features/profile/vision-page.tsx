import { Button, Timeline, TimelineDivider, TimelineGroup } from '@nimiplatform/kit/ui';
/**
 * Vision archive page — timeline-document view.
 *
 * Layout (top→bottom):
 *   profile header → AI summary → glance chips → trend chart → exam timeline
 *   (collapsed-by-default accordion; expands to a date-grouped vertical-rail
 *   timeline carrying both past exams and the projected next-visit, with the
 *   reminder-cadence editor folded in) → footer.
 *
 * Quantitative exams come from `growth_measurements` (grouped by date), early
 * screenings come from `medical_events` rows whose notes start with `vision:`.
 * Both streams are merged into a single ExamView list via `buildExamViews`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
import {
  deleteMeasurement,
  getMeasurements,
  getMedicalEvents,
  getVisionFollowupSettings,
} from '../../bridge/sqlite-bridge.js';
import type {
  MeasurementRow,
  MedicalEventRow,
  VisionFollowupSettings,
} from '../../bridge/sqlite-bridge.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AISummaryCard } from './ai-summary-card.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';
import {
  EYE_SET,
  buildExamViews, computeGlanceMetrics, deriveMeasurementExamKind, findLatestFullRecord,
  groupByDate,
  type ExamView,
  type VisionRecord,
} from './vision-data.js';
import { BatchForm } from './vision-batch-form.js';
import { VisionGuide } from './vision-guide.js';
import { OutdoorSummaryCard } from './outdoor-summary-card.js';
import {
  EARLY_SCREENING_MAX_AGE_MONTHS,
  NextStepsEditor,
  NextVisitCard,
  resolveNextVisit,
  ScreeningModal,
  SourcesTooltip,
  TrendChartCard,
} from './vision-page-components.js';
import {
  AgeFilter,
  EmptyTimelineCard,
  ExamTimelineCard,
  GlanceChip,
} from './vision-page-cards.js';
import { OrthodonticDetailsSection } from './orthodontic-details-section.js';
import { formatDateLabel } from '../journal/journal-page-helpers.js';

/* ── Page ────────────────────────────────────────────────────────── */

// Deep link from the /profile group card: ?metric=<healthMetricId> opens the
// matching trend-chart series. Maps each canonical vision metric id to its
// chart `GrowthTypeId`; an absent or unrecognized param keeps the default.
const METRIC_ID_TO_CHART_TYPE: Record<string, GrowthTypeId> = {
  'vision.left_visual_acuity': 'vision-left',
  'vision.right_visual_acuity': 'vision-right',
  'vision.left_axial_length': 'axial-length-left',
  'vision.right_axial_length': 'axial-length-right',
  'vision.left_iop': 'iop-left',
  'vision.right_iop': 'iop-right',
};

export default function VisionPage() {
  const { t } = useTranslation();
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  const [searchParams] = useSearchParams();
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [medicalEvents, setMedicalEvents] = useState<MedicalEventRow[]>([]);
  const [chartType, setChartType] = useState<GrowthTypeId>(
    () => METRIC_ID_TO_CHART_TYPE[searchParams.get('metric') ?? ''] ?? 'axial-length-right',
  );

  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VisionRecord | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showScreeningModal, setShowScreeningModal] = useState(false);
  const [openExamId, setOpenExamId] = useState<string | null>(null);
  const [showAgeFilter, setShowAgeFilter] = useState(false);
  const [selectedAge, setSelectedAge] = useState<number | null>(null);
  const [followupSettings, setFollowupSettings] = useState<VisionFollowupSettings | null>(null);
  const [showReminderEditor, setShowReminderEditor] = useState(false);

  const reload = () => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setMeasurements).catch(catchLog('vision', 'action:load-measurements-failed'));
    getMedicalEvents(activeChildId).then(setMedicalEvents).catch(catchLog('vision', 'action:load-medical-events-failed'));
    getVisionFollowupSettings(activeChildId).then(setFollowupSettings).catch(catchLog('vision', 'action:load-followup-settings-failed'));
  };

  useEffect(() => {
    reload();
  }, [activeChildId]);

  const records = useMemo(() => groupByDate(measurements), [measurements]);
  const exams = useMemo(() => buildExamViews(records, medicalEvents), [records, medicalEvents]);

  const filteredExams = useMemo(() => {
    if (selectedAge == null || !child) return exams;
    const bday = new Date(child.birthDate);
    return exams.filter((e) => {
      const age = (new Date(e.date).getTime() - bday.getTime()) / (365.25 * 24 * 3600 * 1000);
      return Math.floor(age) === selectedAge;
    });
  }, [exams, selectedAge, child]);

  // Date-grouped exams — one TimelineGroup per calendar date, matching the
  // orthodontic 正畸记录 timeline layout (date header carries the date label).
  const examDateGroups = useMemo(() => {
    const groups: { date: string; exams: ExamView[] }[] = [];
    for (const e of filteredExams) {
      const last = groups[groups.length - 1];
      if (last && last.date === e.date) last.exams.push(e);
      else groups.push({ date: e.date, exams: [e] });
    }
    return groups;
  }, [filteredExams]);

  const latestFullRecord = useMemo(() => findLatestFullRecord(records), [records]);
  const glanceMetrics = useMemo(() => computeGlanceMetrics(latestFullRecord), [latestFullRecord]);

  const trendPoints = useMemo(() => measurements, [measurements]);

  const latestBiometricDate = useMemo(
    () => exams.find((e) => e.kind === 'full' || e.kind === 'biometric')?.date ?? null,
    [exams],
  );

  // Projected next visit — rendered as a "future" entry at the top of the
  // exam timeline (above the 今天 divider), mirroring the orthodontic
  // 正畸记录 timeline.
  const today = useMemo(() => new Date(), []);
  const nextVisit = useMemo(
    () => resolveNextVisit(latestBiometricDate, followupSettings),
    [latestBiometricDate, followupSettings],
  );

  // Latest values for AI context (computed before the !child early return so
  // the hook order stays stable across renders — see React rules of hooks).
  const latest = useMemo(() => {
    const next = new Map<string, MeasurementRow>();
    for (const record of measurements) {
      if (!EYE_SET.has(record.typeId)) continue;
      const existing = next.get(record.typeId);
      if (!existing || record.measuredAt > existing.measuredAt) {
        next.set(record.typeId, record);
      }
    }
    return next;
  }, [measurements]);

  const handleDeleteRecord = async (record: VisionRecord) => {
    const confirmed = window.confirm(t('Profile.rich.vision.deleteConfirm', { date: record.date }));
    if (!confirmed) return;
    await Promise.all(
      [...record.measurementsByType.values()].map((measurement) => deleteMeasurement(measurement.measurementId)),
    );
    reload();
  };

  if (!child) {
    return (
      <ProfileDetailShell title="视力档案">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);
  const supportsScreening = ageMonths <= EARLY_SCREENING_MAX_AGE_MONTHS;
  const supportsQuantitative = ageMonths >= 36;

  const openManualForm = () => {
    setEditingRecord(null);
    setShowForm(true);
  };

  return (
    <ProfileDetailShell
      title={
        <span className="flex items-center gap-2">
          <span>{t('Profile.rich.vision.title', { name: child.displayName })}</span>
          <SourcesTooltip />
        </span>
      }
      actions={
        <>
          {supportsQuantitative && (
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${showGuide ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]' : 'bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-secondary)]'}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" />
              </svg>
              {t('Profile.rich.vision.recordGuide')}
            </button>
          )}
          {supportsScreening && (
            <button
              onClick={() => setShowScreeningModal(true)}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--nimi-action-ghost-hover)] px-3 py-1.5 text-[12px] font-medium text-[var(--nimi-text-secondary)] transition-all"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
              </svg>
              {t('Profile.rich.vision.addScreening')}
            </button>
          )}
          {supportsQuantitative && (
            <Button
              onClick={openManualForm}
              tone="primary"
              size="sm"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t('Profile.rich.vision.recordData')}
            </Button>
          )}
        </>
      }
      aiSummary={
        <AISummaryCard
          domain="vision"
          childName={child.displayName}
          childId={child.childId}
          ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`}
          gender={child.gender}
          dataContext={(() => {
            const lines: string[] = [];
            const vl = latest.get('vision-left'), vr = latest.get('vision-right');
            if (vl) lines.push(`${t('Profile.metrics.vision.leftVisualAcuity')}: ${vl.value}`);
            if (vr) lines.push(`${t('Profile.metrics.vision.rightVisualAcuity')}: ${vr.value}`);
            const al = latest.get('axial-length-left'), ar = latest.get('axial-length-right');
            if (al) lines.push(`${t('Profile.metrics.vision.leftAxialLength')}: ${al.value}mm`);
            if (ar) lines.push(`${t('Profile.metrics.vision.rightAxialLength')}: ${ar.value}mm`);
            return lines.join('\n');
          })()}
        />
      }
    >
      {showGuide && <VisionGuide onClose={() => setShowGuide(false)} />}

      <div className="flex flex-col gap-5">
        {/* Outdoor cross-link */}
        <OutdoorSummaryCard childId={child.childId} />

        {/* At-a-glance chips */}
        {latestFullRecord && (
          <div className="grid grid-cols-3 gap-2.5">
            {glanceMetrics.map((m) => (
              <GlanceChip key={m.label} metric={m} />
            ))}
          </div>
        )}

        {/* Trend chart */}
        {records.length > 0 && (
          <TrendChartCard
            measurements={trendPoints}
            chartType={chartType}
            gender={child.gender}
            onChartTypeChange={setChartType}
          />
        )}

        {/* Quantitative form modal */}
        {supportsQuantitative && showForm && (
          <BatchForm
            childId={child.childId}
            birthDate={child.birthDate}
            onSave={reload}
            onClose={() => {
              setShowForm(false);
              setEditingRecord(null);
            }}
            initialRecord={editingRecord ?? undefined}
          />
        )}

        {/* Screening form modal */}
        {showScreeningModal && (
          <ScreeningModal
            childId={child.childId}
            birthDate={child.birthDate}
            ageMonths={ageMonths}
            onClose={() => setShowScreeningModal(false)}
            onSave={reload}
          />
        )}

        {/* Exam timeline — collapsed by default; expands to the full
            date-grouped list, matching the orthodontic 正畸记录 timeline. */}
        <OrthodonticDetailsSection
          title={t('Profile.rich.vision.timelineTitle')}
          count={t('Profile.rich.vision.examCount', { count: exams.length })}
        >
          {exams.length > 0 && (
            <div className="mb-3 flex justify-end gap-2">
              <button
                onClick={() => setShowReminderEditor((s) => !s)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 px-2.5 py-1 text-[11px] transition-all ${showReminderEditor ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]' : 'bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-secondary)]'}`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6 1.65 1.65 0 0010 3.09V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.13.31.2.65.2 1v.09a2 2 0 010 4H20" />
                </svg>
                {t('Profile.rich.vision.reminderSettings')}
              </button>
              <button
                onClick={() => setShowAgeFilter((s) => !s)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border-0 px-2.5 py-1 text-[11px] transition-all ${showAgeFilter ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]' : 'bg-[var(--nimi-action-ghost-hover)] text-[var(--nimi-text-secondary)]'}`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M7 12h10M11 18h2" />
                </svg>
                {selectedAge != null
                  ? t('Profile.rich.vision.ageFilter', { age: selectedAge })
                  : t('Profile.rich.vision.ageFilterDefault')}
                {selectedAge != null && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setSelectedAge(null); }}
                    className="ml-0.5 opacity-70 text-[13px] leading-none"
                  >
                    ×
                  </span>
                )}
              </button>
            </div>
          )}

          {showReminderEditor && (
            <div className="mb-3">
              <NextStepsEditor
                childId={child.childId}
                latestExamDate={latestBiometricDate}
                settings={followupSettings}
                onClose={() => setShowReminderEditor(false)}
                onSaved={(next) => {
                  setFollowupSettings(next);
                  setShowReminderEditor(false);
                }}
              />
            </div>
          )}

          {showAgeFilter && (
            <AgeFilter
              exams={exams}
              birthDate={child.birthDate}
              selectedAge={selectedAge}
              onPick={setSelectedAge}
              activeExamId={openExamId}
              onExamClick={(id) => {
                setOpenExamId(id);
                // Defer to next frame so the open-state re-render has
                // committed before we scroll.
                requestAnimationFrame(() => {
                  const el = document.querySelector<HTMLElement>(`[data-exam-id="${id}"]`);
                  el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                });
              }}
            />
          )}

          {exams.length === 0 ? (
            <EmptyTimelineCard message={supportsQuantitative ? t('Profile.rich.vision.emptyTimelineFull') : t('Profile.rich.vision.emptyTimeline')} />
          ) : (
            <Timeline>
              {nextVisit && (
                <TimelineGroup
                  variant="future"
                  date={formatDateLabel(nextVisit.visitDate)}
                  secondaryLabel="1 条"
                >
                  <NextVisitCard resolved={nextVisit} today={today} />
                </TimelineGroup>
              )}

              {nextVisit && examDateGroups.length > 0 && <TimelineDivider label="今天" />}

              {examDateGroups.map((group, gi) => (
                <TimelineGroup
                  key={group.date}
                  variant="past"
                  tone={gi === 0 ? 'success' : 'neutral'}
                  date={formatDateLabel(group.date)}
                  secondaryLabel={`${group.exams.length} 条`}
                  isLast={gi === examDateGroups.length - 1}
                >
                  {group.exams.map((e) => (
                    <ExamTimelineCard
                      key={e.id}
                      exam={e}
                      gender={child.gender}
                      isLatest={e.id === filteredExams[0]?.id}
                      isOpen={openExamId === e.id}
                      onToggle={() => setOpenExamId(openExamId === e.id ? null : e.id)}
                      onEdit={e.source === 'measurement' && e.record ? () => {
                        const rec = e.record!;
                        setEditingRecord(rec);
                        setShowForm(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      } : undefined}
                      onDelete={e.source === 'measurement' && e.record ? () => {
                        void handleDeleteRecord(e.record!);
                      } : undefined}
                    />
                  ))}
                </TimelineGroup>
              ))}
            </Timeline>
          )}
        </OrthodonticDetailsSection>

        {/* Footer */}
        <div
          style={{ padding: '16px 4px 0' }}
          className="flex items-center justify-between border-t border-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)]"
        >
          <div className="text-[11px] text-[var(--nimi-text-muted)]">
            所有数据加密存储 · 仅家庭可见
          </div>
        </div>
      </div>
    </ProfileDetailShell>
  );
}

// `deriveMeasurementExamKind` exported here for tests that want to assert on
// kind-buckets without importing the data module directly.
export { deriveMeasurementExamKind };
