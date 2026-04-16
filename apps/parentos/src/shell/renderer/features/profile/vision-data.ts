import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';

/* ── Eye type IDs ────────────────────────────────────────── */

export const EYE_TYPE_IDS: GrowthTypeId[] = [
  'vision-left', 'vision-right', 'corrected-vision-left', 'corrected-vision-right',
  'refraction-sph-left', 'refraction-sph-right', 'refraction-cyl-left', 'refraction-cyl-right',
  'refraction-axis-left', 'refraction-axis-right', 'axial-length-left', 'axial-length-right',
  'corneal-curvature-left', 'corneal-curvature-right',
  'iop-left', 'iop-right',
  'corneal-k1-left', 'corneal-k1-right', 'corneal-k2-left', 'corneal-k2-right',
  'acd-left', 'acd-right', 'lt-left', 'lt-right',
  'hyperopia-reserve',
];
export const EYE_SET = new Set<string>(EYE_TYPE_IDS);

/* ── Chart options ───────────────────────────────────────── */

export const CHART_OPTIONS: Array<{ typeId: GrowthTypeId; label: string }> = [
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

export interface VisionRecord {
  date: string;
  ageMonths: number;
  data: Map<string, number>;
  measurementsByType: Map<string, MeasurementRow>;
}

/** Group eye measurements by date into VisionRecord cards */
export function groupByDate(ms: MeasurementRow[]): VisionRecord[] {
  const eye = ms.filter((m) => EYE_SET.has(m.typeId));
  const map = new Map<string, VisionRecord>();
  for (const m of eye) {
    const d = m.measuredAt.split('T')[0] ?? m.measuredAt;
    let rec = map.get(d);
    if (!rec) {
      rec = { date: d, ageMonths: m.ageMonths, data: new Map(), measurementsByType: new Map() };
      map.set(d, rec);
    }
    rec.data.set(m.typeId, m.value);
    rec.measurementsByType.set(m.typeId, m);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

export function fmtAge(am: number): string {
  if (am < 24) return `${am}月`;
  const y = Math.floor(am / 12), r = am % 12;
  return r > 0 ? `${y}岁${r}月` : `${y}岁`;
}

/* ── Form field definitions ──────────────────────────────── */

export const FORM_SECTIONS: Array<{
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
export const PUPIL_OPTIONS = ['小瞳', '散瞳'] as const;

/* ── Record card row definitions ─────────────────────────── */

export const CARD_REFRACTION_ROWS = [
  { label: '球镜 SPH', od: 'refraction-sph-right', os: 'refraction-sph-left' },
  { label: '柱镜 CYL', od: 'refraction-cyl-right', os: 'refraction-cyl-left' },
  { label: '轴位 AXIS', od: 'refraction-axis-right', os: 'refraction-axis-left' },
  { label: '裸眼视力', od: 'vision-right', os: 'vision-left' },
  { label: '矫正视力', od: 'corrected-vision-right', os: 'corrected-vision-left' },
  { label: '眼压 IOP', od: 'iop-right', os: 'iop-left' },
];

export const CARD_AXIAL_ROWS = [
  { label: 'AL 眼轴长', od: 'axial-length-right', os: 'axial-length-left' },
  { label: 'K1 角膜曲率', od: 'corneal-k1-right', os: 'corneal-k1-left' },
  { label: 'K2 角膜曲率', od: 'corneal-k2-right', os: 'corneal-k2-left' },
  { label: 'K 平均曲率', od: 'corneal-curvature-right', os: 'corneal-curvature-left' },
  { label: 'AD 前房深度', od: 'acd-right', os: 'acd-left' },
  { label: 'LT 晶体厚度', od: 'lt-right', os: 'lt-left' },
];

/* ── Picker configurations ───────────────────────────────── */

/** Config for each measurement type's picker grid */
export const PICKER_CONFIGS: Record<string, { intRange: [number, number]; decimals: number[] }> = {
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

export function getPickerConfig(typeId: string): { intRange: [number, number]; decimals: number[] } | null {
  // Match by prefix: e.g. "axial-length-left" → "axial-length"
  for (const [prefix, cfg] of Object.entries(PICKER_CONFIGS)) {
    if (typeId.startsWith(prefix)) return cfg;
  }
  return null;
}

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
     Same paper, mean +/- SD corneal curvature by age and gender

   Hyperopia reserve (not gender-split, Table 1):
     《中国学龄儿童眼球远视储备、眼轴长度、角膜曲率参考区间
      及相关遗传因素专家共识（2022年）》
     中华预防医学会公共卫生眼科分会
     中华眼科杂志 2022;58(2):96-102

   AL P50 = 同龄同性别中位数（均值）
   AL P75 = 第75百分位（临界值）
   轴余 = P75 - 当前眼轴
*/

export interface GenderAxialRef { p50: number; p75: number; crMean: number }

// Table 4 from He et al. (2023) BJO — exact values
export const AL_MALE: Record<number, GenderAxialRef> = {
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

export const AL_FEMALE: Record<number, GenderAxialRef> = {
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

export function getAxialRef(ageMonths: number, gender: string): { mean: number; critical: number; kMean: number } | null {
  const ageY = Math.round(ageMonths / 12);
  const clamped = Math.max(4, Math.min(18, ageY));
  const table = gender === 'female' ? AL_FEMALE : AL_MALE;
  const entry = table[clamped];
  if (!entry) return null;
  const kMean = +(337.5 / entry.crMean).toFixed(2);
  return { mean: entry.p50, critical: entry.p75, kMean };
}
