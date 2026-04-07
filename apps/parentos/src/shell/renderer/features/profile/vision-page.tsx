import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeAgeMonths, computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements, insertMeasurement } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { S } from '../../app-shell/page-style.js';
import { AISummaryCard } from './ai-summary-card.js';
import { analyzeCheckupSheetOCR, readImageFileAsDataUrl } from './checkup-ocr.js';

/* ── Eye type IDs ────────────────────────────────────────── */

const EYE_TYPE_IDS: GrowthTypeId[] = [
  'vision-left', 'vision-right', 'corrected-vision-left', 'corrected-vision-right',
  'refraction-sph-left', 'refraction-sph-right', 'refraction-cyl-left', 'refraction-cyl-right',
  'refraction-axis-left', 'refraction-axis-right', 'axial-length-left', 'axial-length-right',
  'corneal-curvature-left', 'corneal-curvature-right',
  'iop-left', 'iop-right',
  'corneal-k1-left', 'corneal-k1-right', 'corneal-k2-left', 'corneal-k2-right',
  'acd-left', 'acd-right', 'lt-left', 'lt-right',
  'hyperopia-reserve',
];
const EYE_SET = new Set<string>(EYE_TYPE_IDS);

/* ── Chart options ───────────────────────────────────────── */

const CHART_OPTIONS: Array<{ typeId: GrowthTypeId; label: string }> = [
  { typeId: 'axial-length-right', label: '右眼眼轴' },
  { typeId: 'axial-length-left', label: '左眼眼轴' },
  { typeId: 'vision-right', label: '右眼裸眼' },
  { typeId: 'vision-left', label: '左眼裸眼' },
  { typeId: 'refraction-sph-right', label: '右眼球镜' },
  { typeId: 'refraction-sph-left', label: '左眼球镜' },
  { typeId: 'iop-right', label: '右眼眼压' },
  { typeId: 'iop-left', label: '左眼眼压' },
  { typeId: 'hyperopia-reserve', label: '远视储备' },
];

/* ── Types for grouped records ───────────────────────────── */

interface VisionRecord {
  date: string;
  ageMonths: number;
  data: Map<string, number>;
}

