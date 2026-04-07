import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeAgeMonths, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { S } from '../../app-shell/page-style.js';
import { AISummaryCard } from './ai-summary-card.js';
import { readImageFileAsDataUrl, analyzeCheckupSheetOCR } from './checkup-ocr.js';
import {
  EYE_SET, CHART_OPTIONS, CARD_REFRACTION_ROWS, CARD_AXIAL_ROWS,
  groupByDate, fmtAge, getAxialRef,
  type VisionRecord,
} from './vision-data.js';
import { BatchForm } from './vision-batch-form.js';
import { VisionGuide } from './vision-guide.js';

/* ================================================================
   RECORD CARD — displays one exam session
   ================================================================ */

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

                {/* Axial surplus */}
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
