import { Button, Surface, TextField } from '@nimiplatform/nimi-kit/ui';
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { insertMeasurement, getMeasurements, saveAttachment, getAttachments, deleteAttachment } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow, AttachmentRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import {
  analyzeCheckupSheetOCR,
  getCheckupOCRDisplayMessage,
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

const OWNER_TABLE_LABELS: Record<string, { label: string; emoji: string }> = {
  dental_records: { label: '口腔记录', emoji: '🦷' },
  growth_measurements: { label: '体检报告', emoji: '📄' },
  medical_events: { label: '就医事件', emoji: '🏥' },
  vaccine_records: { label: '疫苗接种', emoji: '💉' },
  milestone_records: { label: '发育里程碑', emoji: '🎯' },
};

function getDisplayInfo(typeId: string) {
  const std = GROWTH_STANDARDS.find((s) => s.typeId === typeId);
  return { name: std?.displayName ?? typeId, unit: std?.unit ?? '', emoji: TYPE_EMOJI[typeId] ?? '📋' };
}

export default function ReportUploadPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);

  const [runtimeAvailable, setRuntimeAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<OCRMeasurementCandidate & { selected: boolean }>>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [allMeasurements, setAllMeasurements] = useState<MeasurementRow[]>([]);
  const [reportAttachments, setReportAttachments] = useState<Map<string, AttachmentRow>>(new Map());
  const [allAttachments, setAllAttachments] = useState<AttachmentRow[]>([]);
  const [attachFilter, setAttachFilter] = useState<string>('all');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'upload' | 'library' | 'attachments'>('upload');

  useEffect(() => {
    hasCheckupOCRRuntime().then(setRuntimeAvailable).catch(catchLogThen('report-upload', 'action:check-ocr-runtime-failed', () => setRuntimeAvailable(false)));
  }, []);

  useEffect(() => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setAllMeasurements).catch(catchLog('report-upload', 'action:load-measurements-failed'));
    loadAllAttachments(activeChildId);
  }, [activeChildId]);

  const loadAllAttachments = (childId: string) => {
    getAttachments(childId).then((all) => {
      setAllAttachments(all);
      const m = new Map<string, AttachmentRow>();
      for (const a of all) {
        if (a.ownerTable === 'health_record_events' && a.ownerId.startsWith('detail-measurement:')) {
          m.set(a.ownerId.slice('detail-measurement:'.length), a);
        }
      }
      setReportAttachments(m);
    }).catch(catchLog('report-upload', 'action:load-attachments-failed'));
  };

  const reloadMeasurements = () => {
    if (!activeChildId) return;
    getMeasurements(activeChildId).then(setAllMeasurements).catch(catchLog('report-upload', 'action:load-measurements-failed'));
    loadAllAttachments(activeChildId);
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

  // Attachments view data
  const filteredAttachments = useMemo(
    () => attachFilter === 'all' ? allAttachments : allAttachments.filter((a) => a.ownerTable === attachFilter),
    [allAttachments, attachFilter],
  );
  const attachGroups = useMemo(() => {
    const m = new Map<string, AttachmentRow[]>();
    for (const a of filteredAttachments) {
      const date = a.createdAt.split('T')[0] ?? a.createdAt;
      const existing = m.get(date);
      if (existing) existing.push(a);
      else m.set(date, [a]);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredAttachments]);
  const attachOwnerTables = useMemo(
    () => [...new Set(allAttachments.map((a) => a.ownerTable))],
    [allAttachments],
  );

  const handleDeleteAttachment = async (id: string) => {
    try {
      await deleteAttachment(id);
      setAllAttachments((prev) => prev.filter((a) => a.attachmentId !== id));
    } catch { /* ignore */ }
  };

  if (!child) {
    return <div className="flex items-center justify-center h-full text-[var(--nimi-text-muted)]">请先添加孩子档案</div>;
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
    } catch (_error) {
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
    } catch (error) {
      setError('AI 识别失败，请重试或检查网络连接');
      setError(getCheckupOCRDisplayMessage(error));
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
    let firstMeasurementId: string | null = null;
    try {
      for (const c of selected) {
        const now = isoNow();
        const measurementId = ulid();
        if (!firstMeasurementId) firstMeasurementId = measurementId;
        await insertMeasurement({
          measurementId,
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

      // Save original report image as attachment
      if (imagePreview && firstMeasurementId) {
        try {
          const [header, base64] = imagePreview.split(',');
          const mimeMatch = header?.match(/data:([^;]+)/);
          const mimeType = mimeMatch?.[1] ?? 'image/jpeg';
          await saveAttachment({
            attachmentId: ulid(), childId: child.childId,
            ownerTable: 'health_record_events', ownerId: `detail-measurement:${firstMeasurementId}`,
            fileName: imageName ?? 'report.jpg', mimeType,
            imageBase64: base64 ?? '', caption: null, now: isoNow(),
          });
        } catch { /* attachment save failed, non-critical */ }
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
    <div className="max-w-3xl mx-auto min-h-full px-6 pb-6 pt-[72px]">
      <div className="flex items-center gap-2 mb-5">
        <Link to="/profile" className="text-[14px] hover:underline text-[var(--nimi-text-muted)]">← 返回档案</Link>
      </div>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-xl font-bold text-[var(--nimi-text-primary)]">智能识别 & 影像档案</h1>
        <div className="flex items-center gap-2">
          {reportGroups.length > 0 && (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] px-2.5 py-0.5 text-[13px] text-[var(--nimi-action-primary-bg)]">
              {reportGroups.length} 份报告
            </span>
          )}
          {allAttachments.length > 0 && (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,var(--nimi-surface-card))] px-2.5 py-0.5 text-[13px] text-[var(--nimi-status-info)]">
              {allAttachments.length} 张影像
            </span>
          )}
        </div>
      </div>
      <p className="text-[14px] mb-4 text-[var(--nimi-text-muted)]">
        上传医院报告自动提取数据，所有影像资料统一归档
      </p>

      {/* ── Tab toggle ─────────────────────────────────────── */}
      <div className="flex gap-1 rounded-full bg-[var(--nimi-action-ghost-hover)] p-1 mb-5 w-fit">
        {([['upload', '📄 上传报告'], ['library', '📚 报告库'], ['attachments', '🖼️ 影像档案']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setActiveView(k)}
            className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-all ${activeView === k ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]' : 'text-[var(--nimi-text-muted)]'}`}>
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
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="mb-4 rounded-3xl">
          {!imagePreview ? (
            /* Drop zone */
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--nimi-border-subtle)] py-10 transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)]">
              <span className="text-[36px] mb-2">📄</span>
              <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">点击选择或拖放报告图片</p>
              <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">支持 JPG、PNG 格式</p>
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => void handleFileSelect(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            /* Preview + analyze */
            <div className="flex gap-4">
              <img src={imagePreview} alt="报告预览"
                className="w-[160px] h-[200px] rounded-2xl border border-[var(--nimi-border-subtle)] object-cover" />
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{imageName}</p>
                  <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">
                    {status === 'analyzing' ? '正在识别中，请稍候...' : '图片已就绪，点击开始识别'}
                  </p>
                  {runtimeAvailable === false && (
                    <p className="text-[13px] mt-2 text-amber-600">AI 运行时不可用，无法进行识别</p>
                  )}
                </div>
                <div className="flex gap-2 mt-3">
                  <Button onClick={() => void handleAnalyze()}
                    disabled={status === 'analyzing' || runtimeAvailable === false}
                    tone="primary"
                    size="md">
                    {status === 'analyzing' ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-3.5 h-3.5 border-2 border-[color-mix(in_srgb,var(--nimi-action-primary-text)_30%,transparent)] border-t-[var(--nimi-action-primary-text)] rounded-full animate-spin" />
                        识别中...
                      </span>
                    ) : '🔍 开始识别'}
                  </Button>
                  <Button onClick={reset} tone="ghost" size="md">重新选择</Button>
                </div>
              </div>
            </div>
          )}
        </Surface>
      )}

      {/* ── Error ───────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-4 py-3 text-[14px] text-[var(--nimi-status-danger)]">
          {error}
        </div>
      )}

      {/* ── Step 2: Review candidates ──────────────────────── */}
      {status === 'review' && candidates.length > 0 && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="mb-4 rounded-3xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">
                识别到 {candidates.length} 项数据
              </h3>
              <p className="text-[13px] mt-0.5 text-[var(--nimi-text-muted)]">
                请确认以下数据，取消不需要的项目
              </p>
            </div>
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] px-2 py-0.5 text-[13px] text-[var(--nimi-action-primary-bg)]">
              已选 {candidates.filter((c) => c.selected).length}/{candidates.length}
            </span>
          </div>

          <div className="space-y-2">
            {candidates.map((c, i) => {
              const info = getDisplayInfo(c.typeId);
              return (
                <div key={i}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-all ${c.selected ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))]' : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] opacity-50'}`}
                  onClick={() => toggleCandidate(i)}>
                  {/* Checkbox */}
                  <div className={`w-[20px] h-[20px] rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${c.selected ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]' : 'border-[var(--nimi-border-strong)]'}`}>
                    {c.selected && <svg viewBox="0 0 12 12" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}
                  </div>
                  {/* Icon + name */}
                  <span className="text-[18px]">{info.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{info.name}</p>
                    {c.notes && <p className="text-[12px] truncate text-[var(--nimi-text-muted)]">{c.notes}</p>}
                  </div>
                  {/* Value (editable) */}
                  <TextField type="number" value={c.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCandidate(i, 'value', e.target.value)}
                    className="w-20"
                    inputClassName="text-right text-[16px] font-bold text-[var(--nimi-text-primary)]" />
                  <span className="text-[12px] w-12 text-[var(--nimi-text-muted)]">{info.unit}</span>
                  {/* Date */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <ProfileDatePicker
                      value={c.measuredAt}
                      onChange={(nextDate) => updateCandidate(i, 'measuredAt', nextDate)}
                      className="text-[13px]"
                      size="small"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 mt-4">
            <Button onClick={() => void handleImport()}
              disabled={candidates.filter((c) => c.selected).length === 0}
              tone="primary"
              size="md"
              fullWidth>
              ✅ 确认导入 {candidates.filter((c) => c.selected).length} 条数据
            </Button>
            <Button onClick={reset} tone="ghost" size="md">取消</Button>
          </div>
        </Surface>
      )}

      {/* ── Importing spinner ──────────────────────────────── */}
      {status === 'importing' && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="flex flex-col items-center rounded-3xl p-8">
          <span className="inline-block w-8 h-8 border-3 border-[var(--nimi-border-subtle)] border-t-[var(--nimi-text-primary)] rounded-full animate-spin mb-3" />
          <p className="text-[14px] text-[var(--nimi-text-primary)]">正在导入数据...</p>
        </Surface>
      )}

      {/* ── Step 3: Success ────────────────────────────────── */}
      {status === 'done' && (
        <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="flex flex-col items-center rounded-3xl p-8">
          <span className="text-[48px] mb-3">🎉</span>
          <h3 className="text-[16px] font-bold text-[var(--nimi-text-primary)]">导入成功</h3>
          <p className="text-[14px] mt-1 mb-5 text-[var(--nimi-text-muted)]">
            已成功导入 {importedCount} 条数据到 {child.displayName} 的档案
          </p>
          <div className="flex gap-3">
            <Button onClick={() => { reset(); setActiveView('library'); }} tone="primary" size="md">查看报告库</Button>
            <Button onClick={reset} tone="ghost" size="md">继续上传</Button>
          </div>
        </Surface>
      )}

      </>}

      {/* ════════════════════════════════════════════════════════
         REPORT LIBRARY VIEW
         ════════════════════════════════════════════════════════ */}
      {activeView === 'library' && (
        <div>
          {reportGroups.length === 0 ? (
            <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-10 text-center">
              <span className="text-[36px]">📂</span>
              <p className="text-[16px] font-medium mt-3 text-[var(--nimi-text-primary)]">暂无报告记录</p>
              <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">通过智能识别提取的数据会自动归档到这里</p>
            </Surface>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[18px] top-0 bottom-0 w-[2px] bg-[var(--nimi-border-subtle)]" />

              {reportGroups.map((group) => {
                const ageY = Math.floor(group.ageMonths / 12);
                const ageR = group.ageMonths % 12;
                const ageStr = group.ageMonths < 24 ? `${group.ageMonths}月` : ageR > 0 ? `${ageY}岁${ageR}月` : `${ageY}岁`;

                // Categorize items
                const categories = new Map<string, MeasurementRow[]>();
                for (const item of group.items) {
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
                    <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-card)] flex items-center justify-center">
                      <div className="w-[6px] h-[6px] rounded-full bg-[var(--nimi-action-primary-bg)]" />
                    </div>

                    {/* Date header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[14px] font-bold text-[var(--nimi-text-primary)]">{group.date}</span>
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] px-2 py-0.5 text-[12px] text-[var(--nimi-action-primary-bg)]">{ageStr}</span>
                      <span className="text-[12px] text-[var(--nimi-text-muted)]">{group.items.length} 项数据</span>
                    </div>

                    {/* Report card */}
                    <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="overflow-hidden rounded-3xl">
                      {[...categories.entries()].map(([cat, items]) => (
                        <div key={cat}>
                          <div className="bg-[var(--nimi-surface-panel)] px-4 py-2 text-[12px] font-medium text-[var(--nimi-text-muted)]">
                            {cat === '眼科' ? '👁️' : cat === '血检' ? '🧪' : cat === '骨龄' ? '🦴' : '📏'} {cat}
                          </div>
                          {items.map((item) => {
                            const info = getDisplayInfo(item.typeId);
                            return (
                              <div key={item.measurementId} className="flex items-center justify-between border-t border-[var(--nimi-border-subtle)] px-4 py-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px]">{info.emoji}</span>
                                  <span className="text-[13px] text-[var(--nimi-text-primary)]">{info.name}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <span className="text-[14px] font-bold text-[var(--nimi-text-primary)]">{item.value}</span>
                                  <span className="text-[12px] text-[var(--nimi-text-muted)]">{info.unit}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      {/* Original report image thumbnail */}
                      {(() => {
                        const att = group.items.map((m) => reportAttachments.get(m.measurementId)).find(Boolean);
                        return att ? (
                          <div className="flex items-center gap-2 border-t border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-2.5">
                            <img src={convertFileSrc(att.filePath)} alt={att.fileName}
                              className="h-16 w-12 rounded-2xl border border-[var(--nimi-border-subtle)] object-cover" />
                            <div>
                              <p className="text-[12px] font-medium text-[var(--nimi-text-muted)]">原始报告</p>
                              <p className="text-[12px] text-[var(--nimi-text-muted)]">{att.fileName}</p>
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </Surface>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
         ATTACHMENTS VIEW
         ════════════════════════════════════════════════════════ */}
      {activeView === 'attachments' && (
        <div>
          {/* Source filter */}
          {attachOwnerTables.length > 1 && (
            <div className="flex gap-1 rounded-full bg-[var(--nimi-action-ghost-hover)] p-1 mb-4 w-fit">
              <button onClick={() => setAttachFilter('all')}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${attachFilter === 'all' ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]' : 'text-[var(--nimi-text-muted)]'}`}>
                全部
              </button>
              {attachOwnerTables.map((ot) => {
                const meta = OWNER_TABLE_LABELS[ot];
                return (
                  <button key={ot} onClick={() => setAttachFilter(ot)}
                    className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${attachFilter === ot ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]' : 'text-[var(--nimi-text-muted)]'}`}>
                    {meta ? `${meta.emoji} ${meta.label}` : ot}
                  </button>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {allAttachments.length === 0 && (
            <Surface tone="card" material="glass-regular" elevation="raised" padding="lg" className="rounded-3xl p-10 text-center">
              <span className="text-[36px]">📂</span>
              <p className="text-[16px] font-medium mt-3 text-[var(--nimi-text-primary)]">暂无影像资料</p>
              <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">各模块上传的照片和报告等原图均会在此统一存档</p>
            </Surface>
          )}

          {/* Timeline grid */}
          {attachGroups.length > 0 && (
            <div className="relative">
              <div className="absolute left-[18px] top-0 bottom-0 w-[2px] bg-[var(--nimi-border-subtle)]" />

              {attachGroups.map(([date, items]) => (
                <div key={date} className="relative pl-10 pb-5">
                  <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-card)] flex items-center justify-center">
                    <div className="w-[6px] h-[6px] rounded-full bg-[var(--nimi-action-primary-bg)]" />
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[14px] font-bold text-[var(--nimi-text-primary)]">{date}</span>
                    <span className="text-[12px] text-[var(--nimi-text-muted)]">{items.length} 张</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {items.map((a) => {
                      const meta = OWNER_TABLE_LABELS[a.ownerTable];
                      return (
                        <Surface key={a.attachmentId} tone="card" material="glass-regular" elevation="raised" padding="none" className="group relative overflow-hidden rounded-3xl">
                          <img
                            src={convertFileSrc(a.filePath)}
                            alt={a.fileName}
                            className="w-full h-28 object-cover cursor-pointer"
                            onClick={() => setPreviewUrl(convertFileSrc(a.filePath))}
                          />
                          <div className="px-2.5 py-2">
                            <p className="text-[12px] truncate text-[var(--nimi-text-primary)]">{a.fileName}</p>
                            <p className="text-[12px] mt-0.5 text-[var(--nimi-text-muted)]">
                              {meta ? `${meta.emoji} ${meta.label}` : a.ownerTable}
                            </p>
                          </div>
                          <button
                            onClick={() => void handleDeleteAttachment(a.attachmentId)}
                            className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--nimi-surface-overlay)] text-[12px] text-[var(--nimi-text-primary)] opacity-0 shadow-[var(--nimi-elevation-base)] transition-opacity group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        </Surface>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fullscreen preview modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--nimi-scrim-modal)]"
          onClick={() => setPreviewUrl(null)}>
          <img src={previewUrl} alt="preview" className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" />
          <button onClick={() => setPreviewUrl(null)}
            className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--nimi-surface-overlay)] text-[16px] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-floating)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
