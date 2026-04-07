import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeAgeMonths, computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements, insertMeasurement } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { canRenderWHOLMS, loadWHOLMS, PERCENTILE_COLORS, type WHOLMSDataset } from './who-lms-loader.js';
import { AISummaryCard } from './ai-summary-card.js';
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
    typeIds: [
      'height', 'weight', 'head-circumference', 'bmi', 'bone-age',
      'body-fat-percentage', 'scoliosis-cobb-angle',
    ],
  },
  {
    label: '实验室检查',
    typeIds: [
      'lab-vitamin-d', 'lab-ferritin', 'lab-hemoglobin', 'lab-calcium', 'lab-zinc',
    ],
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
const OTHER_TYPE_IDS = ['bone-age', 'body-fat-percentage', 'scoliosis-cobb-angle',
  'lab-vitamin-d', 'lab-ferritin', 'lab-hemoglobin', 'lab-calcium', 'lab-zinc'] as const;
const CARD_TYPE_IDS = new Set(METRIC_CARDS.map((c) => c.typeId));

function computeBMI(heightCm: number, weightKg: number): number {
  const hm = heightCm / 100;
  return Math.round((weightKg / (hm * hm)) * 10) / 10;
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

export default function GrowthCurvePage() {
  const { activeChildId, children } = useAppStore();
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
  const [whoDataset, setWhoDataset] = useState<WHOLMSDataset | null>(null);
  const [showOCR, setShowOCR] = useState(false);
  const [ocrRuntimeAvailable, setOCRRuntimeAvailable] = useState<boolean | null>(null);
  const [ocrImageName, setOCRImageName] = useState<string | null>(null);
  const [ocrImageDataUrl, setOCRImageDataUrl] = useState<string | null>(null);
  const [ocrStatus, setOCRStatus] = useState<'idle' | 'analyzing' | 'review'>('idle');
  const [ocrError, setOCRError] = useState<string | null>(null);
  const [ocrCandidates, setOCRCandidates] = useState<Array<OCRMeasurementCandidate & { selected: boolean }>>([]);

  useEffect(() => {
    if (!activeChildId) {
      return;
    }

    getMeasurements(activeChildId).then(setMeasurements).catch(() => {});
  }, [activeChildId]);

  useEffect(() => {
    hasCheckupOCRRuntime().then(setOCRRuntimeAvailable).catch(() => {
      setOCRRuntimeAvailable(false);
    });
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

    loadWHOLMS(selectedType as GrowthTypeId, child.gender)
      .then(setWhoDataset)
      .catch(() => setWhoDataset(null));
  }, [selectedType, child]);

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
  const percentileLines = whoDataset && canShowWhoLines ? whoDataset.lines : [];
  const referenceNote = (() => {
    if (typeInfo?.curveType !== 'lms-percentile') {
      return 'This metric uses a static reference range instead of WHO percentile curves.';
    }

    if (!whoDataset) {
      return 'Official WHO percentile data is unavailable for this metric and sex. Showing recorded measurements only.';
    }

    if (!canShowWhoLines) {
      const start = Math.round(whoDataset.coverage.startAgeMonths);
      const end = Math.round(whoDataset.coverage.endAgeMonths);
      return `Official WHO percentile data for this metric covers ${start}-${end} months. Showing recorded measurements only for the current age range.`;
    }

    return 'WHO percentile reference lines (P3-P97) are loaded from the official 2006/2007 tables.';
  })();

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
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
      <div className="flex items-center justify-between mb-6">
        {/* OCR smart-scan button */}
        <button onClick={() => setShowOCR(!showOCR)}
          className={`group relative flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium text-white ${S.radiusSm} transition-all hover:opacity-90`}
          style={{ background: showOCR ? S.sub : S.accent, boxShadow: '0 2px 6px rgba(0,0,0,0.1)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M7 8h4M7 12h10M7 16h6" />
          </svg>
          {showOCR ? '关闭识别' : '智能识别'}
          {/* Tooltip */}
          <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-normal text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-50"
            style={{ background: '#1a2b4a' }}>
            拍照/上传体检单，自动识别数据
          </span>
        </button>
      </div>

      {/* ── Metric cards ──────────────────────────────────────── */}
      <div className={`grid gap-3 mb-4`} style={{ gridTemplateColumns: `repeat(${visibleCards.length}, 1fr)` }}>
        {visibleCards.map((card) => {
          const isActive = selectedType === card.typeId;
          const m = getLatestMeasurement(measurements, card.typeId);
          let displayVal: string;
          let dateLabel: string;
          if (card.typeId === 'bmi') {
            displayVal = computedBmi != null ? `${computedBmi}` : '--';
            // BMI date follows whichever of height/weight was recorded later
            const bmiDate = latestH && latestW ? (latestH.measuredAt > latestW.measuredAt ? latestH.measuredAt : latestW.measuredAt) : null;
            dateLabel = bmiDate ? fmtMeasDate(bmiDate) : '暂无数据';
          } else {
            displayVal = m ? `${m.value}` : '--';
            dateLabel = m ? fmtMeasDate(m.measuredAt) : '暂无数据';
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
              <p className="text-[20px] font-bold leading-none" style={{ color: S.text }}>{displayVal}</p>
              <p className="text-[10px] mt-0.5" style={{ color: S.sub }}>{card.unit}</p>
              <p className="text-[9px] mt-1" style={{ color: dateLabel === '暂无数据' ? '#d4d1cc' : S.sub }}>{dateLabel}</p>
            </button>
          );
        })}
      </div>

      {/* ── Other metrics dropdown (bone-age, labs, etc.) ──── */}
      {(() => {
        const others = OTHER_TYPE_IDS
          .map((id) => availableTypes.find((s) => s.typeId === id))
          .filter(Boolean);
        if (others.length === 0) return null;
        const isOtherActive = !CARD_TYPE_IDS.has(selectedType as GrowthTypeId);
        return (
          <div className="mb-4">
            <select
              value={isOtherActive ? selectedType : ''}
              onChange={(e) => { if (e.target.value) setSelectedType(e.target.value); }}
              className={`${S.radiusSm} px-3 py-1.5 text-[12px]`}
              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid', color: isOtherActive ? S.text : S.sub }}>
              <option value="" disabled>其他指标...</option>
              {others.map((s) => (
                <option key={s!.typeId} value={s!.typeId}>{s!.displayName} ({s!.unit})</option>
              ))}
            </select>
          </div>
        );
      })()}

      <div className={`${S.radius} p-4 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
        {chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center" style={{ color: S.sub }}>
            <p>暂无 {typeInfo?.displayName ?? selectedType} 数据，请添加记录</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="age" label={{ value: '月龄', position: 'insideBottom', offset: -5 }} />
              <YAxis label={{ value: typeInfo?.unit ?? '', angle: -90, position: 'insideLeft' }} />
              <Tooltip
                formatter={(value: number) => [`${value} ${typeInfo?.unit}`, typeInfo?.displayName]}
                labelFormatter={(age) => `${age} 个月`}
              />
              {percentileLines.map((line) => (
                <Line
                  key={`p${line.percentile}`}
                  data={line.points.map((point) => ({ age: point.ageMonths, [`p${line.percentile}`]: point.value }))}
                  type="monotone"
                  dataKey={`p${line.percentile}`}
                  stroke={PERCENTILE_COLORS[line.percentile] ?? '#d1d5db'}
                  strokeWidth={line.percentile === 50 ? 1.5 : 1}
                  strokeDasharray={line.percentile === 50 ? undefined : '4 4'}
                  dot={false}
                  name={`P${line.percentile}`}
                />
              ))}
              <Line
                type="monotone"
                dataKey="value"
                stroke={TYPE_COLORS[selectedType] ?? '#6366f1'}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs mt-2" style={{ color: S.sub }}>Note: {referenceNote}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {showForm ? (
        <div className={`w-full ${S.radius} p-5 space-y-4`} style={{ background: S.card, boxShadow: S.shadow }}>
          <h3 className="text-[14px] font-bold" style={{ color: S.text }}>添加记录</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>日期</label>
              <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                className={`w-full ${S.radiusSm} px-3 py-1.5 text-sm`}
                style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>身高 (cm)</label>
              <input type="number" step="0.1" placeholder="例: 120.5" value={formHeight}
                onChange={(e) => setFormHeight(e.target.value)}
                className={`w-full ${S.radiusSm} px-3 py-1.5 text-sm`}
                style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
            </div>
            <div>
              <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>体重 (kg)</label>
              <input type="number" step="0.01" placeholder="例: 22.5" value={formWeight}
                onChange={(e) => setFormWeight(e.target.value)}
                className={`w-full ${S.radiusSm} px-3 py-1.5 text-sm`}
                style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
            </div>
            {isUnder6 && (
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>头围 (cm)</label>
                <input type="number" step="0.1" placeholder="例: 48.0" value={formHeadCirc}
                  onChange={(e) => setFormHeadCirc(e.target.value)}
                  className={`w-full ${S.radiusSm} px-3 py-1.5 text-sm`}
                  style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
              </div>
            )}
          </div>
          {/* Auto BMI preview */}
          {formHeight && formWeight && (
            <p className="text-[11px]" style={{ color: S.accent }}>
              BMI 自动计算: {computeBMI(parseFloat(formHeight), parseFloat(formWeight))} kg/m²
            </p>
          )}
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>备注描述</label>
            <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
              placeholder="记录一些观察..."
              className={`w-full ${S.radiusSm} px-3 py-2 text-sm resize-none`}
              rows={2}
              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
          </div>
          <div>
            <label className="text-[11px] mb-1 block" style={{ color: S.sub }}>添加照片</label>
            <input type="file" accept="image/*"
              onChange={(e) => void handlePhotoChange(e.target.files?.[0] ?? null)}
              className="text-[12px]" />
            {formPhotoPreview && (
              <img src={formPhotoPreview} alt="preview" className={`mt-2 h-20 ${S.radiusSm} object-cover`} />
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => void handleAddRecord()}
              className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm}`}
              style={{ background: S.accent }}>保存</button>
            <button onClick={() => { setShowForm(false); setFormHeight(''); setFormWeight(''); setFormHeadCirc(''); setFormNotes(''); setFormPhotoPreview(null); }}
              className={`px-4 py-2 text-[13px] ${S.radiusSm}`}
              style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
          </div>
        </div>
        ) : (
        <button onClick={() => setShowForm(true)}
          className={`px-4 py-2 text-[13px] font-medium text-white ${S.radiusSm}`}
          style={{ background: S.accent }}>
          + 添加记录
        </button>
        )}

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
                            <select
                              value={candidate.typeId}
                              onChange={(event) => {
                                const nextType = event.target.value as OCRImportTypeId;
                                setOCRCandidates((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, typeId: nextType } : item,
                                  ),
                                );
                              }}
                              className={`${S.radiusSm} px-3 py-1.5 text-sm`}
                              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }}
                            >
                              {GROWTH_STANDARDS.filter((standard) =>
                                ['height', 'weight', 'head-circumference', 'bmi'].includes(standard.typeId),
                              ).map((standard) => (
                                <option key={standard.typeId} value={standard.typeId}>
                                  {standard.displayName}
                                </option>
                              ))}
                            </select>
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
                              className={`${S.radiusSm} px-3 py-1.5 text-sm`}
                              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }}
                            />
                            <input
                              type="date"
                              value={candidate.measuredAt}
                              onChange={(event) => {
                                const nextDate = event.target.value;
                                setOCRCandidates((previous) =>
                                  previous.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, measuredAt: nextDate } : item,
                                  ),
                                );
                              }}
                              className={`${S.radiusSm} px-3 py-1.5 text-sm`}
                              style={{ borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }}
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
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {typeMeasurements
                .slice()
                .reverse()
                .map((measurement) => (
                  <tr key={measurement.measurementId} style={{ borderBottom: `1px solid ${S.border}` }}>
                    <td className="py-2">{measurement.measuredAt.split('T')[0]}</td>
                    <td>{measurement.ageMonths < 24 ? `${measurement.ageMonths}月` : `${Math.floor(measurement.ageMonths / 12)}岁${measurement.ageMonths % 12 > 0 ? `${measurement.ageMonths % 12}月` : ''}`}</td>
                    <td>{measurement.value} {typeInfo?.unit}</td>
                    <td>{measurement.source === 'manual' ? '手动' : measurement.source === 'ocr' ? 'OCR' : measurement.source === 'computed' ? '计算' : '-'}</td>
                    <td>{measurement.percentile != null ? `P${Math.round(measurement.percentile)}` : '-'}</td>
                    <td>
                      <button onClick={() => navigateToAI(measurement)}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[14px] transition-colors hover:bg-[#f0f0ec]"
                        title="AI 分析此数据">💬</button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
