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
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeAgeMonths, computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import {
  clearVisionFollowupSettings,
  deleteMeasurement,
  getMeasurements,
  getMedicalEvents,
  getVisionFollowupSettings,
  insertMedicalEvent,
  setVisionFollowupSettings,
  VISION_FOLLOWUP_CADENCE_DEFAULT,
  VISION_FOLLOWUP_CADENCE_MAX,
  VISION_FOLLOWUP_CADENCE_MIN,
} from '../../bridge/sqlite-bridge.js';
import type {
  MeasurementRow,
  MedicalEventRow,
  VisionFollowupSettings,
} from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AISummaryCard } from './ai-summary-card.js';
import { readImageFileAsDataUrl, analyzeCheckupSheetOCR } from './checkup-ocr.js';
import type { OCRMeasurementCandidate } from './checkup-ocr.js';
import {
  EYE_SET, CHART_OPTIONS,
  buildExamViews, computeGlanceMetrics, deriveMeasurementExamKind, findLatestFullRecord,
  fmtAge, groupByDate,
  type VisionRecord,
} from './vision-data.js';
import { BatchForm } from './vision-batch-form.js';
import { VisionGuide } from './vision-guide.js';
import { OutdoorSummaryCard } from './outdoor-summary-card.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import {
  AgeFilter,
  EmptyTimelineCard,
  ExamTimelineCard,
  GlanceChip,
  OlderRecordsToggle,
  SectionLabel,
} from './vision-page-cards.js';

const MONO = "var(--nimi-font-mono, 'JetBrains Mono', 'SF Mono', ui-monospace, monospace)";

const EARLY_SCREENING_MAX_AGE_MONTHS = 72;
const VISION_SCREENING_PREFIX = 'vision:';
const RECENT_EXAM_COUNT = 3;

const SCREENING_TYPES = [
  { key: 'red-reflex', labelKey: 'redReflex', emoji: '🔴', desc: '筛查先天性白内障', minAge: 0, maxAge: 12 },
  { key: 'fixation-tracking', labelKey: 'fixationTracking', emoji: '👁️', desc: '追踪物体能力', minAge: 2, maxAge: 12 },
  { key: 'cover-test', labelKey: 'coverTest', emoji: '🫣', desc: '筛查斜视', minAge: 4, maxAge: EARLY_SCREENING_MAX_AGE_MONTHS },
  { key: 'photoscreener', labelKey: 'photoscreener', emoji: '📷', desc: '屈光异常筛查', minAge: 6, maxAge: 48 },
  { key: 'tear-duct', labelKey: 'tearDuct', emoji: '💧', desc: '泪道阻塞筛查', minAge: 0, maxAge: 24 },
  { key: 'eye-checkup', labelKey: 'eyeCheckup', emoji: '🩺', desc: '通用眼科就诊', minAge: 0, maxAge: EARLY_SCREENING_MAX_AGE_MONTHS },
] as const;

const SCREENING_RESULT_OPTIONS = [
  { key: 'pass', labelKey: 'resultPass', color: '#10b981' },
  { key: 'refer', labelKey: 'resultRefer', color: '#ef4444' },
  { key: 'inconclusive', labelKey: 'resultInconclusive', color: '#f59e0b' },
] as const;

/* ── ScreeningModal — admit a new early screening to medical_events ─ */

