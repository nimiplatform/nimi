import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeAgeMonths, computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import { deleteMeasurement, getMeasurements, getMedicalEvents, insertMedicalEvent } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow, MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { AISummaryCard } from './ai-summary-card.js';
import { readImageFileAsDataUrl, analyzeCheckupSheetOCR } from './checkup-ocr.js';
import type { OCRMeasurementCandidate } from './checkup-ocr.js';
import {
  EYE_SET, CHART_OPTIONS, CARD_REFRACTION_ROWS, CARD_AXIAL_ROWS,
  groupByDate, fmtAge, getAxialRef,
  type VisionRecord,
} from './vision-data.js';
import { BatchForm } from './vision-batch-form.js';
import { VisionGuide } from './vision-guide.js';
import { OutdoorSummaryCard } from './outdoor-summary-card.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { ProfileDatePicker } from './profile-date-picker.js';

/* ── Early vision screening types (0-36 months) ─────────── */

const EARLY_SCREENING_MAX_AGE_MONTHS = 72;

const SCREENING_TYPES = [
  { key: 'red-reflex', label: '红光反射', emoji: '🔴', desc: '筛查先天性白内障', minAge: 0, maxAge: 12 },
  { key: 'fixation-tracking', label: '注视追视', emoji: '👁️', desc: '追踪物体能力', minAge: 2, maxAge: 12 },
  { key: 'cover-test', label: '遮盖试验', emoji: '🫣', desc: '筛查斜视', minAge: 4, maxAge: EARLY_SCREENING_MAX_AGE_MONTHS },
  { key: 'photoscreener', label: '光筛查仪', emoji: '📷', desc: '屈光异常筛查', minAge: 6, maxAge: 48 },
  { key: 'tear-duct', label: '泪道检查', emoji: '💧', desc: '泪道阻塞筛查', minAge: 0, maxAge: 24 },
  { key: 'eye-checkup', label: '眼科检查', emoji: '🩺', desc: '通用眼科就诊', minAge: 0, maxAge: EARLY_SCREENING_MAX_AGE_MONTHS },
] as const;

const SCREENING_RESULT_OPTIONS = [
  { key: 'pass', label: '通过', color: '#22c55e' },
  { key: 'refer', label: '转诊', color: '#ef4444' },
  { key: 'inconclusive', label: '待定', color: '#f59e0b' },
] as const;

const VISION_SCREENING_PREFIX = 'vision:';

/* ================================================================
   RECORD CARD — displays one exam session
   ================================================================ */