/** Group eye measurements by date into VisionRecord cards */
function groupByDate(ms: MeasurementRow[]): VisionRecord[] {
  const eye = ms.filter((m) => EYE_SET.has(m.typeId));
  const map = new Map<string, VisionRecord>();
  for (const m of eye) {
    const d = m.measuredAt.split('T')[0] ?? m.measuredAt;
    let rec = map.get(d);
    if (!rec) { rec = { date: d, ageMonths: m.ageMonths, data: new Map() }; map.set(d, rec); }
    rec.data.set(m.typeId, m.value);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

function fmtAge(am: number): string {
  if (am < 24) return `${am}月`;
  const y = Math.floor(am / 12), r = am % 12;
  return r > 0 ? `${y}岁${r}月` : `${y}岁`;
}

/* ── Form field definitions ──────────────────────────────── */

const FORM_SECTIONS: Array<{
  title: string;
  fields: Array<{ label: string; od: GrowthTypeId; os: GrowthTypeId; unit: string; step: string }>;
}> = [
  {
    title: '验光单',
    fields: [
      { label: '球镜 SPH', od: 'refraction-sph-right', os: 'refraction-sph-left', unit: 'D', step: '0.25' },
      { label: '柱镜 CYL', od: 'refraction-cyl-right', os: 'refraction-cyl-left', unit: 'D', step: '0.25' },
      { label: '轴位 AXIS', od: 'refraction-axis-right', os: 'refraction-axis-left', unit: '°', step: '1' },
      { label: '裸眼视力', od: 'vision-right', os: 'vision-left', unit: '', step: '0.1' },
      { label: '矫正视力', od: 'corrected-vision-right', os: 'corrected-vision-left', unit: '', step: '0.1' },
      { label: '眼压 IOP', od: 'iop-right', os: 'iop-left', unit: 'mmHg', step: '1' },
    ],
  },
  {
    title: '眼轴单',
    fields: [
      { label: 'AL 眼轴长', od: 'axial-length-right', os: 'axial-length-left', unit: 'mm', step: '0.01' },
      { label: 'K1 角膜曲率', od: 'corneal-k1-right', os: 'corneal-k1-left', unit: 'D', step: '0.25' },
      { label: 'K2 角膜曲率', od: 'corneal-k2-right', os: 'corneal-k2-left', unit: 'D', step: '0.25' },
      { label: 'K 平均曲率', od: 'corneal-curvature-right', os: 'corneal-curvature-left', unit: 'D', step: '0.25' },
      { label: 'AD 前房深度', od: 'acd-right', os: 'acd-left', unit: 'mm', step: '0.01' },
      { label: 'LT 晶体厚度', od: 'lt-right', os: 'lt-left', unit: 'mm', step: '0.01' },
    ],
  },
];

/* ── Pupil state options ─────────────────────────────────── */
const PUPIL_OPTIONS = ['小瞳', '散瞳'] as const;

/* ── Axial length reference data — gender-specific, 4-18 years ──

   Primary source (gender-specific AL percentiles, Table 4):
     He X, Sankaridurg P, Naduvilath T, et al.
     "Normative data and percentile curves for axial length and
      axial length/corneal curvature in Chinese children and
      adolescents aged 4-18 years"
     Br J Ophthalmol 2023;107:167-175
     DOI: 10.1136/bjophthalmol-2021-319431
     Data: 14,127 Chinese participants from 3 studies (STAR, SCORM, etc.)

   Supplementary source (corneal curvature by age/gender, Table 3):
     Same paper, mean ± SD corneal curvature by age and gender

   Hyperopia reserve (not gender-split, Table 1):
     《中国学龄儿童眼球远视储备、眼轴长度、角膜曲率参考区间
      及相关遗传因素专家共识（2022年）》
     中华预防医学会公共卫生眼科分会
     中华眼科杂志 2022;58(2):96-102

   AL P50 = 同龄同性别中位数（均值）
   AL P75 = 第75百分位（临界值）
   轴余 = P75 - 当前眼轴
*/

interface GenderAxialRef { p50: number; p75: number; crMean: number }

// Table 4 from He et al. (2023) BJO — exact values
const AL_MALE: Record<number, GenderAxialRef> = {
  4:  { p50: 22.39, p75: 22.78, crMean: 7.88 },
  5:  { p50: 22.69, p75: 23.12, crMean: 7.90 },
  6:  { p50: 22.97, p75: 23.45, crMean: 7.89 },
  7:  { p50: 23.25, p75: 23.76, crMean: 7.90 },
  8:  { p50: 23.51, p75: 24.07, crMean: 7.90 },
  9:  { p50: 23.76, p75: 24.36, crMean: 7.90 },
  10: { p50: 23.99, p75: 24.64, crMean: 7.88 },
  11: { p50: 24.22, p75: 24.90, crMean: 7.90 },
  12: { p50: 24.43, p75: 25.15, crMean: 7.91 },
  13: { p50: 24.62, p75: 25.39, crMean: 7.89 },
  14: { p50: 24.81, p75: 25.61, crMean: 7.93 },
  15: { p50: 24.98, p75: 25.82, crMean: 7.91 },
  16: { p50: 25.13, p75: 26.01, crMean: 7.92 },
  17: { p50: 25.28, p75: 26.18, crMean: 7.92 },
  18: { p50: 25.41, p75: 26.35, crMean: 7.92 },
};

const AL_FEMALE: Record<number, GenderAxialRef> = {
  4:  { p50: 21.78, p75: 22.14, crMean: 7.73 },
  5:  { p50: 22.10, p75: 22.50, crMean: 7.78 },
  6:  { p50: 22.41, p75: 22.85, crMean: 7.76 },
  7:  { p50: 22.70, p75: 23.19, crMean: 7.78 },
  8:  { p50: 22.98, p75: 23.51, crMean: 7.80 },
  9:  { p50: 23.25, p75: 23.82, crMean: 7.80 },
  10: { p50: 23.51, p75: 24.11, crMean: 7.77 },
  11: { p50: 23.75, p75: 24.39, crMean: 7.79 },
  12: { p50: 23.97, p75: 24.65, crMean: 7.81 },
  13: { p50: 24.19, p75: 24.90, crMean: 7.75 },
  14: { p50: 24.39, p75: 25.13, crMean: 7.78 },
  15: { p50: 24.57, p75: 25.34, crMean: 7.81 },
  16: { p50: 24.75, p75: 25.54, crMean: 7.82 },
  17: { p50: 24.91, p75: 25.73, crMean: 7.82 },
  18: { p50: 25.05, p75: 25.89, crMean: 7.83 },
};

function getAxialRef(ageMonths: number, gender: string): { mean: number; critical: number; kMean: number } | null {
  const ageY = Math.round(ageMonths / 12);
  const clamped = Math.max(4, Math.min(18, ageY));
  const table = gender === 'female' ? AL_FEMALE : AL_MALE;
  const entry = table[clamped];
  if (!entry) return null;
  const kMean = +(337.5 / entry.crMean).toFixed(2);
  return { mean: entry.p50, critical: entry.p75, kMean };
}

/* ================================================================
   RECORD CARD — displays one exam session
   ================================================================ */

/** Rows to show in a record card — only rendered if at least one value exists */
const CARD_REFRACTION_ROWS = [
  { label: '球镜 SPH', od: 'refraction-sph-right', os: 'refraction-sph-left' },
  { label: '柱镜 CYL', od: 'refraction-cyl-right', os: 'refraction-cyl-left' },
  { label: '轴位 AXIS', od: 'refraction-axis-right', os: 'refraction-axis-left' },
  { label: '裸眼视力', od: 'vision-right', os: 'vision-left' },
  { label: '矫正视力', od: 'corrected-vision-right', os: 'corrected-vision-left' },
  { label: '眼压 IOP', od: 'iop-right', os: 'iop-left' },
];
const CARD_AXIAL_ROWS = [
  { label: 'AL 眼轴长', od: 'axial-length-right', os: 'axial-length-left' },
  { label: 'K1 角膜曲率', od: 'corneal-k1-right', os: 'corneal-k1-left' },
  { label: 'K2 角膜曲率', od: 'corneal-k2-right', os: 'corneal-k2-left' },
  { label: 'K 平均曲率', od: 'corneal-curvature-right', os: 'corneal-curvature-left' },
  { label: 'AD 前房深度', od: 'acd-right', os: 'acd-left' },
  { label: 'LT 晶体厚度', od: 'lt-right', os: 'lt-left' },
];

function RecordCard({ record, index, gender, onEdit, meta }: { record: VisionRecord; index: number; gender: string; onEdit: () => void; meta?: { hospital?: string; pupil?: string; notes?: string } }) {
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
        <span className="text-left text-[11px]" style={{ color: S.sub }}>{row.label}</span>
        <span className="text-[14px] font-bold" style={{ color: odVal ? S.text : '#d4d1cc' }}>{odVal || '—'}</span>
        <span className="text-[14px] font-bold" style={{ color: osVal ? S.text : '#d4d1cc' }}>{osVal || '—'}</span>
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
        style={{ background: 'linear-gradient(135deg, #6a82a8, #86AFDA)' }}>
        <div className="flex items-center gap-3">
          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-white/80 text-[13px] font-bold"
            style={{ background: 'rgba(255,255,255,0.2)' }}>{index + 1}</span>
          <span className="text-[14px] font-semibold text-white">{record.date}</span>
          {meta?.pupil && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/20 text-white/80">{meta.pupil}</span>}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <span className="text-[11px] text-white/60">{fmtAge(record.ageMonths)}</span>
            {meta?.hospital && <span className="block text-[10px] text-white/40">{meta.hospital}</span>}
          </div>
          <button onClick={onEdit} title="编辑此记录"
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-white/20"
            style={{ color: 'rgba(255,255,255,0.6)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ background: S.card }}>
        {/* Refraction section */}
        {hasRefraction && (
          <>
            <div className="grid grid-cols-[1.2fr_1fr_1fr] text-center text-[10px] font-medium py-2 px-4"
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
            <div className="grid grid-cols-[1.2fr_1fr_1fr] text-center text-[10px] font-medium py-2 px-4 border-t"
              style={{ color: S.sub, background: '#f8faf9', borderColor: '#e8e5e0' }}>
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
                  style={{ borderColor: '#e8e5e0', background: '#f0f5f4' }}>
                  <div className="text-left">
                    <span className="text-[10px] font-medium" style={{ color: S.sub }}>同龄均值</span>
                  </div>
                  <div>
                    <span className="text-[12px] font-medium" style={{ color: S.sub }}>{ref.mean.toFixed(2)}</span>
                    {kOD != null && <span className="block text-[9px]" style={{ color: '#b0b5bc' }}>K{ref.kMean.toFixed(2)}</span>}
                  </div>
                  <div>
                    <span className="text-[12px] font-medium" style={{ color: S.sub }}>{ref.mean.toFixed(2)}</span>
                    {kOS != null && <span className="block text-[9px]" style={{ color: '#b0b5bc' }}>K{ref.kMean.toFixed(2)}</span>}
                  </div>
                </div>

                {/* Critical threshold */}
                <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center text-center py-2 px-4 border-t"
                  style={{ borderColor: '#f0f0ec', background: '#fafafa' }}>
                  <div className="text-left">
                    <span className="text-[10px] font-medium" style={{ color: S.sub }}>{Math.round(record.ageMonths / 12)}岁</span>
                    <span className="ml-1 text-[10px]" style={{ color: '#b0b5bc' }}>临界</span>
                  </div>
                  <span className="text-[12px] font-medium" style={{ color: S.sub }}>{ref.critical.toFixed(2)}</span>
                  <span className="text-[12px] font-medium" style={{ color: S.sub }}>{ref.critical.toFixed(2)}</span>
                </div>

                {/* Axial surplus (轴余) */}
                <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center text-center py-2.5 px-4 border-t"
                  style={{ borderColor: '#e8e5e0', background: '#f8faf8' }}>
                  <div className="text-left">
                    <span className="text-[11px] font-semibold" style={{ color: S.text }}>轴余</span>
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
            <span className="text-[11px]" style={{ color: S.sub }}>远视储备</span>
            <span className="text-[14px] font-bold" style={{ color: S.text }}>{fmt('hyperopia-reserve')} D</span>
          </div>
        )}

        {/* Notes */}
        {meta?.notes && (
          <div className="px-4 py-2.5 border-t text-[11px]" style={{ borderColor: '#f0f0ec', color: S.sub }}>
            <span className="font-medium" style={{ color: S.text }}>备注：</span>{meta.notes}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   NUMBER PICKER — two-step integer + decimal selector
   ================================================================ */

/** Config for each measurement type's picker grid */
const PICKER_CONFIGS: Record<string, { intRange: [number, number]; decimals: number[] }> = {
  // Axial length: 16-39 mm, .00-.99
  'axial-length': { intRange: [16, 39], decimals: Array.from({ length: 100 }, (_, i) => i) },
  // K curvature: 38-50 D, .00-.99
  'corneal-k': { intRange: [38, 50], decimals: Array.from({ length: 100 }, (_, i) => i) },
  'corneal-curvature': { intRange: [38, 50], decimals: Array.from({ length: 100 }, (_, i) => i) },
  // ACD: 1-6 mm, .00-.99
  'acd': { intRange: [1, 6], decimals: Array.from({ length: 100 }, (_, i) => i) },
  // LT: 2-6 mm, .00-.99
  'lt': { intRange: [2, 6], decimals: Array.from({ length: 100 }, (_, i) => i) },
  // IOP: 5-40 mmHg, integers only
  'iop': { intRange: [5, 40], decimals: [] },
  // SPH: -20 to +10 D, .00/.25/.50/.75
  'refraction-sph': { intRange: [-20, 10], decimals: [0, 25, 50, 75] },
  // CYL: -10 to 0 D, .00/.25/.50/.75
  'refraction-cyl': { intRange: [-10, 0], decimals: [0, 25, 50, 75] },
  // AXIS: 0-180°, integers
  'refraction-axis': { intRange: [0, 180], decimals: [] },
  // Vision: 0.0-2.0, .0-.9
  'vision': { intRange: [0, 2], decimals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  'corrected-vision': { intRange: [0, 2], decimals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  // Hyperopia reserve: -5 to +5 D, .00/.25/.50/.75
  'hyperopia-reserve': { intRange: [-5, 5], decimals: [0, 25, 50, 75] },
};

function getPickerConfig(typeId: string): { intRange: [number, number]; decimals: number[] } | null {
  // Match by prefix: e.g. "axial-length-left" → "axial-length"
  for (const [prefix, cfg] of Object.entries(PICKER_CONFIGS)) {
    if (typeId.startsWith(prefix)) return cfg;
  }
  return null;
}

function NumberPickerPopover({ typeId, label, unit, value, onSelect, onClose }: {
  typeId: string; label: string; unit: string; value: string;
  onSelect: (val: string) => void; onClose: () => void;
}) {
  const cfg = getPickerConfig(typeId);
  const [intPart, setIntPart] = useState<number | null>(() => {
    if (value) { const n = parseFloat(value); return isNaN(n) ? null : Math.floor(n); }
    return null;
  });
  const [step, setStep] = useState<'int' | 'dec'>(value ? 'dec' : 'int');

  if (!cfg) return null;

  const { intRange, decimals } = cfg;
  const ints: number[] = [];
  for (let i = intRange[0]; i <= intRange[1]; i++) ints.push(i);

  const handleIntSelect = (n: number) => {
    setIntPart(n);
    if (decimals.length === 0) {
      onSelect(String(n));
      onClose();
    } else {
      setStep('dec');
    }
  };

  const handleDecSelect = (d: number) => {
    const int = intPart ?? 0;
    const decStr = d < 10 ? `0${d}` : String(d);
    const val = decimals.some((x) => x >= 10) ? `${int}.${decStr}` : `${int}.${d}`;
    onSelect(val);
    onClose();
  };

  const eyeLabel = typeId.includes('right') ? 'OD R' : typeId.includes('left') ? 'OS L' : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-2xl shadow-2xl animate-slide-up" style={{ background: '#f0f0ec' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ background: '#e0e4e0' }}>
          {step === 'dec' && (
            <button onClick={() => setStep('int')} className="text-[12px] font-medium" style={{ color: S.accent }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="inline -mt-0.5 mr-1"><path d="M15 18l-6-6 6-6" /></svg>
              返回
            </button>
          )}
          {step === 'int' && <span />}
          <div className="text-center flex-1">
            {eyeLabel && <span className="text-[12px] font-bold mr-2" style={{ color: '#e67e22' }}>{eyeLabel}</span>}
            <span className="text-[15px] font-bold" style={{ color: S.text }}>{label}</span>
            {unit && <span className="text-[11px] ml-1.5" style={{ color: S.sub }}>{unit}</span>}
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: S.sub }}>✕</button>
        </div>

        {/* Current value display */}
        {(intPart != null || value) && (
          <div className="text-center py-2">
            <span className="text-[20px] font-bold" style={{ color: S.text }}>
              {intPart != null ? `${intPart}.` : value}
            </span>
          </div>
        )}

        {/* Grid */}
        <div className="px-3 pb-4 max-h-[320px] overflow-y-auto">
          {step === 'int' ? (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(ints.length, 6)}, 1fr)` }}>
              {ints.map((n) => (
                <button key={n} onClick={() => handleIntSelect(n)}
                  className={`py-3 text-[16px] font-semibold rounded-xl transition-all ${intPart === n ? 'text-white' : 'hover:bg-white'}`}
                  style={intPart === n ? { background: S.accent, color: '#fff' } : { background: '#fafafa', color: S.text }}>
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(decimals.length, 10)}, 1fr)` }}>
              {decimals.map((d) => (
                <button key={d} onClick={() => handleDecSelect(d)}
                  className="py-3 text-[15px] font-semibold rounded-xl transition-all hover:bg-white"
                  style={{ background: '#fafafa', color: S.text }}>
                  {d < 10 && decimals.some((x) => x >= 10) ? `0${d}` : String(d)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Manual input fallback */}
        <div className="flex items-center gap-2 px-4 pb-4">
          <input type="number" placeholder="或手动输入..." value={value}
            onChange={(e) => onSelect(e.target.value)}
            className="flex-1 rounded-xl px-3 py-2 text-[13px] border-0 outline-none"
            style={{ background: '#fff', color: S.text }} />
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-[12px] font-medium text-white"
            style={{ background: S.accent }}>确定</button>
        </div>
      </div>
    </div>
  );
}

/* ── Clickable value cell (shows picker on click) ──────── */

function ValueCell({ typeId, label, unit, value, onChange }: {
  typeId: string; label: string; unit: string; value: string; onChange: (v: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const hasPicker = getPickerConfig(typeId) != null;

  return (
    <>
      {hasPicker ? (
        <button onClick={() => setShowPicker(true)}
          className="w-full text-center text-[13px] font-medium rounded-lg py-1.5 transition-all hover:ring-2 hover:ring-[#86AFDA]/30"
          style={{ background: value ? '#eef3ee' : '#f5f3ef', color: value ? S.text : '#c0bdb8' }}>
          {value || '—'}
        </button>
      ) : (
        <input type="number" placeholder="—" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full text-center text-[13px] font-medium rounded-lg py-1.5 border-0 outline-none focus:ring-2 focus:ring-[#86AFDA]/30"
          style={{ background: '#f5f3ef', color: S.text }} />
      )}
      {showPicker && (
        <NumberPickerPopover typeId={typeId} label={label} unit={unit} value={value}
          onSelect={onChange} onClose={() => setShowPicker(false)} />
      )}
    </>
  );
}

/* ================================================================
   BATCH INPUT FORM
   ================================================================ */

function BatchForm({ childId, birthDate, onSave, onClose, initialRecord }: {
  childId: string; birthDate: string; onSave: () => void; onClose: () => void;
  initialRecord?: VisionRecord;
}) {
  const initVals: Record<string, string> = {};
  if (initialRecord) { for (const [k, v] of initialRecord.data) initVals[k] = String(v); }
  const [date, setDate] = useState(initialRecord?.date ?? new Date().toISOString().slice(0, 10));
  const [hospital, setHospital] = useState('');
  const [pupil, setPupil] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>(initVals);
  const [hrValue, setHrValue] = useState(initVals['hyperopia-reserve'] ?? '');
  const [screenTime, setScreenTime] = useState('');
  const [outdoorTime, setOutdoorTime] = useState('');
  const [controls, setControls] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);

  const set = (typeId: string, val: string) => setValues((prev) => ({ ...prev, [typeId]: val }));

  // OCR: pick image → analyze → prefill form
  const handleOCR = async () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setOcrBusy(true);
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        const result = await analyzeCheckupSheetOCR({ imageUrl: dataUrl });
        if (result?.measurements) {
          const next = { ...values };
          for (const m of result.measurements) {
            if (EYE_SET.has(m.typeId)) next[m.typeId] = String(m.value);
          }
          setValues(next);
          if (result.measurements[0]?.measuredAt) setDate(result.measurements[0].measuredAt);
        }
      } catch { /* OCR failed silently */ }
      setOcrBusy(false);
    };
    input.click();
  };

  const handleSubmit = async () => {
    setSaving(true);
    const ageMonths = computeAgeMonthsAt(birthDate, date);
    const now = isoNow();
    const entries = Object.entries(values).filter(([, v]) => v.trim() !== '');
    if (hrValue.trim()) entries.push(['hyperopia-reserve', hrValue.trim()]);

    const noteParts: string[] = [];
    if (hospital) noteParts.push(`医院: ${hospital}`);
    if (pupil) noteParts.push(`瞳孔: ${pupil}`);
    if (screenTime) noteParts.push(`日近距用眼: ${screenTime}`);
    if (outdoorTime) noteParts.push(`日户外: ${outdoorTime}`);
    if (controls) noteParts.push(`防控: ${controls}`);
    if (notes) noteParts.push(notes);
    const noteStr = noteParts.length > 0 ? noteParts.join(' | ') : null;

    for (const [typeId, val] of entries) {
      const parsed = parseFloat(val);
      if (isNaN(parsed)) continue;
      try {
        await insertMeasurement({
          measurementId: ulid(), childId, typeId, value: parsed,
          measuredAt: date, ageMonths, percentile: null, source: 'manual', notes: noteStr, now,
        });
      } catch { /* duplicate or bridge error */ }
    }
    onSave();
    onClose();
    setSaving(false);
  };

  const filledCount = Object.values(values).filter((v) => v.trim()).length + (hrValue.trim() ? 1 : 0);
  const inp = `${S.radiusSm} px-3 py-2 text-[13px] border-0 outline-none focus:ring-2 focus:ring-[#86AFDA]/30`;

  return (
    <div className={`${S.radius} p-5 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-semibold" style={{ color: S.text }}>{initialRecord ? `编辑检查记录 · ${initialRecord.date}` : '录入检查数据'}</h3>
        <div className="flex items-center gap-2">
          {/* OCR button */}
          <button onClick={() => void handleOCR()} disabled={ocrBusy}
            className={`group relative flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90 disabled:opacity-50`}
            style={{ background: S.accent }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h4M7 12h10M7 16h6" />
            </svg>
            {ocrBusy ? '识别中...' : '智能识别'}
            <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-0.5 text-[9px] font-normal text-white opacity-0 group-hover:opacity-100 z-50"
              style={{ background: '#1a2b4a' }}>拍照或上传验光单自动填入</span>
          </button>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#f0f0ec]" style={{ color: S.sub }}>✕</button>
        </div>
      </div>

      {/* Basic info */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>检查日期 *</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>医院/机构</label>
          <input value={hospital} onChange={(e) => setHospital(e.target.value)} placeholder="选填"
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>瞳孔状态</label>
          <div className="flex gap-1.5">
            {PUPIL_OPTIONS.map((p) => (
              <button key={p} onClick={() => setPupil(pupil === p ? '' : p)}
                className={`flex-1 py-2 text-[11px] font-medium ${S.radiusSm} transition-all`}
                style={pupil === p ? { background: S.accent, color: '#fff' } : { background: '#f5f3ef', color: S.sub }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Form sections with picker-enabled cells */}
      {FORM_SECTIONS.map((section) => (
        <div key={section.title} className="mb-4">
          <p className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>{section.title}</p>
          <div className={`${S.radiusSm} overflow-hidden border`} style={{ borderColor: '#e8e5e0' }}>
            <div className="grid grid-cols-[1.5fr_1fr_1fr] text-center text-[10px] font-medium py-2 px-3"
              style={{ background: '#f8faf9', color: S.sub }}>
              <span className="text-left">项目</span>
              <span>OD 右眼</span>
              <span>OS 左眼</span>
            </div>
            {section.fields.map((f, i) => (
              <div key={f.label} className="grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2 py-2 px-3 border-t"
                style={{ borderColor: '#f0f0ec', background: i % 2 === 0 ? S.card : '#fafcfb' }}>
                <div>
                  <span className="text-[11px]" style={{ color: S.text }}>{f.label}</span>
                  {f.unit && <span className="text-[9px] ml-1" style={{ color: S.sub }}>({f.unit})</span>}
                </div>
                <ValueCell typeId={f.od} label={f.label} unit={f.unit} value={values[f.od] ?? ''} onChange={(v) => set(f.od, v)} />
                <ValueCell typeId={f.os} label={f.label} unit={f.unit} value={values[f.os] ?? ''} onChange={(v) => set(f.os, v)} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Hyperopia reserve */}
      <div className="mb-4">
        <p className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>远视储备</p>
        <div className="flex items-center gap-3">
          <ValueCell typeId="hyperopia-reserve" label="远视储备" unit="D" value={hrValue} onChange={setHrValue} />
          <span className="text-[11px]" style={{ color: S.sub }}>D</span>
        </div>
      </div>

      {/* Behavioral factors */}
      <div className={`${S.radiusSm} p-4 mb-4`} style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
        <p className="text-[12px] font-semibold mb-3" style={{ color: S.text }}>用眼行为因素</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] block mb-1" style={{ color: S.sub }}>日近距用眼时长（课外）</label>
            <div className="flex gap-1.5">
              {['0-1小时', '2-3小时', '4-5小时', '6小时以上'].map((opt) => (
                <button key={opt} onClick={() => setScreenTime(screenTime === opt ? '' : opt)}
                  className={`flex-1 py-1.5 text-[10px] ${S.radiusSm} transition-all`}
                  style={screenTime === opt ? { background: S.accent, color: '#fff' } : { background: '#fff', border: `1px solid ${S.border}`, color: S.sub }}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] block mb-1" style={{ color: S.sub }}>日户外活动时长</label>
            <div className="flex gap-1.5">
              {['0-1小时', '2-3小时', '4-5小时', '5小时以上'].map((opt) => (
                <button key={opt} onClick={() => setOutdoorTime(outdoorTime === opt ? '' : opt)}
                  className={`flex-1 py-1.5 text-[10px] ${S.radiusSm} transition-all`}
                  style={outdoorTime === opt ? { background: S.accent, color: '#fff' } : { background: '#fff', border: `1px solid ${S.border}`, color: S.sub }}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Control measures & notes */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>防控措施</label>
          <input value={controls} onChange={(e) => setControls(e.target.value)}
            placeholder="如：OK镜、低浓度阿托品、户外运动..."
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
        <div>
          <label className="text-[11px] block mb-1" style={{ color: S.sub }}>防控笔记</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="补充说明..."
            className={`w-full ${inp}`} style={{ background: '#f5f3ef', color: S.text }} />
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: S.sub }}>已填写 {filledCount} 项数据</span>
        <div className="flex gap-2">
          <button onClick={onClose} className={`px-4 py-2 text-[12px] ${S.radiusSm}`}
            style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
          <button onClick={() => void handleSubmit()} disabled={saving || filledCount === 0}
            className={`px-5 py-2 text-[12px] font-medium text-white ${S.radiusSm} disabled:opacity-40 transition-all hover:opacity-90`}
            style={{ background: S.accent }}>
            {saving ? '保存中...' : '保存记录'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   VISION GUIDE — interactive step-by-step tutorial
   ================================================================ */

const GUIDE_STEPS = [
  {
    title: '了解验光检查',
    sections: [
      {
        heading: '什么是验光？',
        body: '验光就是检查眼睛的屈光状态：是近视、远视、散光还是正视。医院通常会出具一张验光单。',
      },
      {
        heading: '两种瞳孔状态',
        items: [
          { label: '小瞳验光', desc: '自然状态下验光，不滴散瞳药水。日常复查常用，速度快但可能受调节力影响。', tag: '常规' },
          { label: '散瞳验光', desc: '滴麻痹睫状肌的药水后验光，排除假性近视。首次配镜或青少年建议散瞳验光。', tag: '更准确' },
        ],
      },
      {
        heading: '两种验光方法',
        items: [
          { label: '电脑验光', desc: '通过电脑验光仪自动测量，结果以小票打印。球镜标注 S 或 SPH，柱镜标注 C 或 CYL。速度快但仅供参考。', tag: '快速筛查' },
          { label: '综合验光', desc: '医生通过综合验光仪（插片法）逐步调整镜片，依赖受检者识别视标。也叫主觉验光。球镜标注 DS，柱镜标注 DC。结果更准确，用于配镜处方。', tag: '配镜依据' },
        ],
      },
    ],
  },
  {
    title: '看懂验光单',
    sections: [
      {
        heading: '验光单上的字段',
        table: [
          { field: '球镜 S / SPH / DS', meaning: '近视或远视度数', note: '负值 = 近视，正值 = 远视。如 -1.25 表示近视 125 度' },
          { field: '柱镜 C / CYL / DC', meaning: '散光度数', note: '通常为负值。如 -0.75 表示散光 75 度。无散光时为 0 或不写' },
          { field: '轴位 AX / AXIS', meaning: '散光方向', note: '0-180° 之间的角度。只有有散光时才有意义' },
          { field: '矫正视力 VA', meaning: '戴镜后的视力', note: '如 → 1.0 表示矫正后能看到 1.0' },
          { field: '瞳距 PD', meaning: '两眼瞳孔间距', note: '配镜时需要，本 APP 暂不记录' },
        ],
      },
      {
        heading: 'OD 和 OS 是什么？',
        body: 'OD = 右眼 (拉丁文 Oculus Dexter)，OS = 左眼 (Oculus Sinister)。有些单子用 R (Right) 和 L (Left)。录入时请注意区分左右眼。',
      },
      {
        heading: '常见格式示例',
        examples: [
          { raw: 'OD  -1.25DS / -0.75DC × 80 → 1.0', parsed: '右眼 近视125度 / 散光75度 轴位80° 矫正视力1.0' },
          { raw: 'R  -1.25 / -0.75 × 80', parsed: '无DS DC标注，同上含义' },
          { raw: 'R  PL → 1.0', parsed: '平光 PL = 球镜和柱镜都为 0，录入时都填 0' },
          { raw: 'R  0.6  -1.25DS / -0.75DC × 80 → 1.0', parsed: '第一个数 0.6 是裸眼视力' },
        ],
      },
    ],
  },
  {
    title: '看懂眼轴单',
    sections: [
      {
        heading: '什么是眼轴检查？',
        body: '眼轴长度 (AL) 是从角膜到眼底的距离，是预测近视进展的核心指标。每增长 1mm 眼轴，约等于增加 300 度近视。比视力表检查更有预测价值。',
      },
      {
        heading: '眼轴单上的字段',
        table: [
          { field: 'AL 眼轴长', meaning: '角膜到眼底的长度', note: '正常成人约 24mm。儿童应低于同龄均值。超过临界值需高度关注' },
          { field: 'K1 / R1', meaning: '角膜平坦子午线曲率', note: '正常约 42-44D' },
          { field: 'K2 / R2', meaning: '角膜陡峭子午线曲率', note: '正常约 43-45D。K1 和 K2 差值反映角膜散光' },
          { field: 'AD / ACD', meaning: '前房深度', note: '角膜到晶状体前表面的距离，正常约 2.5-4.0mm' },
          { field: 'LT', meaning: '晶体厚度', note: '眼内晶状体的厚度，正常约 3.5-4.5mm' },
          { field: 'AL/CR', meaning: '眼轴/角膜曲率比', note: '> 3 可能提示近视风险增加' },
        ],
      },
      {
        heading: '眼轴余量',
        body: '眼轴余量 = 同龄同性别眼轴临界值 - 孩子当前眼轴。余量越小，近视风险越高。每次检查关注眼轴增长速度比绝对值更重要。每半年增长超过 0.3mm 需要注意。',
      },
    ],
  },
];

function VisionGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = GUIDE_STEPS[step];
  if (!current) return null;

  return (
    <div className={`${S.radius} mb-5 overflow-hidden`} style={{ boxShadow: S.shadow }}>
      {/* Step header */}
      <div className="px-5 py-4" style={{ background: 'linear-gradient(135deg, #4a6a8a, #6a8ab0)' }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] text-white/60">验光单录入指引</span>
          <button onClick={onClose} className="w-6 h-6 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10">✕</button>
        </div>
        <h3 className="text-[16px] font-bold text-white mb-3">{current.title}</h3>
        {/* Step indicators */}
        <div className="flex items-center gap-1">
          {GUIDE_STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)}
              className={`h-[6px] rounded-full transition-all ${i === step ? 'w-6 bg-white' : 'w-[6px] bg-white/30 hover:bg-white/50'}`} />
          ))}
          <span className="text-[10px] text-white/50 ml-2">{step + 1}/{GUIDE_STEPS.length}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 space-y-5" style={{ background: S.card }}>
        {current.sections.map((sec, si) => (
          <div key={si}>
            <h4 className="text-[13px] font-semibold mb-2" style={{ color: S.text }}>{sec.heading}</h4>

            {'body' in sec && sec.body && (
              <p className="text-[12px] leading-relaxed" style={{ color: S.sub }}>{sec.body}</p>
            )}

            {'items' in sec && sec.items && (
              <div className="space-y-2">
                {sec.items.map((item, ii) => (
                  <div key={ii} className={`${S.radiusSm} p-3`} style={{ background: '#f8faf9', border: `1px solid ${S.border}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold" style={{ color: S.text }}>{item.label}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: '#e8f0e8', color: S.accent }}>{item.tag}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: S.sub }}>{item.desc}</p>
                  </div>
                ))}
              </div>
            )}

            {'table' in sec && sec.table && (
              <div className={`${S.radiusSm} overflow-hidden border`} style={{ borderColor: S.border }}>
                <div className="grid grid-cols-[1.2fr_1fr_1.5fr] text-[10px] font-medium py-2 px-3" style={{ background: '#f8faf9', color: S.sub }}>
                  <span>字段</span><span>含义</span><span>说明</span>
                </div>
                {sec.table.map((row, ri) => (
                  <div key={ri} className="grid grid-cols-[1.2fr_1fr_1.5fr] py-2 px-3 border-t text-[11px]"
                    style={{ borderColor: '#f0f0ec', background: ri % 2 === 0 ? S.card : '#fafcfb' }}>
                    <span className="font-semibold" style={{ color: S.accent }}>{row.field}</span>
                    <span style={{ color: S.text }}>{row.meaning}</span>
                    <span style={{ color: S.sub }}>{row.note}</span>
                  </div>
                ))}
              </div>
            )}

            {'examples' in sec && sec.examples && (
              <div className="space-y-2">
                {sec.examples.map((ex, ei) => (
                  <div key={ei} className={`${S.radiusSm} p-3`} style={{ background: '#f8faf9', border: `1px solid ${S.border}` }}>
                    <p className="text-[12px] font-mono font-semibold mb-1" style={{ color: S.text }}>{ex.raw}</p>
                    <p className="text-[10px]" style={{ color: S.sub }}>{ex.parsed}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-5 py-3" style={{ background: '#f8faf9', borderTop: `1px solid ${S.border}` }}>
        <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
          className="text-[12px] font-medium disabled:opacity-30" style={{ color: S.sub }}>
          ← 上一步
        </button>
        {step < GUIDE_STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)}
            className={`px-4 py-1.5 text-[12px] font-medium text-white ${S.radiusSm}`} style={{ background: S.accent }}>
            下一步 →
          </button>
        ) : (
          <button onClick={onClose}
            className={`px-4 py-1.5 text-[12px] font-medium text-white ${S.radiusSm}`} style={{ background: S.accent }}>
            我知道了 ✓
          </button>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   MAIN PAGE
   ================================================================ */

export default function VisionPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [chartType, setChartType] = useState<GrowthTypeId>('axial-length-right');
  const [showForm, setShowForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VisionRecord | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [ocrScanning, setOcrScanning] = useState(false);

  useEffect(() => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setMeasurements).catch(() => {});
  }, [activeChildId]);

  const records = useMemo(() => groupByDate(measurements), [measurements]);
  const reload = () => { if (activeChildId) getMeasurements(activeChildId).then(setMeasurements).catch(() => {}); };

  const typeInfo = GROWTH_STANDARDS.find((s) => s.typeId === chartType);
  const chartData = measurements
    .filter((m) => m.typeId === chartType)
    .sort((a, b) => a.ageMonths - b.ageMonths)
    .map((m) => ({ age: m.ageMonths, value: m.value, date: m.measuredAt.split('T')[0] }));

  if (!child) return <div className="flex items-center justify-center h-full" style={{ color: S.sub }}>请先添加孩子档案</div>;

  const ageMonths = computeAgeMonths(child.birthDate);

  // Latest values for AI context
  const latest = useMemo(() => {
    const m = new Map<string, MeasurementRow>();
    for (const r of measurements) { if (!EYE_SET.has(r.typeId)) continue; const e = m.get(r.typeId); if (!e || r.measuredAt > e.measuredAt) m.set(r.typeId, r); }
    return m;
  }, [measurements]);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold" style={{ color: S.text }}>视力档案</h1>
          {/* Info icon with sources tooltip */}
          <div className="group relative">
            <div className="w-[18px] h-[18px] rounded-full flex items-center justify-center cursor-help transition-colors hover:bg-[#f0f0ec]" style={{ color: S.sub }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>
            <div className="pointer-events-none absolute left-0 top-7 z-50 w-[340px] rounded-xl p-4 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100"
              style={{ background: '#1a2b4a', color: '#e0e4e8', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
              <p className="text-[12px] font-semibold text-white mb-2.5">数据参考文献</p>
              <ul className="space-y-2.5">
                <li>
                  <span className="text-[#c8e64a] font-medium">眼轴 P50/P75 百分位（分性别 · 4-18岁）</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">He X, Sankaridurg P, Naduvilath T, et al. Normative data and percentile curves for axial length and axial length/corneal curvature in Chinese children and adolescents aged 4-18 years.</span>
                  <span className="block text-[10px] text-[#7a8090]">Br J Ophthalmol 2023;107:167-175</span>
                  <span className="block text-[9px] text-[#606878]">DOI: 10.1136/bjophthalmol-2021-319431 · 样本: 14,127名 · STAR研究等3项队列</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">远视储备 · 角膜曲率参考区间（6-15岁）</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">中华预防医学会公共卫生眼科分会. 中国学龄儿童眼球远视储备、眼轴长度、角膜曲率参考区间及相关遗传因素专家共识（2022年）.</span>
                  <span className="block text-[10px] text-[#7a8090]">中华眼科杂志 2022;58(2):96-102</span>
                  <span className="block text-[9px] text-[#606878]">DOI: 10.3760/cma.j.cn112142-20210603-00267 · 安阳/山东/甘肃调查</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">眼轴防控应用共识</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">中华医学会眼科学分会眼视光学组. 眼轴长度在近视防控管理中的应用专家共识（2023）.</span>
                  <span className="block text-[10px] text-[#7a8090]">中华实验眼科杂志 2024;42(1):1-8</span>
                </li>
                <li>
                  <span className="text-[#c8e64a] font-medium">近视防控技术指南</span>
                  <span className="block text-[10px] text-[#a0a8b4] mt-0.5">国家卫生健康委员会. 儿童青少年近视防控适宜技术指南（更新版）. 2023</span>
                </li>
              </ul>
              <p className="text-[9px] mt-2.5 pt-2 border-t border-white/10 text-[#808890]">P50 = 同龄同性别中位数 · P75 = 第75百分位（临界值） · 轴余 = P75 − 当前眼轴 · 覆盖: 4-18岁男/女</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowGuide(!showGuide)}
            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium ${S.radiusSm} transition-all`}
            style={showGuide ? { background: S.accent, color: '#fff' } : { background: '#f0f0ec', color: S.sub }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            录入指引
          </button>
          <button onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = async () => {
              const file = input.files?.[0]; if (!file || !child) return;
              setOcrScanning(true);
              try {
                const dataUrl = await readImageFileAsDataUrl(file);
                const result = await analyzeCheckupSheetOCR({ imageUrl: dataUrl });
                if (result?.measurements?.length) { setShowForm(true); }
              } catch { /* OCR failed */ }
              setOcrScanning(false);
            };
            input.click();
          }} disabled={ocrScanning}
            className={`group relative flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium ${S.radiusSm} transition-all hover:opacity-90 disabled:opacity-50`}
            style={{ background: '#86AFDA', color: '#fff' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h4M7 12h10M7 16h6" />
            </svg>
            {ocrScanning ? '识别中...' : '智能识别'}
            <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-0.5 text-[9px] font-normal text-white opacity-0 group-hover:opacity-100 z-50"
              style={{ background: '#1a2b4a' }}>上传验光单/眼轴单自动识别</span>
          </button>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90`}
              style={{ background: S.accent }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              录入数据
            </button>
          )}
        </div>
      </div>
      <p className="text-[12px] mb-5" style={{ color: S.sub }}>
        {child.displayName}，{Math.floor(ageMonths / 12)}岁{ageMonths % 12}个月
      </p>

      {/* ── Interactive guide ────────────────────────────────── */}
      {showGuide && <VisionGuide onClose={() => setShowGuide(false)} />}

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

      {/* ── Batch input form ─────────────────────────────────── */}
      {showForm && (
        <BatchForm childId={child.childId} birthDate={child.birthDate} onSave={reload}
          onClose={() => { setShowForm(false); setEditingRecord(null); }}
          initialRecord={editingRecord ?? undefined} />
      )}

      {/* ── Exam record cards ────────────────────────────────── */}
      {records.length > 0 ? (
        <div className="mb-6">
          <h2 className="text-[13px] font-semibold mb-3" style={{ color: S.text }}>检查记录（{records.length} 次）</h2>
          {records.map((rec, i) => <RecordCard key={rec.date} record={rec} index={records.length - 1 - i} gender={child.gender}
            onEdit={() => { setEditingRecord(rec); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}
        </div>
      ) : !showForm && (
        <div className={`${S.radius} p-8 text-center mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: '#f5f3ef' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c0bdb8" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" /><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            </svg>
          </div>
          <p className="text-[13px] font-medium" style={{ color: S.text }}>还没有视力检查记录</p>
          <p className="text-[11px] mt-1" style={{ color: S.sub }}>点击上方按钮录入第一次检查数据</p>
        </div>
      )}

      {/* ── Trend chart ──────────────────────────────────────── */}
      {records.length > 0 && (
        <div className={`${S.radius} p-4 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold" style={{ color: S.text }}>趋势曲线</h3>
            <select value={chartType} onChange={(e) => setChartType(e.target.value as GrowthTypeId)}
              className={`${S.radiusSm} px-2.5 py-1.5 text-[11px] border-0 outline-none`}
              style={{ background: '#f5f3ef', color: S.text }}>
              {CHART_OPTIONS.map((o) => <option key={o.typeId} value={o.typeId}>{o.label}</option>)}
            </select>
          </div>
          {chartData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-[12px]" style={{ color: '#d4d1cc' }}>
              暂无 {typeInfo?.displayName ?? chartType} 数据
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
