import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { computeAgeMonths, computeAgeMonthsAt, formatAge, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements, insertMeasurement, updateMeasurement, deleteMeasurement } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { canRenderWHOLMS, loadWHOLMS, type WHOLMSDataset, type GrowthStandard } from './who-lms-loader.js';
import { AISummaryCard } from './ai-summary-card.js';
import {
  analyzeCheckupSheetOCR,
  hasCheckupOCRRuntime,
  readImageFileAsDataUrl,
} from './checkup-ocr.js';
import { GrowthCurveAddRecordModal } from './growth-curve-add-record-modal.js';
import { GrowthCurveChartPanel } from './growth-curve-chart-panel.js';
import { GrowthCurveControls } from './growth-curve-controls.js';
import { GrowthCurveHistoryTable } from './growth-curve-history-table.js';
import { GrowthCurveOCRPanel, type GrowthCurveOCRCandidate } from './growth-curve-ocr-panel.js';
import {
  buildGrowthSummaryContext,
  computeBMI,
  getLatestMeasurement,
} from './growth-curve-page-shared.js';

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
  const [ocrCandidates, setOCRCandidates] = useState<GrowthCurveOCRCandidate[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
  const availableTypes = GROWTH_STANDARDS.filter(
    (standard) => ageMonths >= standard.ageRange.startMonths && ageMonths <= standard.ageRange.endMonths,
  );
  const canShowWhoLines = canRenderWHOLMS(whoDataset, ageMonths);

  const resetAddRecordDraft = () => {
    setShowForm(false);
    setFormHeight('');
    setFormWeight('');
    setFormHeadCirc('');
    setFormNotes('');
    setFormPhotoPreview(null);
  };

  const refreshMeasurements = async () => {
    setMeasurements(await getMeasurements(child.childId));
  };

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
      await refreshMeasurements();
      resetAddRecordDraft();
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

  const handleEditMeasurement = (measurement: MeasurementRow) => {
    setEditingId(measurement.measurementId);
    setEditValue(String(measurement.value));
    setEditDate(measurement.measuredAt.split('T')[0] || '');
  };

  const handleSaveEdit = async (measurement: MeasurementRow) => {
    const nextValue = parseFloat(editValue);
    if (Number.isNaN(nextValue)) return;
    const age = computeAgeMonthsAt(child.birthDate, editDate);
    try {
      await updateMeasurement({
        measurementId: measurement.measurementId,
        value: nextValue,
        measuredAt: editDate,
        ageMonths: age,
        percentile: measurement.percentile,
        source: measurement.source,
        notes: measurement.notes,
        now: isoNow(),
      });
      await refreshMeasurements();
      setEditingId(null);
    } catch { /* bridge unavailable */ }
  };

  const handleDeleteMeasurement = async (measurementId: string) => {
    try {
      await deleteMeasurement(measurementId);
      await refreshMeasurements();
    } catch { /* bridge unavailable */ }
    setDeletingId(null);
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
      await refreshMeasurements();
      resetOCRDraft();
      setShowOCR(false);
    } catch {
      setOCRError('导入失败，请确认 OCR 候选并重试。');
    }
  };

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
        dataContext={buildGrowthSummaryContext(measurements, computedBmi)}
      />
      <GrowthCurveControls
        measurements={measurements}
        selectedType={selectedType}
        ageMonths={ageMonths}
        availableTypes={availableTypes}
        growthStandard={growthStandard}
        onSelectType={setSelectedType}
        onSelectGrowthStandard={setGrowthStandard}
      />

      <GrowthCurveChartPanel
        chartData={chartData}
        selectedType={selectedType}
        typeInfo={typeInfo}
        whoDataset={whoDataset}
        canShowWhoLines={canShowWhoLines}
        growthStandard={growthStandard}
        measurements={measurements}
        ageMonths={ageMonths}
      />

      <div className="flex flex-wrap gap-3">
        {showForm ? (
        <GrowthCurveAddRecordModal
          formDate={formDate}
          setFormDate={setFormDate}
          formHeight={formHeight}
          setFormHeight={setFormHeight}
          formWeight={formWeight}
          setFormWeight={setFormWeight}
          formHeadCirc={formHeadCirc}
          setFormHeadCirc={setFormHeadCirc}
          formNotes={formNotes}
          setFormNotes={setFormNotes}
          formPhotoPreview={formPhotoPreview}
          isUnder6={isUnder6}
          onPhotoChange={handlePhotoChange}
          onSave={() => void handleAddRecord()}
          onClose={resetAddRecordDraft}
        />
        ) : null}

        {showOCR ? (
          <GrowthCurveOCRPanel
            ocrRuntimeAvailable={ocrRuntimeAvailable}
            ocrImageName={ocrImageName}
            hasOCRImage={Boolean(ocrImageDataUrl)}
            ocrStatus={ocrStatus}
            ocrError={ocrError}
            ocrCandidates={ocrCandidates}
            onClose={() => {
              setShowOCR(false);
              resetOCRDraft();
            }}
            onFileChange={(file) => void handleOCRFileChange(file)}
            onAnalyze={() => void handleOCRAnalyze()}
            onReset={resetOCRDraft}
            onToggleCandidate={(index, selected) => {
              setOCRCandidates((previous) =>
                previous.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, selected } : item,
                ),
              );
            }}
            onChangeCandidateType={(index, typeId) => {
              setOCRCandidates((previous) =>
                previous.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, typeId } : item,
                ),
              );
            }}
            onChangeCandidateValue={(index, value) => {
              setOCRCandidates((previous) =>
                previous.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, value } : item,
                ),
              );
            }}
            onChangeCandidateDate={(index, measuredAt) => {
              setOCRCandidates((previous) =>
                previous.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, measuredAt } : item,
                ),
              );
            }}
            onImport={() => void handleImportOCR()}
          />
        ) : null}
      </div>

      <GrowthCurveHistoryTable
        typeMeasurements={typeMeasurements}
        typeInfo={typeInfo}
        whoDataset={whoDataset}
        editingId={editingId}
        editValue={editValue}
        editDate={editDate}
        deletingId={deletingId}
        onAnalyze={navigateToAI}
        onStartEdit={handleEditMeasurement}
        onEditValueChange={setEditValue}
        onEditDateChange={setEditDate}
        onSaveEdit={(measurement) => void handleSaveEdit(measurement)}
        onCancelEdit={() => setEditingId(null)}
        onRequestDelete={setDeletingId}
        onCancelDelete={() => setDeletingId(null)}
        onConfirmDelete={(measurementId) => void handleDeleteMeasurement(measurementId)}
      />
    </div>
  );
}