function RecordCard({ record, index, gender, onEdit, onDelete, meta }: {
  record: VisionRecord;
  index: number;
  gender: string;
  onEdit: () => void;
  onDelete: () => void;
  meta?: { hospital?: string; pupil?: string; notes?: string };
}) {
  const hasRefraction = CARD_REFRACTION_ROWS.some((r) => record.data.has(r.od) || record.data.has(r.os));
  const hasAxial = CARD_AXIAL_ROWS.some((r) => record.data.has(r.od) || record.data.has(r.os));
  const fmt = (k: string) => { const val = record.data.get(k); return val != null ? String(val) : ''; };
  const val = (k: string) => record.data.get(k);

  // Reference data for axial section
  const ref = getAxialRef(record.ageMonths, gender);
  const alOD = val('axial-length-right');
  const alOS = val('axial-length-left');
  const kOD = val('corneal-curvature-right');
  const kOS = val('corneal-curvature-left');
  const surplusOD = ref && alOD != null ? +(ref.critical - alOD).toFixed(2) : null;
  const surplusOS = ref && alOS != null ? +(ref.critical - alOS).toFixed(2) : null;

  const renderRows = (rows: typeof CARD_REFRACTION_ROWS) => rows.map((row, i) => {
    const odVal = fmt(row.od), osVal = fmt(row.os);
    if (!odVal && !osVal) return null;
    return (
      <div key={row.label} className="grid grid-cols-[1.2fr_1fr_1fr] items-center text-center py-2 px-4 border-t"
        style={{ borderColor: '#f0f0ec', background: i % 2 === 0 ? S.card : '#fafcfb' }}>
        <span className="text-left text-[13px]" style={{ color: S.sub }}>{row.label}</span>
        <span className="text-[16px] font-bold" style={{ color: odVal ? S.text : '#d4d1cc' }}>{odVal || '—'}</span>
        <span className="text-[16px] font-bold" style={{ color: osVal ? S.text : '#d4d1cc' }}>{osVal || '—'}</span>
      </div>
    );
  }).filter(Boolean);

  // Color for surplus value: green if >= 0.5, orange if 0-0.5, red if < 0
  const surplusColor = (v: number | null) => {
    if (v == null) return '#d4d1cc';
    if (v >= 0.5) return '#22c55e';
    if (v >= 0) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div className={`${S.radius} overflow-hidden mb-4`} style={{ boxShadow: S.shadow }}>
      {/* Header */}
      <div className="px-5 py-3 flex items-center justify-between"
        style={{ background: 'linear-gradient(135deg, #6a82a8, #BDE0F5)' }}>
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white/80 text-[14px] font-bold"
            style={{ background: 'rgba(255,255,255,0.2)' }}>{index + 1}</span>
          <span className="text-[16px] font-semibold text-white">{record.date}</span>
          {meta?.pupil && <span className="text-[12px] px-2 py-0.5 rounded-full bg-white/20 text-white/80">{meta.pupil}</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-[13px] text-white/60">{fmtAge(record.ageMonths)}</span>
            {meta?.hospital && <span className="block text-[12px] text-white/40">{meta.hospital}</span>}
          </div>
          <button onClick={onEdit} title="编辑此记录"
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
            style={{ color: 'rgba(255,255,255,0.6)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            title="删除这条记录"
            aria-label={`delete-vision-record-${record.date}`}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
            style={{ color: 'rgba(255,255,255,0.72)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ background: S.card }}>
        {/* Refraction section */}
        {hasRefraction && (
          <>
            <div className="grid grid-cols-[1.2fr_1fr_1fr] text-center text-[12px] font-medium py-2 px-4"
              style={{ color: S.sub, background: '#f8faf9' }}>
              <span className="text-left">验光单</span>
              <span>OD 右眼</span>
              <span>OS 左眼</span>
            </div>
            {renderRows(CARD_REFRACTION_ROWS)}
          </>
        )}

        {/* Axial section */}
        {hasAxial && (
          <>
            <div className="grid grid-cols-[1.2fr_1fr_1fr] text-center text-[12px] font-medium py-2 px-4 border-t"
              style={{ color: S.sub, background: '#f8faf9', borderColor: '#f1f5f9' }}>
              <span className="text-left">眼轴单</span>
              <span>OD 右眼</span>
              <span>OS 左眼</span>
            </div>
            {renderRows(CARD_AXIAL_ROWS)}

            {/* Reference data rows (only when we have axial length + ref data) */}
            {ref && (alOD != null || alOS != null) && (
              <>
                {/* Peer average */}
                <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center text-center py-2 px-4 border-t"
                  style={{ borderColor: '#f1f5f9', background: '#f0f5f4' }}>
                  <div className="text-left">
                    <span className="text-[12px] font-medium" style={{ color: S.sub }}>同龄均值</span>
                  </div>
                  <div>
                    <span className="text-[14px] font-medium" style={{ color: S.sub }}>{ref.mean.toFixed(2)}</span>
                    {kOD != null && <span className="block text-[12px]" style={{ color: '#b0b5bc' }}>K{ref.kMean.toFixed(2)}</span>}
                  </div>
                  <div>
                    <span className="text-[14px] font-medium" style={{ color: S.sub }}>{ref.mean.toFixed(2)}</span>
                    {kOS != null && <span className="block text-[12px]" style={{ color: '#b0b5bc' }}>K{ref.kMean.toFixed(2)}</span>}
                  </div>
                </div>

                {/* Critical threshold */}
                <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center text-center py-2 px-4 border-t"
                  style={{ borderColor: '#f0f0ec', background: '#fafafa' }}>
                  <div className="text-left">
                    <span className="text-[12px] font-medium" style={{ color: S.sub }}>{Math.round(record.ageMonths / 12)}岁</span>
                    <span className="ml-1 text-[12px]" style={{ color: '#b0b5bc' }}>临界</span>
                  </div>
                  <span className="text-[14px] font-medium" style={{ color: S.sub }}>{ref.critical.toFixed(2)}</span>
                  <span className="text-[14px] font-medium" style={{ color: S.sub }}>{ref.critical.toFixed(2)}</span>
                </div>

                {/* Axial surplus */}
                <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center text-center py-2.5 px-4 border-t"
                  style={{ borderColor: '#f1f5f9', background: '#f8faf8' }}>
                  <div className="text-left">
                    <span className="text-[13px] font-semibold" style={{ color: S.text }}>轴余</span>
                  </div>
                  <span className="text-[16px] font-bold" style={{ color: surplusColor(surplusOD) }}>
                    {surplusOD != null ? surplusOD.toFixed(2) : '—'}
                  </span>
                  <span className="text-[16px] font-bold" style={{ color: surplusColor(surplusOS) }}>
                    {surplusOS != null ? surplusOS.toFixed(2) : '—'}
                  </span>
                </div>
              </>
            )}
          </>
        )}

        {/* Hyperopia reserve */}
        {record.data.has('hyperopia-reserve') && (
          <div className="flex items-center justify-between py-2.5 px-4 border-t" style={{ borderColor: '#f0f0ec' }}>
            <span className="text-[13px]" style={{ color: S.sub }}>远视储备</span>
            <span className="text-[16px] font-bold" style={{ color: S.text }}>{fmt('hyperopia-reserve')} D</span>
          </div>
        )}

        {/* Notes */}
        {meta?.notes && (
          <div className="px-4 py-2.5 border-t text-[13px]" style={{ borderColor: '#f0f0ec', color: S.sub }}>
            <span className="font-medium" style={{ color: S.text }}>备注：</span>{meta.notes}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   SCREENING SECTION — early vision screening (0-36+ months)
   ================================================================ */

function ScreeningSection({ childId, birthDate, ageMonths, screeningRecords, onSave }: {
  childId: string; birthDate: string; ageMonths: number;
  screeningRecords: MedicalEventRow[]; onSave: () => void;
}) {
  const hasHistoricalRecords = screeningRecords.length > 0;
  const isArchiveOnly = ageMonths > EARLY_SCREENING_MAX_AGE_MONTHS;
  const shouldRenderSection = !isArchiveOnly || hasHistoricalRecords;
  const [showForm, setShowForm] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!isArchiveOnly);
  const [formType, setFormType] = useState('eye-checkup');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formResult, setFormResult] = useState('pass');
  const [formHospital, setFormHospital] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const availableTypes = useMemo(
    () => SCREENING_TYPES.filter((t) => ageMonths >= t.minAge && ageMonths <= t.maxAge),
    [ageMonths],
  );

  useEffect(() => {
    setIsExpanded(!isArchiveOnly);
    setShowForm(false);
  }, [childId, isArchiveOnly]);

  const resetForm = () => {
    setFormType('eye-checkup'); setFormDate(new Date().toISOString().slice(0, 10));
    setFormResult('pass'); setFormHospital(''); setFormNotes(''); setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formDate) return;
    const screeningMeta = SCREENING_TYPES.find((t) => t.key === formType);
    const now = isoNow();
    await insertMedicalEvent({
      eventId: ulid(), childId, eventType: 'checkup',
      title: `${screeningMeta?.label ?? formType}检查`,
      eventDate: formDate, endDate: null,
      ageMonths: computeAgeMonthsAt(birthDate, formDate),
      severity: null, result: formResult,
      hospital: formHospital || null, medication: null, dosage: null,
      notes: `${VISION_SCREENING_PREFIX}${formType}${formNotes ? `\n${formNotes}` : ''}`,
      photoPath: null, now,
    });
    resetForm();
    onSave();
  };

  const resultLabel = (r: string | null) => SCREENING_RESULT_OPTIONS.find((o) => o.key === r) ?? { label: r ?? '—', color: S.sub };
  const sorted = [...screeningRecords].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const sectionTitle = isArchiveOnly ? '早期筛查史' : '早期眼科筛查';

  if (!shouldRenderSection) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold" style={{ color: S.text }}>{sectionTitle}</h2>
          {isArchiveOnly && hasHistoricalRecords && (
            <span
              className={`px-2 py-0.5 text-[12px] font-medium ${S.radiusSm}`}
              style={{ background: '#f0f5f4', color: S.sub }}
            >
              {sorted.length} 条
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isArchiveOnly && hasHistoricalRecords && (
            <button
              onClick={() => setIsExpanded((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ${S.radiusSm} transition-all`}
              style={{ background: '#f5f3ef', color: S.sub }}
            >
              {isExpanded ? '收起' : '展开'}
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          )}
          {!isArchiveOnly && !showForm && (
            <button onClick={() => setShowForm(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90`}
              style={{ background: S.accent }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              添加筛查
            </button>
          )}
        </div>
      </div>

      {isArchiveOnly && isExpanded && (
        <div
          className={`${S.radiusSm} px-4 py-3 mb-3 text-[13px]`}
          style={{ background: '#f8faf9', color: S.sub, border: `1px solid ${S.border}` }}
        >
          已进入学龄阶段，当前重点请结合下方的检查记录、眼轴和趋势变化继续跟踪。
        </div>
      )}

      {isExpanded && (
        <>
          {/* Add screening form — modal */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => resetForm()}>
            <div className={`w-[560px] max-h-[85vh] overflow-y-auto ${S.radius} p-5 shadow-xl`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[16px] font-semibold" style={{ color: S.text }}>添加筛查记录</h3>
                <button onClick={resetForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
              </div>

              {/* Screening type selector */}
              <p className="text-[13px] mb-2" style={{ color: S.sub }}>筛查项目</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {availableTypes.map((t) => (
                  <button key={t.key} onClick={() => setFormType(t.key)}
                    className={`flex items-center gap-1 px-3 py-1.5 text-[13px] ${S.radiusSm} transition-all`}
                    style={formType === t.key
                      ? { background: S.accent, color: '#fff' }
                      : { background: '#f5f3ef', color: S.sub }}>
                    <span>{t.emoji}</span> {t.label}
                  </button>
                ))}
              </div>

              {/* Result selector */}
              <p className="text-[13px] mb-2" style={{ color: S.sub }}>检查结果</p>
              <div className="flex gap-1.5 mb-4">
                {SCREENING_RESULT_OPTIONS.map((r) => (
                  <button key={r.key} onClick={() => setFormResult(r.key)}
                    className={`px-3 py-1.5 text-[13px] ${S.radiusSm} transition-all font-medium`}
                    style={formResult === r.key
                      ? { background: r.color, color: '#fff' }
                      : { background: '#f5f3ef', color: S.sub }}>
                    {r.label}
                  </button>
                ))}
              </div>

              {/* Date + hospital */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-[13px] mb-1" style={{ color: S.sub }}>日期</p>
                  <ProfileDatePicker value={formDate} onChange={setFormDate} style={{ background: '#f5f3ef', color: S.text }} />
                </div>
                <div>
                  <p className="text-[13px] mb-1" style={{ color: S.sub }}>医院/诊所</p>
                  <input type="text" value={formHospital} onChange={(e) => setFormHospital(e.target.value)}
                    placeholder="选填" className={`w-full px-3 py-2 text-[14px] ${S.radiusSm} border-0 outline-none`}
                    style={{ background: '#f5f3ef', color: S.text }} />
                </div>
              </div>

              {/* Notes */}
              <div className="mb-4">
                <p className="text-[13px] mb-1" style={{ color: S.sub }}>备注</p>
                <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="选填" className={`w-full px-3 py-2 text-[14px] ${S.radiusSm} border-0 outline-none`}
                  style={{ background: '#f5f3ef', color: S.text }} />
              </div>

              {/* Submit */}
              <div className="flex gap-2">
                <button onClick={handleSubmit}
                  className={`px-5 py-2 text-[14px] font-medium text-white ${S.radiusSm} hover:opacity-90 transition-all`}
                  style={{ background: S.accent }}>保存</button>
                <button onClick={resetForm}
                  className={`px-4 py-2 text-[14px] ${S.radiusSm} transition-all`}
                  style={{ background: '#f5f3ef', color: S.sub }}>取消</button>
              </div>
            </div>
            </div>
          )}

          {/* Screening record list */}
          {sorted.length > 0 ? (
            <div className="space-y-2">
              {sorted.map((rec) => {
                const screeningKey = rec.notes?.startsWith(VISION_SCREENING_PREFIX)
                  ? rec.notes.split('\n')[0]!.slice(VISION_SCREENING_PREFIX.length)
                  : null;
                const meta = screeningKey ? SCREENING_TYPES.find((t) => t.key === screeningKey) : null;
                const rl = resultLabel(rec.result);
                const userNotes = rec.notes?.includes('\n') ? rec.notes.split('\n').slice(1).join('\n') : null;
                return (
                  <div key={rec.eventId} className={`${S.radiusSm} px-4 py-3 flex items-center justify-between`}
                    style={{ background: S.card, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                    <div className="flex items-center gap-2.5">
                      <span className="text-[16px]">{meta?.emoji ?? '🩺'}</span>
                      <div>
                        <span className="text-[14px] font-medium" style={{ color: S.text }}>{rec.title}</span>
                        <span className="block text-[12px]" style={{ color: S.sub }}>
                          {rec.eventDate.replace(/-/g, '/')} · {Math.floor(rec.ageMonths / 12)}岁{rec.ageMonths % 12}月
                          {rec.hospital ? ` · ${rec.hospital}` : ''}
                        </span>
                        {userNotes && <span className="block text-[12px] mt-0.5" style={{ color: S.sub }}>{userNotes}</span>}
                      </div>
                    </div>
                    <span className={`px-2.5 py-0.5 text-[12px] font-semibold ${S.radiusSm}`}
                      style={{ background: `${rl.color}18`, color: rl.color }}>
                      {rl.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : !showForm && (
            <div className={`${S.radiusSm} p-5 text-center`} style={{ background: S.card, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
              <p className="text-[14px]" style={{ color: S.sub }}>暂无筛查记录</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function VisionPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [medicalEvents, setMedicalEvents] = useState<MedicalEventRow[]>([]);
  const [chartType, setChartType] = useState<GrowthTypeId>('axial-length-right');
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VisionRecord | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrDraft, setOCRDraft] = useState<OCRMeasurementCandidate[] | null>(null);
  const [ocrError, setOCRError] = useState<string | null>(null);
  const ocrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setMeasurements).catch(catchLog('vision', 'action:load-measurements-failed'));
    getMedicalEvents(activeChildId).then(setMedicalEvents).catch(catchLog('vision', 'action:load-medical-events-failed'));
  }, [activeChildId]);

  const records = useMemo(() => groupByDate(measurements), [measurements]);
  const reload = () => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setMeasurements).catch(catchLog('vision', 'action:load-measurements-failed'));
    getMedicalEvents(activeChildId).then(setMedicalEvents).catch(catchLog('vision', 'action:load-medical-events-failed'));
  };

  const handleDeleteRecord = async (record: VisionRecord) => {
    const confirmed = window.confirm(`确认删除 ${record.date} 的检查记录吗？`);
    if (!confirmed) return;
    await Promise.all(
      [...record.measurementsByType.values()].map((measurement) => deleteMeasurement(measurement.measurementId)),
    );
    reload();
  };

  // Filter medical events to vision screenings only (notes starts with "vision:")
  const screeningRecords = useMemo(
    () => medicalEvents.filter((e) => e.notes?.startsWith(VISION_SCREENING_PREFIX)),
    [medicalEvents],
  );

  const typeInfo = GROWTH_STANDARDS.find((s) => s.typeId === chartType);
  const chartData = measurements
    .filter((m) => m.typeId === chartType)
    .sort((a, b) => a.ageMonths - b.ageMonths)
    .map((m) => ({ age: m.ageMonths, value: m.value, date: m.measuredAt.split('T')[0] }));

  const latestMemo = useMemo(() => {
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

  if (!child) return <div className="flex items-center justify-center h-full" style={{ color: S.sub }}>请先添加孩子档案</div>;

  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const latestMeasurements = latestMemo;

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
        setOCRError('未识别到可导入的视力/眼轴数据，请确认图片清晰且为验光单或眼轴单。');
        return;
      }

      setEditingRecord(null);
      setOCRDraft(eyeMeasurements);
      setShowForm(true);
    } catch (error) {
      setOCRError(error instanceof Error ? error.message : '智能识别失败，请重试。');
    } finally {
      setOcrScanning(false);
      if (ocrInputRef.current) {
        ocrInputRef.current.value = '';
      }
    }
  };

  // Latest values for AI context
  const latest = latestMeasurements;

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[14px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold" style={{ color: S.text }}>视力档案</h1>
          {/* Info icon with sources tooltip */}
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help transition-colors hover:bg-[#f0f0ec]" style={{ color: S.sub }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[340px] rounded-xl p-4 text-[13px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
              style={{ background: '#1e293b', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              <p className="text-[14px] font-semibold text-white mb-2.5">数据参考文献</p>
              <ul className="space-y-2.5">
                <li>
                  <span className="text-[#4ECCA3] font-medium">眼轴 P50/P75 百分位（分性别 · 4-18岁）</span>
                  <span className="block text-[12px] text-[#a0a8b4] mt-0.5">He X, Sankaridurg P, Naduvilath T, et al. Normative data and percentile curves for axial length and axial length/corneal curvature in Chinese children and adolescents aged 4-18 years.</span>
                  <span className="block text-[12px] text-[#7a8090]">Br J Ophthalmol 2023;107:167-175</span>
                  <span className="block text-[12px] text-[#606878]">DOI: 10.1136/bjophthalmol-2021-319431 · 样本: 14,127名 · STAR研究等3项队列</span>
                </li>
                <li>
                  <span className="text-[#4ECCA3] font-medium">远视储备 · 角膜曲率参考区间（6-15岁）</span>
                  <span className="block text-[12px] text-[#a0a8b4] mt-0.5">中华预防医学会公共卫生眼科分会. 中国学龄儿童眼球远视储备、眼轴长度、角膜曲率参考区间及相关遗传因素专家共识（2022年）.</span>
                  <span className="block text-[12px] text-[#7a8090]">中华眼科杂志 2022;58(2):96-102</span>
                  <span className="block text-[12px] text-[#606878]">DOI: 10.3760/cma.j.cn112142-20210603-00267 · 安阳/山东/甘肃调查</span>
                </li>
                <li>
                  <span className="text-[#4ECCA3] font-medium">眼轴防控应用共识</span>
                  <span className="block text-[12px] text-[#a0a8b4] mt-0.5">中华医学会眼科学分会眼视光学组. 眼轴长度在近视防控管理中的应用专家共识（2023）.</span>
                  <span className="block text-[12px] text-[#7a8090]">中华实验眼科杂志 2024;42(1):1-8</span>
                </li>
                <li>
                  <span className="text-[#4ECCA3] font-medium">近视防控技术指南</span>
                  <span className="block text-[12px] text-[#a0a8b4] mt-0.5">国家卫生健康委员会. 儿童青少年近视防控适宜技术指南（更新版）. 2023</span>
                </li>
              </ul>
              <p className="text-[12px] mt-2.5 pt-2 border-t border-white/10 text-[#808890]">P50 = 同龄同性别中位数 · P75 = 第75百分位（临界值） · 轴余 = P75 − 当前眼轴 · 覆盖: 4-18岁男/女</p>
            </div>
          </div>
        </div>
        {/* Quantitative data buttons — only for 3+ years */}
        {ageMonths >= 36 && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowGuide(!showGuide)}
              className={`flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium ${S.radiusSm} transition-all`}
              style={showGuide ? { background: S.accent, color: '#fff' } : { background: '#f0f0ec', color: S.sub }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              录入指引
            </button>
            <button onClick={() => ocrInputRef.current?.click()} disabled={ocrScanning}
              className={`group relative flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium ${S.radiusSm} transition-all hover:opacity-90 disabled:opacity-50`}
              style={{ background: '#BDE0F5', color: '#fff' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h4M7 12h10M7 16h6" />
              </svg>
              {ocrScanning ? '识别中...' : '智能识别'}
              <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-normal text-white opacity-0 group-hover:opacity-100 z-50"
                style={{ background: '#1e293b' }}>上传验光单/眼轴单自动识别</span>
            </button>
            {!showForm && (
              <button onClick={openManualForm}
                className={`flex items-center gap-1.5 px-4 py-2 text-[14px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90`}
                style={{ background: S.accent }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                录入数据
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${fmtAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>

      {/* ── Interactive guide ────────────────────────────────── */}
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
          className={`${S.radiusSm} px-4 py-3 mb-5 text-[14px]`}
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}
          data-testid="vision-ocr-error"
        >
          {ocrError}
        </div>
      )}

      {showGuide && <VisionGuide onClose={() => setShowGuide(false)} />}

      {/* Outdoor-activity cross-link — myopia prevention context */}
      <OutdoorSummaryCard childId={child.childId} />

      {/* AI Summary */}
      <AISummaryCard domain="vision" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={(() => {
          const lines: string[] = [];
          const vl = latest.get('vision-left'), vr = latest.get('vision-right');
          if (vl) lines.push(`左眼视力: ${vl.value}`); if (vr) lines.push(`右眼视力: ${vr.value}`);
          const al = latest.get('axial-length-left'), ar = latest.get('axial-length-right');
          if (al) lines.push(`左眼眼轴: ${al.value}mm`); if (ar) lines.push(`右眼眼轴: ${ar.value}mm`);
          return lines.join('\n');
        })()} />

      {/* ── Early vision screening section ──────────────────── */}
      <ScreeningSection childId={child.childId} birthDate={child.birthDate}
        ageMonths={ageMonths} screeningRecords={screeningRecords} onSave={reload} />

      {/* ── Batch input form (quantitative, 3+ years) ────────── */}
      {ageMonths >= 36 && showForm && (
        <BatchForm childId={child.childId} birthDate={child.birthDate} onSave={reload}
          onClose={() => {
            setShowForm(false);
            setEditingRecord(null);
            setOCRDraft(null);
            setOCRError(null);
          }}
          ocrDraft={ocrDraft}
          initialRecord={editingRecord ?? undefined} />
      )}

      {/* ── Exam record cards (quantitative) ─────────────────── */}
      {records.length > 0 ? (
        <div className="mb-6">
          <h2 className="text-[14px] font-semibold mb-3" style={{ color: S.text }}>检查记录（{records.length} 次）</h2>
          {records.map((rec, i) => <RecordCard key={rec.date} record={rec} index={records.length - 1 - i} gender={child.gender}
            onEdit={() => {
              setOCRDraft(null);
              setOCRError(null);
              setEditingRecord(rec);
              setShowForm(true);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onDelete={() => {
              void handleDeleteRecord(rec);
            }} />)}
        </div>
      ) : ageMonths >= 36 && !showForm && (
        <div className={`${S.radius} p-8 text-center mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: '#f5f3ef' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c0bdb8" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" /><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            </svg>
          </div>
          <p className="text-[14px] font-medium" style={{ color: S.text }}>还没有视力检查记录</p>
          <p className="text-[13px] mt-1" style={{ color: S.sub }}>点击上方按钮录入第一次检查数据</p>
        </div>
      )}

      {/* ── Trend chart ──────────────────────────────────────── */}
      {records.length > 0 && (
        <div className={`${S.radius} p-4 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-semibold" style={{ color: S.text }}>趋势曲线</h3>
            <AppSelect value={chartType} onChange={(v) => setChartType(v as GrowthTypeId)}
              options={CHART_OPTIONS.map((o) => ({ value: o.typeId, label: o.label }))} />
          </div>
          {chartData.length === 0 ? (
            <div className="p-8 text-center">
              <span className="text-[24px]">👁️</span>
              <p className="text-[14px] mt-2 font-medium" style={{ color: S.text }}>还没有{typeInfo?.displayName ?? chartType}记录</p>
              <p className="text-[13px] mt-1" style={{ color: S.sub }}>点击右上角添加第一条记录</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="age" tick={{ fontSize: 10 }}
                  label={{ value: '月龄', position: 'insideBottom', offset: -4, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }}
                  label={{ value: typeInfo?.unit ?? '', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [`${v} ${typeInfo?.unit ?? ''}`, typeInfo?.displayName]}
                  labelFormatter={(a) => `${a} 个月`} />
                <Line type="monotone" dataKey="value" stroke={S.accent} strokeWidth={2} dot={{ r: 3, fill: S.accent }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}
