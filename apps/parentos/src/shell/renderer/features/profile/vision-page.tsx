/**
 * Vision archive page — timeline-document view.
 *
 * Layout (top→bottom):
 *   profile header → AI summary → glance chips → trend chart → exam timeline
 *   (vertical-rail dot list with expandable details, including early screenings)
 *   → next steps → footer.
 *
 * Quantitative exams come from `growth_measurements` (grouped by date), early
 * screenings come from `medical_events` rows whose notes start with `vision:`.
 * Both streams are merged into a single ExamView list via `buildExamViews`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
import { deleteMeasurement, getMeasurements, getMedicalEvents } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow, MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AISummaryCard } from './ai-summary-card.js';
import { readImageFileAsDataUrl, analyzeCheckupSheetOCR } from './checkup-ocr.js';
import type { OCRMeasurementCandidate } from './checkup-ocr.js';
import {
  EYE_SET,
  buildExamViews, computeGlanceMetrics, deriveMeasurementExamKind, findLatestFullRecord,
  fmtAge, groupByDate,
  type VisionRecord,
} from './vision-data.js';
import { BatchForm } from './vision-batch-form.js';
import { VisionGuide } from './vision-guide.js';
import { OutdoorSummaryCard } from './outdoor-summary-card.js';
import {
  EARLY_SCREENING_MAX_AGE_MONTHS,
  RECENT_EXAM_COUNT,
  ScreeningModal,
  SourcesTooltip,
  NextStepsCard,
  TrendChartCard,
} from './vision-page-components.js';
import {
  AgeFilter,
  EmptyTimelineCard,
  ExamTimelineCard,
  GlanceChip,
  OlderRecordsToggle,
  SectionLabel,
} from './vision-page-cards.js';

/* ── Page ────────────────────────────────────────────────────────── */