function ScreeningModal({
  childId,
  birthDate,
  ageMonths,
  onClose,
  onSave,
}: {
  childId: string;
  birthDate: string;
  ageMonths: number;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const availableTypes = SCREENING_TYPES.filter((t) => ageMonths >= t.minAge && ageMonths <= t.maxAge);
  const [formType, setFormType] = useState<string>(availableTypes[0]?.key ?? 'eye-checkup');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formResult, setFormResult] = useState('pass');
  const [formHospital, setFormHospital] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const handleSubmit = async () => {
    if (!formDate) return;
    const screeningMeta = SCREENING_TYPES.find((t) => t.key === formType);
    const screeningLabel = screeningMeta ? t(`Profile.rich.vision.screeningTypes.${screeningMeta.labelKey}`) : formType;
    const now = isoNow();
    await insertMedicalEvent({
      eventId: ulid(),
      childId,
      eventType: 'checkup',
      title: t('Profile.rich.vision.screeningTitle', { label: screeningLabel }),
      eventDate: formDate,
      endDate: null,
      ageMonths: computeAgeMonthsAt(birthDate, formDate),
      severity: null,
      result: formResult,
      hospital: formHospital || null,
      medication: null,
      dosage: null,
      notes: `${VISION_SCREENING_PREFIX}${formType}${formNotes ? `\n${formNotes}` : ''}`,
      photoPath: null,
      now,
    });
    onSave();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className={`w-[560px] max-h-[85vh] overflow-y-auto ${S.radius} p-5 shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-semibold" style={{ color: S.text }}>{t('Profile.rich.vision.screeningModalTitle')}</h3>
          <button onClick={onClose} aria-label={t('Profile.rich.common.close')} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>

        <p className="text-[13px] mb-2" style={{ color: S.sub }}>{t('Profile.rich.vision.screeningItem')}</p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {availableTypes.map((screeningType) => (
            <button
              key={screeningType.key}
              onClick={() => setFormType(screeningType.key)}
              className={`flex items-center gap-1 px-3 py-1.5 text-[13px] ${S.radiusSm} transition-all`}
              style={formType === screeningType.key
                ? { background: S.accent, color: '#fff' }
                : { background: '#f5f3ef', color: S.sub }}
            >
              <span>{screeningType.emoji}</span> {t(`Profile.rich.vision.screeningTypes.${screeningType.labelKey}`)}
            </button>
          ))}
        </div>

        <p className="text-[13px] mb-2" style={{ color: S.sub }}>{t('Profile.rich.vision.screeningResult')}</p>
        <div className="flex gap-1.5 mb-4">
          {SCREENING_RESULT_OPTIONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setFormResult(r.key)}
              className={`px-3 py-1.5 text-[13px] ${S.radiusSm} transition-all font-medium`}
              style={formResult === r.key
                ? { background: r.color, color: '#fff' }
                : { background: '#f5f3ef', color: S.sub }}
            >
              {t(`Profile.rich.vision.${r.labelKey}`)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <p className="text-[13px] mb-1" style={{ color: S.sub }}>{t('Profile.rich.common.date')}</p>
            <ProfileDatePicker value={formDate} onChange={setFormDate} style={{ background: '#f5f3ef', color: S.text }} />
          </div>
          <div>
            <p className="text-[13px] mb-1" style={{ color: S.sub }}>{t('Profile.rich.vision.hospitalOrClinic')}</p>
            <input
              type="text" value={formHospital} onChange={(e) => setFormHospital(e.target.value)}
              placeholder={t('Profile.rich.common.optional')}
              className={`w-full px-3 py-2 text-[14px] ${S.radiusSm} border-0 outline-none`}
              style={{ background: '#f5f3ef', color: S.text }}
            />
          </div>
        </div>

        <div className="mb-4">
          <p className="text-[13px] mb-1" style={{ color: S.sub }}>{t('Profile.rich.vision.notes')}</p>
          <input
            type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
            placeholder={t('Profile.rich.common.optional')}
            className={`w-full px-3 py-2 text-[14px] ${S.radiusSm} border-0 outline-none`}
            style={{ background: '#f5f3ef', color: S.text }}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => void handleSubmit()}
            className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} hover:opacity-90 transition-all`}
            style={{ background: S.accent }}
          >
            {t('Profile.rich.common.save')}
          </button>
          <button
            onClick={onClose}
            className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-all`}
            style={{ background: '#f5f3ef', color: S.sub }}
          >
            {t('Profile.rich.common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sources tooltip ─────────────────────────────────────────────── */

function SourcesTooltip() {
  return (
    <div className="group relative">
      <div
        className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help transition-colors hover:bg-[#f0f0ec]"
        style={{ color: 'var(--nimi-fg-3)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </div>
      <div
        className="pointer-events-none absolute left-0 top-7 z-50 w-[340px] rounded-xl p-4 text-[13px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
        style={{ background: '#1e293b', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}
      >
        <p className="text-[14px] font-semibold text-white mb-2.5">数据参考文献</p>
        <ul className="space-y-2.5">
          <li>
            <span className="text-[#4ECCA3] font-medium">眼轴 P50/P75 百分位（分性别 · 4-18岁）</span>
            <span className="block text-[12px] text-[#a0a8b4] mt-0.5">He X, Sankaridurg P, Naduvilath T, et al. Normative data and percentile curves for axial length and axial length/corneal curvature in Chinese children and adolescents aged 4-18 years.</span>
            <span className="block text-[12px] text-[#7a8090]">Br J Ophthalmol 2023;107:167-175</span>
          </li>
          <li>
            <span className="text-[#4ECCA3] font-medium">远视储备 · 角膜曲率参考区间（6-15岁）</span>
            <span className="block text-[12px] text-[#a0a8b4] mt-0.5">中华预防医学会公共卫生眼科分会. 中国学龄儿童眼球远视储备、眼轴长度、角膜曲率参考区间及相关遗传因素专家共识（2022年）.</span>
            <span className="block text-[12px] text-[#7a8090]">中华眼科杂志 2022;58(2):96-102</span>
          </li>
          <li>
            <span className="text-[#4ECCA3] font-medium">眼轴防控应用共识</span>
            <span className="block text-[12px] text-[#a0a8b4] mt-0.5">中华医学会眼科学分会眼视光学组. 眼轴长度在近视防控管理中的应用专家共识（2023）.</span>
          </li>
          <li>
            <span className="text-[#4ECCA3] font-medium">近视防控技术指南</span>
            <span className="block text-[12px] text-[#a0a8b4] mt-0.5">国家卫生健康委员会. 儿童青少年近视防控适宜技术指南（更新版）. 2023</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ── Next-steps card — system-recommended OR user-customised cadence ─ */

const CADENCE_PRESETS: Array<{ months: number; label: string }> = [
  { months: 1, label: '1 个月' },
  { months: 3, label: '3 个月' },
  { months: 6, label: '6 个月' },
  { months: 12, label: '12 个月' },
];

interface NextStepsResolved {
  /** ISO date the parent should schedule the next visit. */
  visitDate: string;
  /** True when the parent overrode the next visit with a manual date. */
  isCustomDate: boolean;
  /** Months between visits — either the user's setting or the default. */
  cadenceMonths: number;
  /** True when the user has saved any override (cadence or custom date). */
  isUserOverride: boolean;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function monthsUntil(iso: string, today: Date): number {
  const d = new Date(iso);
  const ms = d.getTime() - today.getTime();
  return Math.round(ms / (30 * 24 * 3600 * 1000));
}

function fmtRelative(iso: string, today: Date): string {
  const m = monthsUntil(iso, today);
  if (m < 0) return `已过 ${Math.abs(m)} 个月`;
  if (m === 0) return '本月内';
  return `约 ${m} 个月后`;
}

function resolveNextVisit(
  latestExamDate: string | null,
  settings: VisionFollowupSettings | null,
): NextStepsResolved | null {
  const cadence = settings?.cadenceMonths ?? VISION_FOLLOWUP_CADENCE_DEFAULT;
  if (settings?.customNextDate) {
    return {
      visitDate: settings.customNextDate,
      isCustomDate: true,
      cadenceMonths: cadence,
      isUserOverride: true,
    };
  }
  if (!latestExamDate) return null;
  return {
    visitDate: addMonths(latestExamDate, cadence),
    isCustomDate: false,
    cadenceMonths: cadence,
    isUserOverride: settings != null,
  };
}

function NextStepsCard({
  childId,
  latestBiometricDate,
}: {
  childId: string;
  /** Latest exam date of any type — anchors the next-visit cadence. */
  latestBiometricDate: string | null;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<VisionFollowupSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    let cancelled = false;
    getVisionFollowupSettings(childId)
      .then((row) => { if (!cancelled) setSettings(row); })
      .catch(catchLog('vision', 'action:load-followup-settings-failed'));
    return () => { cancelled = true; };
  }, [childId]);

  const resolved = useMemo(
    () => resolveNextVisit(latestBiometricDate, settings),
    [latestBiometricDate, settings],
  );

  if (!resolved) return null;

  return (
    <div>
      <SectionLabel
        right={
          <button
            onClick={() => setEditing((e) => !e)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] cursor-pointer transition-all border-0"
            style={{
              background: editing ? 'var(--nimi-accent-soft)' : 'rgba(15,23,42,0.05)',
              color: editing ? 'var(--nimi-accent)' : 'var(--nimi-fg-2)',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6 1.65 1.65 0 0010 3.09V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.13.31.2.65.2 1v.09a2 2 0 010 4H20" />
            </svg>
            {t('Profile.rich.vision.reminderSettings')}
          </button>
        }
      >
        {t('Profile.detail.nextRecordDate')}
      </SectionLabel>
      <div
        className="rounded-[22px] nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)]"
        style={{ padding: 6, boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }}
      >
        <div className="flex items-center gap-3" style={{ padding: '12px 14px' }}>
          <div
            className="grid place-items-center flex-shrink-0 rounded-[12px]"
            style={{
              width: 32, height: 32,
              background: 'var(--nimi-accent-soft)',
              color: 'var(--nimi-accent)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[14px] font-medium" style={{ color: 'var(--nimi-fg-1)' }}>
                {t('Profile.rich.vision.nextReview')}
              </span>
              {resolved.isCustomDate && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(14,165,233,0.10)', color: '#0369a1' }}
                >
                  {t('Profile.rich.vision.custom')}
                </span>
              )}
              {!resolved.isCustomDate && resolved.isUserOverride && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(15,23,42,0.05)', color: 'var(--nimi-fg-3)' }}
                >
                  {t('Profile.rich.vision.everyMonths', { months: resolved.cadenceMonths })}
                </span>
              )}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--nimi-fg-3)', fontFamily: MONO }}>
              {resolved.visitDate} · {fmtRelative(resolved.visitDate, today)}
            </div>
          </div>
        </div>

        {editing && (
          <NextStepsEditor
            childId={childId}
            latestExamDate={latestBiometricDate}
            settings={settings}
            onClose={() => setEditing(false)}
            onSaved={(next) => {
              setSettings(next);
              setEditing(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

function NextStepsEditor({
  childId,
  latestExamDate,
  settings,
  onClose,
  onSaved,
}: {
  childId: string;
  latestExamDate: string | null;
  settings: VisionFollowupSettings | null;
  onClose: () => void;
  onSaved: (next: VisionFollowupSettings | null) => void;
}) {
  const { t } = useTranslation();
  const [cadence, setCadence] = useState<number>(settings?.cadenceMonths ?? VISION_FOLLOWUP_CADENCE_DEFAULT);
  const [customDate, setCustomDate] = useState<string>(settings?.customNextDate ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustomCadence = !CADENCE_PRESETS.some((p) => p.months === cadence);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (cadence < VISION_FOLLOWUP_CADENCE_MIN || cadence > VISION_FOLLOWUP_CADENCE_MAX) {
        setError(t('Profile.rich.vision.cadenceRangeError', { min: VISION_FOLLOWUP_CADENCE_MIN, max: VISION_FOLLOWUP_CADENCE_MAX }));
        return;
      }
      const trimmedDate = customDate.trim();
      const customNextDate = trimmedDate ? trimmedDate : null;
      if (customNextDate && !/^\d{4}-\d{2}-\d{2}$/.test(customNextDate)) {
        setError(t('Profile.rich.vision.customDateFormatError'));
        return;
      }
      await setVisionFollowupSettings({
        childId,
        cadenceMonths: cadence,
        customNextDate,
        now: isoNow(),
      });
      onSaved({
        childId,
        cadenceMonths: cadence,
        customNextDate,
        createdAt: settings?.createdAt ?? isoNow(),
        updatedAt: isoNow(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Profile.rich.vision.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleResetToSystem = async () => {
    setSaving(true);
    setError(null);
    try {
      await clearVisionFollowupSettings(childId);
      onSaved(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Profile.rich.vision.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-[18px] mt-1 mb-1 mx-1"
      style={{
        padding: '14px 14px 12px',
        background: 'rgba(15,23,42,0.025)',
        border: '1px solid rgba(15,23,42,0.06)',
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] mb-2" style={{ color: 'var(--nimi-fg-3)' }}>
        {t('Profile.rich.vision.followupFrequency')}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CADENCE_PRESETS.map((p) => (
          <button
            key={p.months}
            onClick={() => setCadence(p.months)}
            className="px-3 py-1.5 text-[12px] rounded-full border-0 cursor-pointer transition-all"
            style={cadence === p.months
              ? { background: 'var(--nimi-accent)', color: 'white' }
              : { background: 'rgba(15,23,42,0.04)', color: 'var(--nimi-fg-2)' }}
          >
            {p.months} {t('Profile.rich.vision.monthsShort')}
          </button>
        ))}
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={isCustomCadence
            ? { background: 'var(--nimi-accent-soft)', color: 'var(--nimi-accent)' }
            : { background: 'rgba(15,23,42,0.04)', color: 'var(--nimi-fg-3)' }}
        >
          <span className="text-[12px]">{t('Profile.rich.vision.custom')}</span>
          <input
            type="number"
            min={VISION_FOLLOWUP_CADENCE_MIN}
            max={VISION_FOLLOWUP_CADENCE_MAX}
            value={cadence}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setCadence(Math.round(n));
            }}
            className="w-12 text-center bg-transparent border-0 outline-none text-[12px] tabular-nums"
            style={{ color: 'inherit', fontFamily: MONO }}
            aria-label="vision-followup-cadence-custom"
          />
          <span className="text-[12px]">{t('Profile.rich.vision.monthsShort')}</span>
        </div>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] mb-2" style={{ color: 'var(--nimi-fg-3)' }}>
        {t('Profile.rich.vision.customNextDate')} <span className="font-normal normal-case lowercase" style={{ color: 'var(--nimi-fg-4)' }}>· {t('Profile.rich.vision.customNextDateHint')}</span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <ProfileDatePicker
          value={customDate}
          onChange={setCustomDate}
          className="flex-1 text-[13px] rounded-[10px] px-3 py-2 border-0 outline-none"
          style={{ background: 'white', color: 'var(--nimi-fg-1)' }}
        />
        {customDate && (
          <button
            onClick={() => setCustomDate('')}
            className="text-[11px] px-2.5 py-1.5 rounded-full border-0 cursor-pointer"
            style={{ background: 'rgba(15,23,42,0.05)', color: 'var(--nimi-fg-3)' }}
            aria-label="vision-followup-clear-custom-date"
          >
            {t('Profile.rich.vision.clear')}
          </button>
        )}
      </div>
      <div className="text-[11px] mb-3" style={{ color: 'var(--nimi-fg-4)' }}>
        {latestExamDate
          ? t('Profile.rich.vision.cadenceSuggestion', { months: cadence, date: addMonths(latestExamDate, cadence) })
          : t('Profile.rich.vision.noAnchor')}
      </div>

      {error && (
        <div
          className="rounded-[10px] mb-2 px-3 py-2 text-[12px]"
          style={{ background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        {settings ? (
          <button
            onClick={() => void handleResetToSystem()}
            disabled={saving}
            className="text-[11px] cursor-pointer border-0 bg-transparent disabled:opacity-50"
            style={{ color: 'var(--nimi-fg-3)' }}
          >
            {t('Profile.rich.vision.resetToSystem')}
          </button>
        ) : <span />}
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-[12px] px-3 py-1.5 rounded-full border-0 cursor-pointer disabled:opacity-50"
            style={{ background: 'rgba(15,23,42,0.05)', color: 'var(--nimi-fg-2)' }}
          >
            {t('Profile.rich.common.cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            aria-label="vision-followup-save"
            className="text-[12px] px-4 py-1.5 rounded-full border-0 cursor-pointer text-white disabled:opacity-50"
            style={{ background: 'var(--nimi-accent)' }}
          >
            {saving ? t('Profile.rich.common.saving') : t('Profile.rich.common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Trend chart card ────────────────────────────────────────────── */

function TrendChartCard({
  measurements,
  chartType,
  onChartTypeChange,
}: {
  measurements: MeasurementRow[];
  chartType: GrowthTypeId;
  onChartTypeChange: (v: GrowthTypeId) => void;
}) {
  const { t } = useTranslation();
  const typeInfo = GROWTH_STANDARDS.find((s) => s.typeId === chartType);
  const chartData = measurements
    .filter((m) => m.typeId === chartType)
    .sort((a, b) => a.ageMonths - b.ageMonths)
    .map((m) => ({ age: m.ageMonths, value: m.value, date: m.measuredAt.split('T')[0] }));

  return (
    <div
      className="rounded-[22px] nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border border-[var(--nimi-material-glass-regular-border)]"
      style={{ padding: 20, boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-baseline justify-between mb-3.5">
        <div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--nimi-fg-1)' }}>
            {t('Profile.rich.vision.curveTitle', { metric: typeInfo?.displayName ?? t('Profile.rich.vision.curveFallback') })}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--nimi-fg-3)' }}>
            {t('Profile.rich.vision.measurementCount', { count: chartData.length })}
          </div>
        </div>
        <AppSelect
          value={chartType}
          onChange={(v) => onChartTypeChange(v as GrowthTypeId)}
          options={CHART_OPTIONS.map((o) => ({ value: o.typeId, label: o.label }))}
        />
      </div>
      {chartData.length === 0 ? (
        <div className="p-8 text-center" style={{ color: 'var(--nimi-fg-3)' }}>
          <span className="text-[13px]">{t('Profile.rich.vision.emptyMetric', { metric: typeInfo?.displayName ?? '' })}</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" />
            <XAxis
              dataKey="age"
              tick={{ fontSize: 10 }}
              label={{ value: '月龄', position: 'insideBottom', offset: -4, fontSize: 10 }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              label={{ value: typeInfo?.unit ?? '', angle: -90, position: 'insideLeft', fontSize: 10 }}
            />
            <Tooltip
              formatter={(v: number) => [`${v} ${typeInfo?.unit ?? ''}`, typeInfo?.displayName]}
              labelFormatter={(a) => `${a} 个月`}
            />
            <Line type="monotone" dataKey="value" stroke="var(--nimi-accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--nimi-accent)' }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

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
