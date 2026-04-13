import { useEffect, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { S, selectStyle } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeAgeMonths, computeAgeMonthsAt, formatAge, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements, insertMeasurement, updateMeasurement, deleteMeasurement } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { canRenderWHOLMS, loadWHOLMS, GROWTH_STANDARD_LABELS, type WHOLMSDataset, type GrowthStandard } from './who-lms-loader.js';
import { AISummaryCard } from './ai-summary-card.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import {
  analyzeCheckupSheetOCR,
  hasCheckupOCRRuntime,
  readImageFileAsDataUrl,
  type OCRImportTypeId,
  type OCRMeasurementCandidate,
} from './checkup-ocr.js';

const TYPE_COLORS: Record<string, string> = {
  height: '#6366f1',
  weight: '#10b981',
  'head-circumference': '#f59e0b',
};

const TYPE_GROUPS: Array<{ label: string; typeIds: string[] }> = [
  {
    label: '生长发育',
    typeIds: ['height', 'weight', 'head-circumference', 'bmi'],
  },
];

/* ── Metric card definitions ──────────────────────────────── */

const METRIC_CARDS: Array<{ typeId: GrowthTypeId; emoji: string; label: string; unit: string; maxAgeMonths?: number; minAgeMonths?: number }> = [
  { typeId: 'height', emoji: '📏', label: '身高', unit: 'cm' },
  { typeId: 'weight', emoji: '⚖️', label: '体重', unit: 'kg' },
  { typeId: 'head-circumference', emoji: '📐', label: '头围', unit: 'cm', maxAgeMonths: 72 },
  { typeId: 'bmi', emoji: '🏃', label: 'BMI', unit: 'kg/m²', minAgeMonths: 24 },
];

/* Other metrics kept in dropdown */
const OTHER_TYPE_IDS = [] as const;
const CARD_TYPE_IDS = new Set(METRIC_CARDS.map((c) => c.typeId));

function computeBMI(heightCm: number, weightKg: number): number {
  const hm = heightCm / 100;
  return Math.round((weightKg / (hm * hm)) * 10) / 10;
}

function bmiLabel(bmi: number): { tag: string; color: string } {
  if (bmi < 14) return { tag: '🔵 偏轻', color: '#3b82f6' };
  if (bmi < 18.5) return { tag: '🟢 正常', color: '#22c55e' };
  if (bmi < 24) return { tag: '🟡 偏重', color: '#eab308' };
  return { tag: '🔴 肥胖', color: '#ef4444' };
}

function fmtMeasDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return '今天记录';
  if (diffDays === 1) return '昨天记录';
  if (diffDays < 7) return `${diffDays}天前记录`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周前记录`;
  if (diffDays < 365) return `${d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} 记录`;
  return `${d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })} 记录`;
}

function getLatestMeasurement(measurements: MeasurementRow[], typeId: string): MeasurementRow | undefined {
  let best: MeasurementRow | undefined;
  for (const m of measurements) {
    if (m.typeId === typeId && (!best || m.measuredAt > best.measuredAt)) best = m;
  }
  return best;
}

function getPreviousMeasurement(measurements: MeasurementRow[], typeId: string): MeasurementRow | undefined {
  const sorted = measurements.filter((m) => m.typeId === typeId).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  return sorted[1]; // second most recent
}

interface MergedPoint {
  age: number;
  value?: number;
  date?: string;
  p3?: number; p10?: number; p25?: number; p50?: number; p75?: number; p90?: number; p97?: number;
}

function buildMergedChartData(
  userData: Array<{ age: number; value: number; date?: string }>,
  refDataset: WHOLMSDataset | null,
): MergedPoint[] {
  if (!refDataset) return userData;

  const refByAge = new Map<number, Record<string, number>>();
  for (const line of refDataset.lines) {
    for (const pt of line.points) {
      const key = Math.round(pt.ageMonths * 100) / 100;
      const entry = refByAge.get(key) ?? {};
      entry[`p${line.percentile}`] = pt.value;
      refByAge.set(key, entry);
    }
  }

  const userAges = new Set(userData.map((d) => d.age));
  const minAge = userData.length > 0 ? Math.min(...userData.map((d) => d.age)) : 0;
  const maxAge = userData.length > 0 ? Math.max(...userData.map((d) => d.age)) : 0;

  const allAges = new Set<number>();
  for (const age of userAges) allAges.add(age);
  for (const age of refByAge.keys()) {
    if (age >= minAge - 12 && age <= maxAge + 12 && Number.isInteger(age)) allAges.add(age);
  }

  const sorted = [...allAges].sort((a, b) => a - b);
  const userMap = new Map(userData.map((d) => [d.age, d]));

  return sorted.map((age) => {
    const u = userMap.get(age);
    const w = refByAge.get(age) ?? {};
    return {
      age, value: u?.value, date: u?.date,
      p3: w.p3, p10: w.p10, p25: w.p25, p50: w.p50, p75: w.p75, p90: w.p90, p97: w.p97,
    };
  });
}

function getPercentileHint(value: number, refs: { p3?: number; p10?: number; p25?: number; p50?: number; p75?: number; p90?: number; p97?: number }) {
  if (refs.p97 != null && value >= refs.p97) return { text: '超过同龄 97% 的孩子（偏高）', color: '#f59e0b' };
  if (refs.p90 != null && value >= refs.p90) return { text: '超过同龄 90% 的孩子', color: '#22c55e' };
  if (refs.p75 != null && value >= refs.p75) return { text: '超过同龄 75% 的孩子', color: '#22c55e' };
  if (refs.p50 != null && value >= refs.p50) return { text: '处于同龄中等偏上水平', color: '#22c55e' };
  if (refs.p25 != null && value >= refs.p25) return { text: '处于同龄平均水平', color: '#8a8f9a' };
  if (refs.p10 != null && value >= refs.p10) return { text: '偏低，建议关注', color: '#f59e0b' };
  if (refs.p3 != null && value >= refs.p3) return { text: '明显偏低，建议咨询专业人士', color: '#ef4444' };
  if (refs.p3 != null) return { text: '低于同龄 97% 的孩子，建议就医评估', color: '#ef4444' };
  return null;
}

function computeChartYDomain(merged: MergedPoint[], selectedType: string): [number, number] {
  const vals: number[] = [];
  for (const pt of merged) {
    if (pt.value != null) vals.push(pt.value);
    if (pt.p3 != null) vals.push(pt.p3);
    if (pt.p97 != null) vals.push(pt.p97);
  }
  if (vals.length === 0) return [0, 100];
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const pad = (max - min) * 0.1 || 5;
  min = min - pad;
  max = max + pad;
  // Round to clean numbers based on metric
  const step = selectedType === 'weight' ? 2 : selectedType === 'bmi' ? 1 : 5;
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;
  if (min < 0) min = 0;
  return [min, max];
}

function computeApproxPercentile(value: number, ageMonths: number, whoDataset: WHOLMSDataset | null): number | null {
  if (!whoDataset) return null;
  if (ageMonths < whoDataset.coverage.startAgeMonths || ageMonths > whoDataset.coverage.endAgeMonths) return null;

  // Get WHO values at this age by finding nearest points
  const pValues: Array<{ percentile: number; value: number }> = [];
  for (const line of whoDataset.lines) {
    // Find two bracketing points and interpolate
    let lo: { ageMonths: number; value: number } | null = null;
    let hi: { ageMonths: number; value: number } | null = null;
    for (const pt of line.points) {
      if (pt.ageMonths <= ageMonths) lo = pt;
      if (pt.ageMonths >= ageMonths && !hi) hi = pt;
    }
    if (!lo && !hi) continue;
    let v: number;
    if (!lo) v = hi!.value;
    else if (!hi) v = lo.value;
    else if (lo.ageMonths === hi.ageMonths) v = lo.value;
    else v = lo.value + (hi.value - lo.value) * (ageMonths - lo.ageMonths) / (hi.ageMonths - lo.ageMonths);
    pValues.push({ percentile: line.percentile, value: v });
  }
  if (pValues.length === 0) return null;

  // Sort by percentile ascending
  pValues.sort((a, b) => a.percentile - b.percentile);

  // If below lowest or above highest
  if (value <= pValues[0]!.value) return pValues[0]!.percentile;
  if (value >= pValues[pValues.length - 1]!.value) return pValues[pValues.length - 1]!.percentile;

  // Interpolate between bracketing percentiles
  for (let i = 0; i < pValues.length - 1; i++) {
    const lo = pValues[i]!;
    const hi = pValues[i + 1]!;
    if (value >= lo.value && value <= hi.value) {
      const frac = (value - lo.value) / (hi.value - lo.value);
      return Math.round(lo.percentile + frac * (hi.percentile - lo.percentile));
    }
  }
  return null;
}

function formatAgeLabel(age: number): string {
  if (age >= 24) {
    const y = Math.floor(age / 12);
    const m = age % 12;
    return m > 0 ? `${y}岁${m}个月` : `${y}岁`;
  }
  return `${age}个月`;
}

/* ── Add-Record Modal ── */

function AddRecordModal({ formDate, setFormDate, formHeight, setFormHeight, formWeight, setFormWeight,
  formHeadCirc, setFormHeadCirc, formNotes, setFormNotes, formPhotoPreview, isUnder6,
  onPhotoChange, onSave, onClose,
}: {
  formDate: string; setFormDate: (v: string) => void;
  formHeight: string; setFormHeight: (v: string) => void;
  formWeight: string; setFormWeight: (v: string) => void;
  formHeadCirc: string; setFormHeadCirc: (v: string) => void;
  formNotes: string; setFormNotes: (v: string) => void;
  formPhotoPreview: string | null;
  isUnder6: boolean;
  onPhotoChange: (f: File | null) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const dropActive = dragOver || dropHover;

  const h = formHeight ? parseFloat(formHeight) : NaN;
  const w = formWeight ? parseFloat(formWeight) : NaN;
  const hasBMI = h > 0 && w > 0;
  const bmi = hasBMI ? computeBMI(h, w) : null;
  const bmiMeta = bmi != null ? bmiLabel(bmi) : null;

  const inputCls = `w-full ${S.radiusSm} px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50`;
  const inputSty = { borderColor: S.border, borderWidth: 1, borderStyle: 'solid' as const, background: '#fafaf8' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
    <div className={`w-[440px] max-h-[85vh] overflow-y-auto ${S.radius} shadow-xl flex flex-col`} style={{ background: S.card }} onClick={(e) => e.stopPropagation()}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-[20px]">📏</span>
          <h3 className="text-[15px] font-bold" style={{ color: S.text }}>添加记录</h3>
        </div>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
      </div>

      <div className="px-6 pb-2 space-y-4 flex-1">

        {/* ── 1. Date (full width) ── */}
        <div>
          <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>测量日期</label>
          <ProfileDatePicker value={formDate} onChange={setFormDate} className={inputCls} style={inputSty} />
        </div>

        {/* ── 2. Core metrics row ── */}
        <div className={`grid gap-3 ${isUnder6 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>身高 (cm)</label>
            <input type="number" step="0.1" placeholder="120.5" value={formHeight}
              onChange={(e) => setFormHeight(e.target.value)} className={inputCls} style={inputSty} />
          </div>
          <div>
            <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>体重 (kg)</label>
            <input type="number" step="0.01" placeholder="22.5" value={formWeight}
              onChange={(e) => setFormWeight(e.target.value)} className={inputCls} style={inputSty} />
          </div>
          {isUnder6 && (
            <div>
              <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>头围 (cm)</label>
              <input type="number" step="0.1" placeholder="48.0" value={formHeadCirc}
                onChange={(e) => setFormHeadCirc(e.target.value)} className={inputCls} style={inputSty} />
            </div>
          )}
        </div>

        {/* ── BMI auto-compute ── */}
        <div className={`${S.radiusSm} px-3 py-2 flex items-center gap-2`}
          style={{ background: hasBMI ? '#f0fdf4' : '#fafaf8', border: `1px solid ${hasBMI ? '#bbf7d0' : S.border}`, transition: 'all 0.2s' }}>
          <span className="text-[11px] font-medium" style={{ color: S.sub }}>BMI 自动计算</span>
          {hasBMI && bmi != null && bmiMeta ? (
            <>
              <span className="text-[14px] font-bold ml-auto" style={{ color: bmiMeta.color }}>{bmi}</span>
              <span className="text-[11px] font-medium" style={{ color: bmiMeta.color }}>{bmiMeta.tag}</span>
            </>
          ) : (
            <span className="text-[13px] ml-auto" style={{ color: '#c4c4c4' }}>--</span>
          )}
        </div>

        {/* ── 3. Notes ── */}
        <div>
          <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>备注</label>
          <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
            placeholder="记录一些观察..."
            className={`${inputCls} resize-none`}
            rows={2}
            style={inputSty} />
        </div>

        {/* ── 4. Photo dropzone ── */}
        <div>
          <label className="text-[11px] mb-1 block font-medium" style={{ color: S.sub }}>照片</label>
          <input ref={photoRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { onPhotoChange(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          {formPhotoPreview ? (
            <div className="relative group">
              <img src={formPhotoPreview} alt="preview"
                className={`w-full h-28 object-cover ${S.radiusSm}`} />
              <button onClick={() => onPhotoChange(null)}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/50 text-white text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => photoRef.current?.click()}
              onMouseEnter={() => setDropHover(true)}
              onMouseLeave={() => setDropHover(false)}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file?.type.startsWith('image/')) onPhotoChange(file);
              }}
              className={`w-full h-24 ${S.radiusSm} flex flex-col items-center justify-center gap-1.5 cursor-pointer`}
              style={{
                border: `2px dashed ${dropActive ? '#c8e64a' : '#d0d0cc'}`,
                background: '#fafaf8',
                transition: 'border-color 0.25s ease',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round"
                style={{
                  stroke: dropActive ? '#94A533' : '#b0b0aa',
                  transform: dropActive ? 'scale(1.15)' : 'scale(1)',
                  transition: 'stroke 0.25s ease, transform 0.25s ease',
                }}>
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="text-[11px]" style={{
                color: dropActive ? '#94A533' : '#a0a0a0',
                transition: 'color 0.25s ease',
              }}>
                点击或拖拽上传照片
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ── Footer actions ── */}
      <div className="px-6 pt-3 pb-5 mt-1">
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose}
            className={`px-4 py-2 text-[13px] ${S.radiusSm} transition-colors hover:bg-[#e8e8e4]`}
            style={{ background: '#f0f0ec', color: S.sub }}>
            取消
          </button>
          <button onClick={onSave}
            className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} transition-colors hover:brightness-110`}
            style={{ background: S.accent }}>
            保存
          </button>
        </div>
      </div>

    </div>
    </div>
  );
}

export default function GrowthCurvePage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<string>('height');
  const [showForm, setShowForm] = useState(false);
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formHeight, setFormHeight] = useState('');
  const [formWeight, setFormWeight] = useState('');
  const [formHeadCirc, setFormHeadCirc] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPhotoPreview, setFormPhotoPreview] = useState<string | null>(null);
  const [growthStandard, setGrowthStandard] = useState<GrowthStandard>('china');
  const [whoDataset, setWhoDataset] = useState<WHOLMSDataset | null>(null);
  const [showOCR, setShowOCR] = useState(false);
  const [ocrRuntimeAvailable, setOCRRuntimeAvailable] = useState<boolean | null>(null);
  const [ocrImageName, setOCRImageName] = useState<string | null>(null);
  const [ocrImageDataUrl, setOCRImageDataUrl] = useState<string | null>(null);
  const [ocrStatus, setOCRStatus] = useState<'idle' | 'analyzing' | 'review'>('idle');
  const [ocrError, setOCRError] = useState<string | null>(null);
  const [ocrCandidates, setOCRCandidates] = useState<Array<OCRMeasurementCandidate & { selected: boolean }>>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteMeasurement = async (measurementId: string) => {
    try {
      await deleteMeasurement(measurementId);
      setMeasurements(await getMeasurements(child!.childId));
    } catch { /* bridge unavailable */ }
    setDeletingId(null);
  };

  const handleEditMeasurement = (m: MeasurementRow) => {
    setEditingId(m.measurementId);
    setEditValue(String(m.value));
    setEditDate(m.measuredAt.split('T')[0]!);
  };

  const handleSaveEdit = async (m: MeasurementRow) => {
    const v = parseFloat(editValue);
    if (isNaN(v)) return;
    const age = computeAgeMonthsAt(child!.birthDate, editDate);
    try {
      await updateMeasurement({
        measurementId: m.measurementId,
        value: v,
        measuredAt: editDate,
        ageMonths: age,
        percentile: m.percentile,
        source: m.source,
        notes: m.notes,
        now: isoNow(),
      });
      setMeasurements(await getMeasurements(child!.childId));
      setEditingId(null);
    } catch { /* bridge unavailable */ }
  };

  useEffect(() => {
    if (!activeChildId) {
      return;
    }

    getMeasurements(activeChildId).then(setMeasurements).catch(catchLog('growth-curve', 'action:load-measurements-failed'));
  }, [activeChildId]);

  useEffect(() => {
    hasCheckupOCRRuntime().then(setOCRRuntimeAvailable).catch(catchLogThen('growth-curve', 'action:check-ocr-runtime-failed', () => setOCRRuntimeAvailable(false)));
  }, []);

  useEffect(() => {
    if (!child) {
      setWhoDataset(null);
      return;
    }

    const selectedStandard = GROWTH_STANDARDS.find((standard) => standard.typeId === selectedType);
    if (selectedStandard?.curveType !== 'lms-percentile') {
      setWhoDataset(null);
      return;
    }

    loadWHOLMS(selectedType as GrowthTypeId, child.gender, growthStandard)
      .then(setWhoDataset)
      .catch(catchLogThen('growth-curve', 'action:load-lms-failed', () => setWhoDataset(null)));
  }, [selectedType, child, growthStandard]);

  const latestH = useMemo(() => getLatestMeasurement(measurements, 'height'), [measurements]);
  const latestW = useMemo(() => getLatestMeasurement(measurements, 'weight'), [measurements]);

  if (!child) {
    return <div className="p-8" style={{ color: S.sub }}>Please add a child profile first.</div>;
  }

  const typeInfo = GROWTH_STANDARDS.find((standard) => standard.typeId === selectedType);
  const typeMeasurements = measurements
    .filter((measurement) => measurement.typeId === selectedType)
    .sort((left, right) => left.ageMonths - right.ageMonths);

  const chartData = typeMeasurements.map((measurement) => ({
    age: measurement.ageMonths,
    value: measurement.value,
    date: measurement.measuredAt.split('T')[0],
  }));

  const ageMonths = computeAgeMonths(child.birthDate);
  const isUnder6 = ageMonths <= 72;
  const computedBmi = latestH && latestW ? computeBMI(latestH.value, latestW.value) : null;

  const visibleCards = METRIC_CARDS.filter((c) => {
    if (c.maxAgeMonths != null && ageMonths > c.maxAgeMonths) return false;
    if (c.minAgeMonths != null && ageMonths < c.minAgeMonths) return false;
    return true;
  });

  const handleAddRecord = async () => {
    if (!formDate) return;
    const h = formHeight ? parseFloat(formHeight) : null;
    const w = formWeight ? parseFloat(formWeight) : null;
    const hc = formHeadCirc ? parseFloat(formHeadCirc) : null;
    if (h === null && w === null && hc === null) return;

    const age = computeAgeMonthsAt(child.birthDate, formDate);
    const now = isoNow();
    const photoNote = formPhotoPreview ? `photo:${formPhotoPreview}` : null;
    const notes = [formNotes.trim() || null, photoNote].filter(Boolean).join('\n') || null;

    try {
      if (h != null) await insertMeasurement({ measurementId: ulid(), childId: child.childId, typeId: 'height', value: h, measuredAt: formDate, ageMonths: age, percentile: null, source: 'manual', notes, now });
      if (w != null) await insertMeasurement({ measurementId: ulid(), childId: child.childId, typeId: 'weight', value: w, measuredAt: formDate, ageMonths: age, percentile: null, source: 'manual', notes, now });
      if (hc != null) await insertMeasurement({ measurementId: ulid(), childId: child.childId, typeId: 'head-circumference', value: hc, measuredAt: formDate, ageMonths: age, percentile: null, source: 'manual', notes, now });
      if (h != null && w != null) {
        const bmi = computeBMI(h, w);
        await insertMeasurement({ measurementId: ulid(), childId: child.childId, typeId: 'bmi', value: bmi, measuredAt: formDate, ageMonths: age, percentile: null, source: 'computed', notes: null, now });
      }
      setMeasurements(await getMeasurements(child.childId));
      setShowForm(false);
      setFormHeight(''); setFormWeight(''); setFormHeadCirc(''); setFormNotes(''); setFormPhotoPreview(null);
    } catch { /* bridge unavailable */ }
  };

  const handlePhotoChange = async (file: File | null) => {
    if (!file) { setFormPhotoPreview(null); return; }
    try { setFormPhotoPreview(await readImageFileAsDataUrl(file)); } catch { setFormPhotoPreview(null); }
  };

  const navigateToAI = (m: MeasurementRow) => {
    const ti = GROWTH_STANDARDS.find((s) => s.typeId === m.typeId);
    const topic = `${ti?.displayName ?? m.typeId}数据分析`;
    const lines = [`${child.displayName}，${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`,
      `${ti?.displayName ?? m.typeId}: ${m.value} ${ti?.unit ?? ''}（${m.measuredAt.split('T')[0]}）`];
    if (latestH) lines.push(`最新身高: ${latestH.value} cm`);
    if (latestW) lines.push(`最新体重: ${latestW.value} kg`);
    const desc = lines.join('\\n');
    navigate(`/advisor?topic=${encodeURIComponent(topic)}&desc=${encodeURIComponent(desc)}`);
  };

  const resetOCRDraft = () => {
    setOCRImageName(null);
    setOCRImageDataUrl(null);
    setOCRStatus('idle');
    setOCRCandidates([]);
    setOCRError(null);
  };

  const handleOCRFileChange = async (file: File | null) => {
    if (!file) {
      resetOCRDraft();
      return;
    }

    setOCRError(null);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setOCRImageName(file.name);
      setOCRImageDataUrl(dataUrl);
      setOCRStatus('idle');
      setOCRCandidates([]);
    } catch {
      resetOCRDraft();
      setOCRError('无法读取体检单图片，请重新选择。');
    }
  };

  const handleOCRAnalyze = async () => {
    if (!ocrImageDataUrl) {
      return;
    }

    setOCRStatus('analyzing');
    setOCRError(null);
    try {
      const result = await analyzeCheckupSheetOCR({ imageUrl: ocrImageDataUrl });
      setOCRCandidates(result.measurements.map((candidate) => ({ ...candidate, selected: true })));
      setOCRStatus('review');
    } catch {
      setOCRStatus('idle');
      setOCRCandidates([]);
      setOCRError('OCR 提取失败或返回了不合法的结构化结果。');
    }
  };

  const handleImportOCR = async () => {
    const selectedCandidates = ocrCandidates.filter((candidate) => candidate.selected);
    if (selectedCandidates.length === 0) {
      setOCRError('请至少选择一条要导入的测量记录。');
      return;
    }

    const invalidCandidate = selectedCandidates.find((candidate) => {
      return !candidate.measuredAt.trim() || !Number.isFinite(candidate.value);
    });
    if (invalidCandidate) {
      setOCRError('所选 OCR 候选必须包含有效的日期和值。');
      return;
    }

    setOCRError(null);
    try {
      for (const candidate of selectedCandidates) {
        const measuredAt = candidate.measuredAt.trim();
        const now = isoNow();
        await insertMeasurement({
          measurementId: ulid(),
          childId: child.childId,
          typeId: candidate.typeId,
          value: candidate.value,
          measuredAt,
          ageMonths: computeAgeMonthsAt(child.birthDate, measuredAt),
          percentile: null,
          source: 'ocr',
          notes: candidate.notes,
          now,
        });
      }
      setMeasurements(await getMeasurements(child.childId));
      resetOCRDraft();
      setShowOCR(false);
    } catch {
      setOCRError('导入失败，请确认 OCR 候选并重试。');
    }
  };

  const availableTypes = GROWTH_STANDARDS.filter(
    (standard) => ageMonths >= standard.ageRange.startMonths && ageMonths <= standard.ageRange.endMonths,
  );
  const canShowWhoLines = canRenderWHOLMS(whoDataset, ageMonths);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold" style={{ color: S.text }}>生长曲线</h1>
          {/* Info icon with sources tooltip */}
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help transition-colors hover:bg-[#f0f0ec]" style={{ color: S.sub }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[360px] rounded-xl p-4 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
              style={{ background: '#1a2b4a', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              <p className="text-[12px] font-semibold text-white mb-2.5">数据参考文献</p>
              <ul className="space-y-2.5">
                <li>
                  <span className="text-[#c8e64a] font-medium">身高 · 体重 · BMI 百分位曲线（0-5岁）</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">WHO Child Growth Standards (2006). Length/height-for-age, weight-for-age, BMI-for-age.</span>
                  <span className="block text-[10px] text-[#7a8090]">World Health Organization Multicentre Growth Reference Study Group</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">身高 · 体重 · BMI 百分位曲线（5-19岁）</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">WHO Growth References (2007). Height-for-age, weight-for-age, BMI-for-age references for school-age children and adolescents.</span>
                  <span className="block text-[10px] text-[#7a8090]">de Onis M, et al. Bull World Health Organ 2007;85:660-667</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">头围百分位曲线（0-36月）</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">WHO Child Growth Standards (2006). Head circumference-for-age.</span>
                  <span className="block text-[10px] text-[#7a8090]">覆盖: 0-36个月 · 分男/女 · P3-P97 百分位线</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">骨龄评估</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">Greulich-Pyle Atlas / Tanner-Whitehouse 3 (TW3) 骨龄评估标准</span>
                </li>
              </ul>
              <p className="text-[9px] mt-2.5 pt-2 border-t border-white/10 text-[#808890]">百分位线: P3 · P10 · P25 · P50 (中位数) · P75 · P90 · P97 · 低于P3或高于P97建议咨询专业人士</p>
            </div>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button onClick={() => setShowOCR(!showOCR)}
            className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90`}
            style={{ background: showOCR ? S.sub : '#86AFDA', boxShadow: '0 2px 6px rgba(0,0,0,0.1)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h4M7 12h10M7 16h6" />
            </svg>
            {showOCR ? '关闭识别' : '智能识别'}
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-normal text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-50"
              style={{ background: '#1a2b4a' }}>
              拍照/上传体检单，自动识别数据
            </span>
          </button>
          <button onClick={() => setShowForm(true)}
            className={`flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90`}
            style={{ background: S.accent }}>
            + 添加记录
          </button>
        </div>
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${formatAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>
      <AISummaryCard domain="growth" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths/12)}岁${ageMonths%12}个月`} gender={child.gender}
        dataContext={(() => {
          const h = getLatestMeasurement(measurements, 'height');
          const w = getLatestMeasurement(measurements, 'weight');
          const hc = getLatestMeasurement(measurements, 'head-circumference');
          const lines: string[] = [];
          if (h) lines.push(`身高: ${h.value}cm (${h.measuredAt.split('T')[0]})`);
          if (w) lines.push(`体重: ${w.value}kg (${w.measuredAt.split('T')[0]})`);
          if (computedBmi != null) lines.push(`BMI: ${computedBmi}`);
          if (hc) lines.push(`头围: ${hc.value}cm (${hc.measuredAt.split('T')[0]})`);
          lines.push(`共 ${measurements.length} 条测量记录`);
          return lines.length > 1 ? lines.join('\n') : '';
        })()}
      />
      {/* OCR and form sections below */}

      {/* ── Metric cards ──────────────────────────────────────── */}
      <div className={`grid gap-3 mb-4`} style={{ gridTemplateColumns: `repeat(${visibleCards.length}, 1fr)` }}>
        {visibleCards.map((card) => {
          const isActive = selectedType === card.typeId;
          const m = getLatestMeasurement(measurements, card.typeId);
          const prev = getPreviousMeasurement(measurements, card.typeId);
          let displayVal: string;
          let dateLabel: string;
          let delta: number | null = null;
          if (card.typeId === 'bmi') {
            displayVal = computedBmi != null ? `${computedBmi}` : '--';
            const bmiDate = latestH && latestW ? (latestH.measuredAt > latestW.measuredAt ? latestH.measuredAt : latestW.measuredAt) : null;
            dateLabel = bmiDate ? fmtMeasDate(bmiDate) : '暂无数据';
          } else {
            displayVal = m ? `${m.value}` : '--';
            dateLabel = m ? fmtMeasDate(m.measuredAt) : '暂无数据';
            if (m && prev) delta = Math.round((m.value - prev.value) * 10) / 10;
          }
          return (
            <button key={card.typeId} onClick={() => setSelectedType(card.typeId)}
              className={`${S.radiusSm} p-3 text-left transition-all duration-150`}
              style={{
                background: S.card,
                boxShadow: isActive ? `0 0 0 2px ${S.accent}` : S.shadow,
                border: isActive ? 'none' : undefined,
              }}>
              <div className="flex items-start justify-between mb-2">
                <span className="text-[20px]">{card.emoji}</span>
                <span className="text-[10px] font-medium" style={{ color: isActive ? S.accent : S.sub }}>{card.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-[20px] font-bold leading-none" style={{ color: S.text }}>{displayVal}</p>
                {delta != null && (
                  <span className="text-[10px] font-medium" style={{ color: S.sub }}>
                    {delta >= 0 ? '↑' : '↓'}{delta >= 0 ? '+' : ''}{delta}
                  </span>
                )}
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: S.sub }}>{card.unit}</p>
              <p className="text-[9px] mt-1" style={{ color: dateLabel === '暂无数据' ? '#d4d1cc' : S.sub }}>{dateLabel}</p>
            </button>
          );
        })}
      </div>

      {/* ── Stale data reminder ────────────────────────────── */}
      {(() => {
        const allDates = measurements.map((m) => new Date(m.measuredAt).getTime());
        if (allDates.length === 0) return null;
        const latestMs = Math.max(...allDates);
        const daysSince = Math.floor((Date.now() - latestMs) / 86400000);
        if (daysSince <= 90) return null;
        return (
          <div className={`${S.radiusSm} px-3 py-2 mb-4 flex items-center gap-2`}
            style={{ background: '#faf8f0', border: `1px solid #e8e2d0` }}>
            <span className="text-[13px]">📅</span>
            <span className="text-[11px]" style={{ color: '#8a7a5a' }}>
              距离上次测量已过去 {daysSince} 天，建议更新数据
            </span>
          </div>
        );
      })()}

      {/* ── Other metrics dropdown (bone-age, labs, etc.) ──── */}
      {(() => {
        const others = OTHER_TYPE_IDS
          .map((id) => availableTypes.find((s) => s.typeId === id))
          .filter(Boolean);
        if (others.length === 0) return null;
        const isOtherActive = !CARD_TYPE_IDS.has(selectedType as GrowthTypeId);
        return (
          <div className="mb-4">
            <AppSelect
              value={isOtherActive ? selectedType : ''}
              onChange={(v) => { if (v) setSelectedType(v); }}
              placeholder="其他指标..."
              options={others.map((s) => ({ value: s!.typeId, label: `${s!.displayName} (${s!.unit})` }))}
              style={{ color: isOtherActive ? S.text : S.sub }} />
          </div>
        );
      })()}

      {/* ── Standard toggle ── */}
      <div className="flex items-center mb-3">
        <div className="flex items-center gap-1.5 p-0.5 rounded-full" style={{ background: '#f0f0ec' }}>
          {(['china', 'who'] as const).map((std) => {
            const isActive = growthStandard === std;
            const tip = std === 'china'
              ? '0-7岁: WS/T 423-2022《7岁以下儿童生长标准》\n(国家卫健委, 2023年实施, 基于2015年九市调查)\n\n7-18岁: 《中国0-18岁儿童青少年身高体重标准化生长曲线》\n(李辉等, 首都儿科研究所, 2009)'
              : 'WHO Child Growth Standards (2006)\n0-5岁多中心生长参照研究\n\nWHO Growth Reference (2007)\n5-19岁生长参照数据';
            return (
              <div key={std} className="group/std relative flex items-center">
                <button onClick={() => setGrowthStandard(std)}
                  className={`flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-full transition-all duration-200 ${isActive ? 'text-white shadow-sm' : ''}`}
                  style={isActive ? { background: std === 'china' ? '#e25c5c' : '#4a90d9', color: '#fff' } : { color: S.sub }}>
                  {GROWTH_STANDARD_LABELS[std]}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    className="opacity-50"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                </button>
                <div className="pointer-events-none absolute left-0 top-8 z-50 w-[280px] rounded-xl p-3 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover/std:pointer-events-auto group-hover/std:opacity-100 whitespace-pre-line"
                  style={{ background: '#1a2b4a', color: '#e8e5e0', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
                  {tip}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={`${S.radius} p-4 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
        {chartData.length === 0 ? (
          <div className="p-8 text-center">
            <span className="text-[28px]">📏</span>
            <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>还没有{typeInfo?.displayName ?? selectedType}记录</p>
            <p className="text-[11px] mt-1" style={{ color: S.sub }}>点击右上角添加第一条记录</p>
          </div>
        ) : (
          (() => {
            const merged = buildMergedChartData(chartData, canShowWhoLines ? whoDataset : null);
            const ages = merged.map((d) => d.age);
            const minA = Math.min(...ages);
            const maxA = Math.max(...ages);
            const span = maxA - minA;
            const unit = typeInfo?.unit ?? '';
            const yDomain = computeChartYDomain(merged, selectedType);
            return (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={merged} margin={{ top: 5, right: 36, bottom: 20, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0ec" />
                  <XAxis dataKey="age"
                    tickFormatter={(age: number) => {
                      if (span > 48) return age % 12 === 0 ? `${age / 12}岁` : '';
                      if (span > 24) return age % 6 === 0 ? `${Math.floor(age / 12)}岁${age % 12 > 0 ? `${age % 12}月` : ''}` : '';
                      return `${age}月`;
                    }}
                    label={{ value: span > 24 ? '年龄' : '月龄', position: 'insideBottom', offset: -10, style: { fontSize: 11, fill: '#8a8f9a' } }}
                    tick={{ fontSize: 10, fill: '#8a8f9a' }}
                  />
                  <YAxis
                    domain={yDomain}
                    label={{ value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#8a8f9a' } }}
                    tick={{ fontSize: 10, fill: '#8a8f9a' }}
                  />
                  <Tooltip
                    cursor={false}
                    isAnimationActive={false}
                    offset={12}
                    content={({ active, payload, label, coordinate }) => {
                      if (!active || !payload?.length) return null;
                      const userPt = payload.find((p) => p.dataKey === 'value');
                      if (!userPt || userPt.value == null) return null;
                      const age = label as number;
                      const val = userPt.value as number;
                      const d = payload[0]?.payload as MergedPoint | undefined;
                      const hint = d ? getPercentileHint(val, { p3: d.p3, p10: d.p10, p25: d.p25, p50: d.p50, p75: d.p75, p90: d.p90, p97: d.p97 }) : null;
                      return (
                        <div className="rounded-xl p-3 shadow-lg pointer-events-none"
                          style={{ background: '#fff', border: '1px solid #e8e5e0', minWidth: 160 }}>
                          <p className="text-[11px] font-medium" style={{ color: '#8a8f9a' }}>{formatAgeLabel(age)}{d?.date ? ` (${d.date})` : ''}</p>
                          <p className="text-[18px] font-bold mt-1" style={{ color: '#1a2b4a' }}>{val} {unit}</p>
                          {hint && <p className="text-[11px] mt-1.5" style={{ color: hint.color }}>{hint.text}</p>}
                        </div>
                      );
                    }}
                  />

                  {/* 5-line percentile display: P3, P10, P50, P90, P97 — labels at right end */}
                  {[
                    { key: 'p97', label: '97%', w: 1, dash: '4 3', color: growthStandard === 'china' ? '#c4a882' : '#9bb0cc' },
                    { key: 'p90', label: '90%', w: 1.2, dash: '6 3', color: growthStandard === 'china' ? '#d4956a' : '#6a9fd8' },
                    { key: 'p50', label: '50%', w: 1.8, dash: '6 3', color: growthStandard === 'china' ? '#d94040' : '#3a7fd6' },
                    { key: 'p10', label: '10%', w: 1.2, dash: '6 3', color: growthStandard === 'china' ? '#d4956a' : '#6a9fd8' },
                    { key: 'p3', label: '3%', w: 1, dash: '4 3', color: growthStandard === 'china' ? '#c4a882' : '#9bb0cc' },
                  ].map((ln) => (
                    <Line key={ln.key} type="monotone" dataKey={ln.key} stroke={ln.color} strokeWidth={ln.w} strokeDasharray={ln.dash}
                      dot={false} activeDot={false} isAnimationActive={false} connectNulls
                      label={({ x, y, index, value }: { x: number; y: number; index: number; value: unknown }) =>
                        value != null && index === merged.length - 1 ? (
                          <text key={`${ln.key}-lbl`} x={x + 4} y={y} dy={4} fontSize={9} fill={ln.color} fontWeight={ln.key === 'p50' ? 600 : 400}>{ln.label}</text>
                        ) : null
                      } />
                  ))}
                  {/* User measurement line */}
                  <Line type="monotone" dataKey="value" stroke={TYPE_COLORS[selectedType] ?? '#6366f1'} strokeWidth={2.5}
                    dot={(props: Record<string, unknown>) => {
                      const { cx, cy, value: v } = props as { cx: number; cy: number; value: unknown };
                      if (v == null || typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      return <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={TYPE_COLORS[selectedType] ?? '#6366f1'} strokeWidth={2} />;
                    }}
                    activeDot={{ r: 6, strokeWidth: 2.5, fill: '#fff', stroke: TYPE_COLORS[selectedType] ?? '#6366f1' }}
                    connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            );
          })()
        )}
        {/* percentile labels are shown at line ends inside the chart */}
      </div>

      {/* Bone age associated display (height chart only) */}
      {selectedType === 'height' && (() => {
        const boneAgeRecords = measurements.filter((m) => m.typeId === 'bone-age').sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
        const latest = boneAgeRecords[0];
        if (!latest) return null;
        const boneAgeYears = latest.value;
        const actualAgeYears = ageMonths / 12;
        const diff = boneAgeYears - actualAgeYears;
        const absDiff = Math.abs(diff);
        const status = absDiff <= 1 ? { label: '正常范围', color: '#22c55e', bg: '#f0fdf4' }
          : diff > 1 ? { label: `偏早 ${absDiff.toFixed(1)} 年`, color: '#f59e0b', bg: '#fffbeb' }
          : { label: `偏晚 ${absDiff.toFixed(1)} 年`, color: '#3b82f6', bg: '#eff6ff' };
        const actualAgeStr = `${Math.floor(ageMonths / 12)} 岁 ${ageMonths % 12} 月`;
        return (
          <div className={`${S.radius} p-4 mb-4 flex items-start gap-3`} style={{ background: status.bg, border: `1px solid ${status.color}30` }}>
            <span className="text-[20px] mt-0.5">🦴</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold" style={{ color: S.text }}>骨龄 {boneAgeYears} 岁</span>
                <span className="text-[11px]" style={{ color: S.sub }}>（实际 {actualAgeStr}）</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: status.color }} />
                <span className="text-[12px]" style={{ color: status.color }}>{status.label}</span>
                {absDiff > 1 && <span className="text-[11px]" style={{ color: S.sub }}> — 建议关注身高增长趋势</span>}
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-[10px]" style={{ color: S.sub }}>评估日期：{latest.measuredAt.split('T')[0]}</span>
                <Link to="/profile/tanner" className="text-[10px] hover:underline" style={{ color: S.accent }}>详细记录 → 青春期发育</Link>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-wrap gap-3">
        {showForm ? (
        <AddRecordModal
          formDate={formDate} setFormDate={setFormDate}
          formHeight={formHeight} setFormHeight={setFormHeight}
          formWeight={formWeight} setFormWeight={setFormWeight}
          formHeadCirc={formHeadCirc} setFormHeadCirc={setFormHeadCirc}
          formNotes={formNotes} setFormNotes={setFormNotes}
          formPhotoPreview={formPhotoPreview}
          isUnder6={isUnder6}
          onPhotoChange={handlePhotoChange}
          onSave={() => void handleAddRecord()}
          onClose={() => { setShowForm(false); setFormHeight(''); setFormWeight(''); setFormHeadCirc(''); setFormNotes(''); setFormPhotoPreview(null); }}
        />
        ) : null}

        {showOCR ? (
          <div className={`w-full ${S.radius} p-4 space-y-4`} style={{ background: S.card, boxShadow: S.shadow }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium text-sm" style={{ color: S.text }}>Import from health sheet (OCR)</h3>
                <p className="text-xs" style={{ color: S.sub }}>
                  Extracts structured growth measurements only. Nothing is saved until you confirm the candidates.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowOCR(false);
                  resetOCRDraft();
                }}
                className={`px-3 py-1.5 text-sm ${S.radiusSm}`}
                style={{ background: S.bg, color: S.sub }}
              >
                Close OCR
              </button>
            </div>

            {ocrRuntimeAvailable === false && (
              <p className="text-xs text-amber-600">
                当前无法使用本地 OCR 运行时，暂时不能解析体检单图片。
              </p>
            )}

            <div className="space-y-2">
              <input
                type="file"
                accept="image/*"
                aria-label="checkup-sheet-file"
                onChange={(event) => void handleOCRFileChange(event.target.files?.[0] ?? null)}
                className="block text-sm"
              />
              {ocrImageName && (
                <p className="text-xs" style={{ color: S.sub }} data-testid="ocr-image-name">
                  已选择：{ocrImageName}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => void handleOCRAnalyze()}
                  disabled={!ocrImageDataUrl || ocrRuntimeAvailable === false || ocrStatus === 'analyzing'}
                  className={`px-4 py-1.5 text-sm text-white ${S.radiusSm} disabled:opacity-50`}
                  style={{ background: S.accent }}
                >
                  {ocrStatus === 'analyzing' ? 'Analyzing...' : 'Analyze sheet'}
                </button>
                <button
                  onClick={resetOCRDraft}
                  className={`px-4 py-1.5 text-sm ${S.radiusSm}`}
                  style={{ background: S.bg, color: S.sub }}
                >
                  Reset
                </button>
              </div>
            </div>

            {ocrError && (
              <p className="text-xs text-red-500" data-testid="ocr-error">
                {ocrError}
              </p>
            )}

            {ocrStatus === 'review' && (
              <div className="space-y-3">
                {ocrCandidates.length === 0 ? (
                  <p className="text-sm" style={{ color: S.sub }}>未识别到可导入的受支持测量值。</p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {ocrCandidates.map((candidate, index) => (
                        <div key={`${candidate.typeId}-${index}`} className={`${S.radiusSm} p-3 space-y-2`} style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={candidate.selected}
                              onChange={(event) => {
                                const nextSelected = event.target.checked;
                                setOCRCandidates((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, selected: nextSelected } : item,
                                  ),
                                );
                              }}
                            />
                            Import this measurement
                          </label>
                          <div className="grid gap-2 md:grid-cols-3">
                            <AppSelect
                              value={candidate.typeId}
                              onChange={(v) => {
                                const nextType = v as OCRImportTypeId;
                                setOCRCandidates((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, typeId: nextType } : item,
                                  ),
                                );
                              }}
                              options={GROWTH_STANDARDS.filter((standard) =>
                                ['height', 'weight', 'head-circumference', 'bmi'].includes(standard.typeId),
                              ).map((standard) => ({
                                value: standard.typeId,
                                label: standard.displayName,
                              }))}
                            />
                            <input
                              type="number"
                              value={candidate.value}
                              onChange={(event) => {
                                const nextValue = Number(event.target.value);
                                setOCRCandidates((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, value: nextValue } : item,
                                  ),
                                );
                              }}
                              className={S.select}
                              style={selectStyle}
                            />
                            <ProfileDatePicker
                              value={candidate.measuredAt}
                              onChange={(nextDate) => {
                                setOCRCandidates((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, measuredAt: nextDate } : item,
                                  ),
                                );
                              }}
                              className={S.select}
                              style={selectStyle}
                              size="small"
                            />
                          </div>
                          {candidate.notes && (
                            <p className="text-xs" style={{ color: S.sub }}>{candidate.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => void handleImportOCR()}
                      className={`px-4 py-2 text-sm text-white ${S.radiusSm}`}
                      style={{ background: S.accent }}
                    >
                      Import selected OCR measurements
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {typeMeasurements.length > 0 && (
        <div className={`mt-6 ${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
          <h3 className="text-[13px] font-semibold mb-3" style={{ color: S.text }}>历史记录</h3>
          <table className="w-full text-[12px]" style={{ color: S.text }}>
            <thead>
              <tr className="text-left" style={{ color: S.sub, borderBottom: `1px solid ${S.border}` }}>
                <th className="pb-2">日期</th>
                <th className="pb-2">年龄</th>
                <th className="pb-2">数值</th>
                <th className="pb-2">来源</th>
                <th className="pb-2">百分位</th>
                <th className="pb-2 w-24 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {typeMeasurements
                .slice()
                .reverse()
                .map((measurement) => {
                  const isEditing = editingId === measurement.measurementId;
                  return (
                    <tr key={measurement.measurementId} style={{ borderBottom: `1px solid ${S.border}` }}>
                      <td className="py-2">
                        {isEditing ? (
                          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                            className="text-[12px] px-1.5 py-0.5 rounded border w-[120px]" style={{ borderColor: S.border }} />
                        ) : measurement.measuredAt.split('T')[0]}
                      </td>
                      <td>{measurement.ageMonths < 24 ? `${measurement.ageMonths}月` : `${Math.floor(measurement.ageMonths / 12)}岁${measurement.ageMonths % 12 > 0 ? `${measurement.ageMonths % 12}月` : ''}`}</td>
                      <td>
                        {isEditing ? (
                          <input type="number" step="0.1" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                            className="text-[12px] px-1.5 py-0.5 rounded border w-[80px]" style={{ borderColor: S.border }} />
                        ) : <>{measurement.value} {typeInfo?.unit}</>}
                      </td>
                      <td>{measurement.source === 'manual' ? '手动' : measurement.source === 'ocr' ? 'OCR' : measurement.source === 'computed' ? '计算' : '-'}</td>
                      <td>{(() => {
                        const stored = measurement.percentile;
                        if (stored != null) return `P${Math.round(stored)}`;
                        const approx = computeApproxPercentile(measurement.value, measurement.ageMonths, whoDataset);
                        return approx != null ? `P${approx}` : '-';
                      })()}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={() => void handleSaveEdit(measurement)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-green-50"
                                title="保存" style={{ color: '#16a34a' }}>✓</button>
                              <button onClick={() => setEditingId(null)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-gray-100"
                                title="取消" style={{ color: S.sub }}>✕</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => navigateToAI(measurement)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[14px] transition-colors hover:bg-[#f0f0ec]"
                                title="AI 分析此数据">💬</button>
                              <button onClick={() => handleEditMeasurement(measurement)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-blue-50"
                                title="编辑" style={{ color: '#2563eb' }}>✎</button>
                              <button onClick={() => setDeletingId(measurement.measurementId)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] transition-colors hover:bg-red-50"
                                title="删除" style={{ color: '#dc2626' }}>✕</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}
          onClick={() => setDeletingId(null)}>
          <div className={`${S.radius} p-6 w-[340px]`} style={{ background: S.card, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold mb-2" style={{ color: S.text }}>确认删除</h3>
            <p className="text-[12px] leading-[1.6] mb-5" style={{ color: S.sub }}>
              删除后数据无法恢复，确定要删除这条记录吗？
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeletingId(null)}
                className="text-[12px] px-4 py-1.5 rounded-full font-medium transition-colors hover:opacity-80"
                style={{ background: '#f5f3ef', color: S.text }}>
                取消
              </button>
              <button onClick={() => void handleDeleteMeasurement(deletingId)}
                className="text-[12px] px-4 py-1.5 rounded-full text-white font-medium transition-colors hover:opacity-90"
                style={{ background: '#dc2626' }}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