export default function VisionPage() {
  const { t } = useTranslation();
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [medicalEvents, setMedicalEvents] = useState<MedicalEventRow[]>([]);
  const [chartType, setChartType] = useState<GrowthTypeId>('axial-length-right');

  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VisionRecord | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showScreeningModal, setShowScreeningModal] = useState(false);
  const [openExamId, setOpenExamId] = useState<string | null>(null);
  const [showAllOlder, setShowAllOlder] = useState(false);
  const [showAgeFilter, setShowAgeFilter] = useState(false);
  const [selectedAge, setSelectedAge] = useState<number | null>(null);

  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrDraft, setOCRDraft] = useState<OCRMeasurementCandidate[] | null>(null);
  const [ocrError, setOCRError] = useState<string | null>(null);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  const reload = () => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setMeasurements).catch(catchLog('vision', 'action:load-measurements-failed'));
    getMedicalEvents(activeChildId).then(setMedicalEvents).catch(catchLog('vision', 'action:load-medical-events-failed'));
  };

  useEffect(() => {
    reload();
  }, [activeChildId]);

  const records = useMemo(() => groupByDate(measurements), [measurements]);
  const exams = useMemo(() => buildExamViews(records, medicalEvents), [records, medicalEvents]);

  // Auto-open the latest exam on first load.
  useEffect(() => {
    if (openExamId == null && exams.length > 0) setOpenExamId(exams[0]!.id);
  }, [exams.length === 0 ? null : exams[0]?.id]);

  const filteredExams = useMemo(() => {
    if (selectedAge == null || !child) return exams;
    const bday = new Date(child.birthDate);
    return exams.filter((e) => {
      const age = (new Date(e.date).getTime() - bday.getTime()) / (365.25 * 24 * 3600 * 1000);
      return Math.floor(age) === selectedAge;
    });
  }, [exams, selectedAge, child]);

  const recentExams = filteredExams.slice(0, RECENT_EXAM_COUNT);
  const olderExams = filteredExams.slice(RECENT_EXAM_COUNT);

  const latestFullRecord = useMemo(() => findLatestFullRecord(records), [records]);
  const glanceMetrics = useMemo(() => computeGlanceMetrics(latestFullRecord), [latestFullRecord]);

  const trendPoints = useMemo(() => measurements, [measurements]);

  const latestBiometricDate = useMemo(
    () => exams.find((e) => e.kind === 'full' || e.kind === 'biometric')?.date ?? null,
    [exams],
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
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--nimi-fg-3)' }}>
        {t('Profile.empty.noActiveChild')}
      </div>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);
  const supportsScreening = ageMonths <= EARLY_SCREENING_MAX_AGE_MONTHS;
  const supportsQuantitative = ageMonths >= 36;

  const openManualForm = () => {
    setOCRDraft(null);
    setOCRError(null);
    setEditingRecord(null);
    setShowForm(true);
  };

  const handleVisionOCRUpload = async (file: File | null) => {
    if (!file) return;
    setOcrScanning(true);
    setOCRError(null);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      const result = await analyzeCheckupSheetOCR({ imageUrl: dataUrl });
      const eyeMeasurements = result.measurements.filter((measurement) => EYE_SET.has(measurement.typeId));
      if (eyeMeasurements.length === 0) {
        setOCRError(t('Profile.rich.vision.ocrNoData'));
        return;
      }
      setEditingRecord(null);
      setOCRDraft(eyeMeasurements);
      setShowForm(true);
    } catch (error) {
      setOCRError(error instanceof Error ? error.message : t('Profile.rich.vision.ocrFailed'));
    } finally {
      setOcrScanning(false);
      if (ocrInputRef.current) ocrInputRef.current.value = '';
    }
  };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-4">
        <Link to="/profile" className="text-[14px] hover:underline" style={{ color: 'var(--nimi-fg-3)' }}>← {t('Profile.rich.common.backToProfile')}</Link>
      </div>

      {/* Child switcher */}
      <div className="mb-3">
        <AppSelect
          value={activeChildId ?? ''}
          onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${fmtAge(computeAgeMonths(c.birthDate))}` }))}
        />
      </div>

      {/* Page header */}
      <header className="flex items-center gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold" style={{ color: 'var(--nimi-fg-1)' }}>
              {t('Profile.rich.vision.title', { name: child.displayName })}
            </h1>
            <SourcesTooltip />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {supportsQuantitative && (
            <button
              onClick={() => setShowGuide(!showGuide)}
              className={`flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-full transition-all`}
              style={showGuide ? { background: 'var(--nimi-accent-soft)', color: 'var(--nimi-accent)' } : { background: 'rgba(15,23,42,0.05)', color: 'var(--nimi-fg-2)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" />
              </svg>
              {t('Profile.rich.vision.recordGuide')}
            </button>
          )}
          {supportsQuantitative && (
            <button
              onClick={() => ocrInputRef.current?.click()}
              disabled={ocrScanning}
              className="group relative flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-full transition-all disabled:opacity-50"
              style={{ background: 'rgba(186,230,253,0.45)', color: 'var(--nimi-fg-2)', border: '1px solid rgba(14,165,233,0.20)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
              </svg>
              {ocrScanning ? t('Profile.rich.vision.recognizing') : t('Profile.rich.vision.smartRecognize')}
            </button>
          )}
          {supportsScreening && (
            <button
              onClick={() => setShowScreeningModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-full transition-all"
              style={{ background: 'rgba(15,23,42,0.05)', color: 'var(--nimi-fg-2)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
              </svg>
              {t('Profile.rich.vision.addScreening')}
            </button>
          )}
          {supportsQuantitative && (
            <button
              onClick={openManualForm}
              className="flex items-center gap-1 px-3.5 py-1.5 text-[12px] font-medium text-white rounded-full transition-all hover:opacity-90"
              style={{ background: 'var(--nimi-accent)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t('Profile.rich.vision.recordData')}
            </button>
          )}
        </div>
      </header>

      {/* OCR file input + error */}
      <input
        ref={ocrInputRef}
        type="file"
        accept="image/*"
        aria-label="vision-ocr-file"
        className="hidden"
        onChange={(event) => void handleVisionOCRUpload(event.target.files?.[0] ?? null)}
      />
      {ocrError && (
        <div
          className="rounded-[14px] px-4 py-3 mb-4 text-[13px]"
          style={{ background: 'rgba(239,68,68,0.06)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.20)' }}
          data-testid="vision-ocr-error"
        >
          {ocrError}
        </div>
      )}

      {showGuide && <VisionGuide onClose={() => setShowGuide(false)} />}

      <div className="flex flex-col gap-5">
        {/* Outdoor cross-link */}
        <OutdoorSummaryCard childId={child.childId} />

        {/* AI Summary */}
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
              setOCRDraft(null);
              setOCRError(null);
            }}
            ocrDraft={ocrDraft}
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

        {/* Exam timeline */}
        <div>
          <SectionLabel
            right={
              exams.length > 0 ? (
                <button
                  onClick={() => setShowAgeFilter((s) => !s)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] cursor-pointer transition-all border-0"
                  style={{
                    background: showAgeFilter ? 'var(--nimi-accent-soft)' : 'rgba(15,23,42,0.05)',
                    color: showAgeFilter ? 'var(--nimi-accent)' : 'var(--nimi-fg-2)',
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M7 12h10M11 18h2" />
                  </svg>
                  {selectedAge != null ? t('Profile.rich.vision.ageFilter', { age: selectedAge }) : t('Profile.rich.vision.ageFilterDefault')}
                  {selectedAge != null && (
                    <span
                      onClick={(e) => { e.stopPropagation(); setSelectedAge(null); }}
                      className="ml-0.5 opacity-70 text-[13px] leading-none"
                    >
                      ×
                    </span>
                  )}
                </button>
              ) : undefined
            }
          >
            {t('Profile.rich.vision.timelineTitle')}
            <span className="ml-2 text-[10px]" style={{ color: 'var(--nimi-fg-4)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
              {t('Profile.rich.vision.examCount', { count: exams.length })}
            </span>
          </SectionLabel>

          {showAgeFilter && (
            <AgeFilter
              exams={exams}
              birthDate={child.birthDate}
              selectedAge={selectedAge}
              onPick={setSelectedAge}
              activeExamId={openExamId}
              onExamClick={(id) => {
                const idx = exams.findIndex((e) => e.id === id);
                if (idx < 0) return;
                if (idx >= RECENT_EXAM_COUNT) setShowAllOlder(true);
                setOpenExamId(id);
                // Defer to next frame so the older list (if just expanded)
                // and the open-state re-render have committed before we scroll.
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
            <div className="relative" style={{ paddingLeft: 24 }}>
              <div
                className="absolute"
                style={{
                  left: 9, top: 16, bottom: 16, width: 2, borderRadius: 1,
                  background: 'linear-gradient(to bottom, rgba(15,23,42,0.10), rgba(15,23,42,0.04))',
                }}
              />
              <div className="flex flex-col gap-3.5">
                {recentExams.map((e, i) => (
                  <ExamTimelineCard
                    key={e.id}
                    exam={e}
                    prev={recentExams[i + 1] ?? olderExams[0]}
                    gender={child.gender}
                    isLatest={i === 0 && filteredExams[0]?.id === e.id}
                    isOpen={openExamId === e.id}
                    onToggle={() => setOpenExamId(openExamId === e.id ? null : e.id)}
                    onEdit={e.source === 'measurement' && e.record ? () => {
                      const rec = e.record!;
                      setOCRDraft(null);
                      setOCRError(null);
                      setEditingRecord(rec);
                      setShowForm(true);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    } : undefined}
                    onDelete={e.source === 'measurement' && e.record ? () => {
                      void handleDeleteRecord(e.record!);
                    } : undefined}
                  />
                ))}

                {olderExams.length > 0 && (
                  <OlderRecordsToggle
                    count={olderExams.length}
                    expanded={showAllOlder}
                    onToggle={() => setShowAllOlder((s) => !s)}
                  />
                )}

                {showAllOlder && olderExams.map((e, i) => (
                  <ExamTimelineCard
                    key={e.id}
                    exam={e}
                    prev={olderExams[i + 1]}
                    gender={child.gender}
                    isLatest={false}
                    isOpen={openExamId === e.id}
                    onToggle={() => setOpenExamId(openExamId === e.id ? null : e.id)}
                    onEdit={e.source === 'measurement' && e.record ? () => {
                      const rec = e.record!;
                      setOCRDraft(null);
                      setOCRError(null);
                      setEditingRecord(rec);
                      setShowForm(true);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    } : undefined}
                    onDelete={e.source === 'measurement' && e.record ? () => {
                      void handleDeleteRecord(e.record!);
                    } : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Next steps */}
        <NextStepsCard childId={child.childId} latestBiometricDate={latestBiometricDate} />

        {/* Footer */}
        <div
          className="flex justify-between items-center"
          style={{ padding: '16px 4px 0', borderTop: '1px solid rgba(15,23,42,0.06)' }}
        >
          <div className="text-[11px]" style={{ color: 'var(--nimi-fg-4)' }}>
            所有数据加密存储 · 仅家庭可见
          </div>
        </div>
      </div>
    </div>
  );
}

// `deriveMeasurementExamKind` exported here for tests that want to assert on
// kind-buckets without importing the data module directly.
export { deriveMeasurementExamKind };
