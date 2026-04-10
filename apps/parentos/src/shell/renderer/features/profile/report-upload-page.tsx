import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { computeAgeMonths, computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import { insertMeasurement, getMeasurements } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import {
  analyzeCheckupSheetOCR,
  hasCheckupOCRRuntime,
  readImageFileAsDataUrl,
  type OCRMeasurementCandidate,
} from './checkup-ocr.js';
import { ProfileDatePicker } from './profile-date-picker.js';

type Status = 'idle' | 'analyzing' | 'review' | 'importing' | 'done';

const TYPE_EMOJI: Record<string, string> = {
  height: '📏', weight: '⚖️', 'head-circumference': '📐', bmi: '🏃',
  'vision-left': '👁️', 'vision-right': '👁️',
  'corrected-vision-left': '👓', 'corrected-vision-right': '👓',
  'refraction-sph-left': '🔬', 'refraction-sph-right': '🔬',
  'refraction-cyl-left': '🔬', 'refraction-cyl-right': '🔬',
  'axial-length-left': '🔬', 'axial-length-right': '🔬',
  'lab-vitamin-d': '🧪', 'lab-ferritin': '🩸', 'lab-hemoglobin': '🩸',
  'lab-calcium': '🧪', 'lab-zinc': '🧪',
  'bone-age': '🦴',
};

function getDisplayInfo(typeId: string) {
  const std = GROWTH_STANDARDS.find((s) => s.typeId === typeId);
  return { name: std?.displayName ?? typeId, unit: std?.unit ?? '', emoji: TYPE_EMOJI[typeId] ?? '📋' };
}

export default function ReportUploadPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const navigate = useNavigate();

  const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<OCRMeasurementCandidate & { selected: boolean }>>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [allMeasurements, setAllMeasurements] = useState<MeasurementRow[]>([]);
  const [activeView, setActiveView] = useState<'upload' | 'library'>('upload');

  useEffect(() => {
    hasCheckupOCRRuntime().then(setRuntimeAvailable).catch(() => setRuntimeAvailable(false));
  }, []);

  useEffect(() => {
    if (activeChildId) getMeasurements(activeChildId).then(setAllMeasurements).catch(() => {});
  }, [activeChildId]);

  const reloadMeasurements = () => {
    if (activeChildId) getMeasurements(activeChildId).then(setAllMeasurements).catch(() => {});
  };

  // Group OCR-sourced measurements by date for report library
  const reportGroups = useMemo(() => {
    const ocrItems = allMeasurements.filter((m) => m.source === 'ocr');
    const groups = new Map<string, MeasurementRow[]>();
    for (const m of ocrItems) {
      const date = m.measuredAt.split('T')[0] ?? m.measuredAt;
      const existing = groups.get(date);
      if (existing) existing.push(m);
      else groups.set(date, [m]);
    }
    return [...groups.entries()]
      .map(([date, items]) => ({ date, items, ageMonths: items[0]?.ageMonths ?? 0 }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allMeasurements]);

  if (!child) {
    return <div className="flex items-center justify-center h-full" style={{ color: S.sub }}>请先添加孩子档案</div>;
  }

  const handleFileSelect = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      setImagePreview(dataUrl);
      setImageName(file.name);
      setStatus('idle');
      setCandidates([]);
    } catch {
      setError('无法读取图片，请重新选择');
    }
  };

  const handleAnalyze = async () => {
    if (!imagePreview) return;
    setStatus('analyzing');
    setError(null);
    try {
      const result = await analyzeCheckupSheetOCR({ imageUrl: imagePreview });
      if (result.measurements.length === 0) {
        setError('未识别到支持的数据指标，请确认图片清晰且为医疗报告');
        setStatus('idle');
        return;
      }
      setCandidates(result.measurements.map((c) => ({ ...c, selected: true })));
      setStatus('review');
    } catch {
      setError('AI 识别失败，请重试或检查网络连接');
      setStatus('idle');
    }
  };

  const toggleCandidate = (idx: number) => {
    setCandidates((prev) => prev.map((c, i) => i === idx ? { ...c, selected: !c.selected } : c));
  };

  const updateCandidate = (idx: number, field: 'value' | 'measuredAt', val: string) => {
    setCandidates((prev) => prev.map((c, i) =>
      i === idx ? { ...c, [field]: field === 'value' ? Number(val) : val } : c,
    ));
  };

  const handleImport = async () => {
    const selected = candidates.filter((c) => c.selected);
    if (selected.length === 0) { setError('请至少选择一条数据'); return; }

    setStatus('importing');
    setError(null);
    let count = 0;
    try {
      for (const c of selected) {
        const now = isoNow();
        await insertMeasurement({
          measurementId: ulid(),
          childId: child.childId,
          typeId: c.typeId,
          value: c.value,
          measuredAt: c.measuredAt,
          ageMonths: computeAgeMonthsAt(child.birthDate, c.measuredAt),
          percentile: null,
          source: 'ocr',
          notes: c.notes,
          now,
        });
        count++;
      }
      setImportedCount(count);
      setStatus('done');
      reloadMeasurements();
    } catch {
      setError(`导入部分失败，已成功导入 ${count} 条`);
      setStatus('review');
    }
  };

  const reset = () => {
    setStatus('idle');
    setImagePreview(null);
    setImageName(null);
    setCandidates([]);
    setError(null);
    setImportedCount(0);
  };

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>← 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>智能识别报告</h1>
        {reportGroups.length > 0 && (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full" style={{ background: '#f4f7ea', color: S.accent }}>
            {reportGroups.length} 份报告
          </span>
        )}
      </div>
      <p className="text-[12px] mb-4" style={{ color: S.sub }}>
        上传医院报告（体检单、验血单、骨龄报告等），AI 自动提取数据并生成记录
      </p>

      {/* ── Tab toggle ─────────────────────────────────────── */}
      <div className="flex gap-1 rounded-full p-1 mb-5 w-fit" style={{ background: '#eceeed' }}>
        {([['upload', '📄 上传报告'], ['library', '📚 报告库']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setActiveView(k)}
            className="px-4 py-1.5 text-[11px] font-medium rounded-full transition-all"
            style={activeView === k
              ? { background: S.card, color: S.text, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
              : { color: S.sub }}>
            {l}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════
         UPLOAD VIEW
         ════════════════════════════════════════════════════════ */}
      {activeView === 'upload' && <>

      {/* ── Step 1: Upload ──────────────────────────────────── */}
      {status !== 'done' && (
        <div className={`${S.radius} p-6 mb-4`} style={{ background: S.card, boxShadow: S.shadow }}>
          {!imagePreview ? (
            /* Drop zone */
            <label className={`flex flex-col items-center justify-center py-10 border-2 border-dashed ${S.radiusSm} cursor-pointer transition-colors hover:border-[${S.accent}]/50 hover:bg-[#f4f7ea]/30`}
              style={{ borderColor: S.border }}>
              <span className="text-[36px] mb-2">📄</span>
              <p className="text-[13px] font-medium" style={{ color: S.text }}>点击选择或拖放报告图片</p>
              <p className="text-[11px] mt-1" style={{ color: S.sub }}>支持 JPG、PNG 格式</p>
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => void handleFileSelect(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            /* Preview + analyze */
            <div className="flex gap-4">
              <img src={imagePreview} alt="报告预览"
                className={`w-[160px] h-[200px] object-cover ${S.radiusSm} border`}
                style={{ borderColor: S.border }} />
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-[13px] font-medium" style={{ color: S.text }}>{imageName}</p>
                  <p className="text-[11px] mt-1" style={{ color: S.sub }}>
                    {status === 'analyzing' ? '正在识别中，请稍候...' : '图片已就绪，点击开始识别'}
                  </p>
                  {runtimeAvailable === false && (
                    <p className="text-[11px] mt-2 text-amber-600">AI 运行时不可用，无法进行识别</p>
                  )}
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => void handleAnalyze()}
                    disabled={status === 'analyzing' || runtimeAvailable === false}
                    className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm} disabled:opacity-50`}
                    style={{ background: S.accent }}>
                    {status === 'analyzing' ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        识别中...
                      </span>
                    ) : '🔍 开始识别'}
                  </button>
                  <button onClick={reset}
                    className={`px-4 py-2 text-[13px] ${S.radiusSm}`}
                    style={{ background: '#f0f0ec', color: S.sub }}>重新选择</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Error ───────────────────────────────────────────── */}
      {error && (
        <div className={`${S.radiusSm} px-4 py-3 mb-4 text-[12px]`}
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {/* ── Step 2: Review candidates ──────────────────────── */}
      {status === 'review' && candidates.length > 0 && (
        <div className={`${S.radius} p-5 mb-4`} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[14px] font-bold" style={{ color: S.text }}>
                识别到 {candidates.length} 项数据
              </h3>
              <p className="text-[11px] mt-0.5" style={{ color: S.sub }}>
                请确认以下数据，取消不需要的项目
              </p>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: '#f4f7ea', color: S.accent }}>
              已选 {candidates.filter((c) => c.selected).length}/{candidates.length}
            </span>
          </div>

          <div className="space-y-2">
            {candidates.map((c, i) => {
              const info = getDisplayInfo(c.typeId);
              return (
                <div key={i}
                  className={`flex items-center gap-3 p-3 ${S.radiusSm} transition-all cursor-pointer`}
                  style={{
                    background: c.selected ? '#f9faf7' : '#fafafa',
                    border: `1.5px solid ${c.selected ? S.accent : S.border}`,
                    opacity: c.selected ? 1 : 0.5,
                  }}
                  onClick={() => toggleCandidate(i)}>
                  {/* Checkbox */}
                  <div className="w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all"
                    style={c.selected
                      ? { background: S.accent, borderColor: S.accent, color: '#fff' }
                      : { borderColor: '#c5cad0' }}>
                    {c.selected && <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
                  </div>
                  {/* Icon + name */}
                  <span className="text-[18px]">{info.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium" style={{ color: S.text }}>{info.name}</p>
                    {c.notes && <p className="text-[10px] truncate" style={{ color: S.sub }}>{c.notes}</p>}
                  </div>
                  {/* Value (editable) */}
                  <input type="number" value={c.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCandidate(i, 'value', e.target.value)}
                    className={`w-20 text-right text-[14px] font-bold px-2 py-1 ${S.radiusSm}`}
                    style={{ color: S.text, borderColor: S.border, borderWidth: 1, borderStyle: 'solid' }} />
                  <span className="text-[10px] w-12" style={{ color: S.sub }}>{info.unit}</span>
                  {/* Date */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <ProfileDatePicker
                      value={c.measuredAt}
                      onChange={(nextDate) => updateCandidate(i, 'measuredAt', nextDate)}
                      className={`text-[11px] ${S.radiusSm}`}
                      style={{ color: S.sub, borderColor: S.border, borderWidth: 1, borderStyle: 'solid', background: '#fff' }}
                      size="small"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={() => void handleImport()}
              disabled={candidates.filter((c) => c.selected).length === 0}
              className={`flex-1 py-2.5 text-[13px] font-medium text-white ${S.radiusSm} disabled:opacity-50 transition-colors hover:opacity-90`}
              style={{ background: S.accent }}>
              ✅ 确认导入 {candidates.filter((c) => c.selected).length} 条数据
            </button>
            <button onClick={reset}
              className={`px-4 py-2.5 text-[13px] ${S.radiusSm}`}
              style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
          </div>
        </div>
      )}

      {/* ── Importing spinner ──────────────────────────────── */}
      {status === 'importing' && (
        <div className={`${S.radius} p-8 flex flex-col items-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="inline-block w-8 h-8 border-3 border-[#e8e5e0] border-t-[#94A533] rounded-full animate-spin mb-3" />
          <p className="text-[13px]" style={{ color: S.text }}>正在导入数据...</p>
        </div>
      )}

      {/* ── Step 3: Success ────────────────────────────────── */}
      {status === 'done' && (
        <div className={`${S.radius} p-8 flex flex-col items-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <span className="text-[48px] mb-3">🎉</span>
          <h3 className="text-[16px] font-bold" style={{ color: S.text }}>导入成功</h3>
          <p className="text-[12px] mt-1 mb-5" style={{ color: S.sub }}>
            已成功导入 {importedCount} 条数据到 {child.displayName} 的档案
          </p>
          <div className="flex gap-3">
            <button onClick={() => { reset(); setActiveView('library'); }}
              className={`px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm}`}
              style={{ background: S.accent }}>查看报告库</button>
            <button onClick={reset}
              className={`px-5 py-2 text-[13px] ${S.radiusSm}`}
              style={{ background: '#f0f0ec', color: S.sub }}>继续上传</button>
          </div>
        </div>
      )}

      </>}

      {/* ════════════════════════════════════════════════════════
         REPORT LIBRARY VIEW
         ════════════════════════════════════════════════════════ */}
      {activeView === 'library' && (
        <div>
          {reportGroups.length === 0 ? (
            <div className={`${S.radius} p-10 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
              <span className="text-[36px]">📂</span>
              <p className="text-[14px] font-medium mt-3" style={{ color: S.text }}>暂无报告记录</p>
              <p className="text-[11px] mt-1" style={{ color: S.sub }}>上传医院报告后，AI 识别的数据会自动归档到这里</p>
              <button onClick={() => setActiveView('upload')}
                className={`mt-4 px-5 py-2 text-[13px] font-medium text-white ${S.radiusSm}`}
                style={{ background: S.accent }}>去上传报告</button>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[18px] top-0 bottom-0 w-[2px]" style={{ background: S.border }} />

              {reportGroups.map((group) => {
                const ageY = Math.floor(group.ageMonths / 12);
                const ageR = group.ageMonths % 12;
                const ageStr = group.ageMonths < 24 ? `${group.ageMonths}月` : ageR > 0 ? `${ageY}岁${ageR}月` : `${ageY}岁`;

                // Categorize items
                const categories = new Map<string, MeasurementRow[]>();
                for (const item of group.items) {
                  const std = GROWTH_STANDARDS.find((s) => s.typeId === item.typeId);
                  const cat = item.typeId.startsWith('lab-') ? '血检' :
                    item.typeId.includes('vision') || item.typeId.includes('axial') || item.typeId.includes('refraction') || item.typeId.includes('corneal') || item.typeId.includes('iop') || item.typeId.includes('acd') || item.typeId.includes('lt-') ? '眼科' :
                    item.typeId === 'bone-age' ? '骨龄' : '生长';
                  const existing = categories.get(cat);
                  if (existing) existing.push(item);
                  else categories.set(cat, [item]);
                }

                return (
                  <div key={group.date} className="relative pl-10 pb-5">
                    {/* Timeline dot */}
                    <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center"
                      style={{ background: S.card, borderColor: S.accent }}>
                      <div className="w-[6px] h-[6px] rounded-full" style={{ background: S.accent }} />
                    </div>

                    {/* Date header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[13px] font-bold" style={{ color: S.text }}>{group.date}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: '#f4f7ea', color: S.accent }}>{ageStr}</span>
                      <span className="text-[10px]" style={{ color: S.sub }}>{group.items.length} 项数据</span>
                    </div>

                    {/* Report card */}
                    <div className={`${S.radius} overflow-hidden`} style={{ background: S.card, boxShadow: S.shadow }}>
                      {[...categories.entries()].map(([cat, items]) => (
                        <div key={cat}>
                          <div className="px-4 py-2 text-[10px] font-medium" style={{ background: '#f8faf9', color: S.sub }}>
                            {cat === '眼科' ? '👁️' : cat === '血检' ? '🧪' : cat === '骨龄' ? '🦴' : '📏'} {cat}
                          </div>
                          {items.map((item) => {
                            const info = getDisplayInfo(item.typeId);
                            return (
                              <div key={item.measurementId} className="flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: '#f0f0ec' }}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[12px]">{info.emoji}</span>
                                  <span className="text-[11px]" style={{ color: S.text }}>{info.name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[13px] font-bold" style={{ color: S.text }}>{item.value}</span>
                                  <span className="text-[10px]" style={{ color: S.sub }}>{info.unit}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
