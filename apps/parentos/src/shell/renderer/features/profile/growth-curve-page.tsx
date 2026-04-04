import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeAgeMonths, computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements, insertMeasurement } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { canRenderWHOLMS, loadWHOLMS, PERCENTILE_COLORS, type WHOLMSDataset } from './who-lms-loader.js';
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
    label: '眼健康',
    typeIds: [
      'vision-left', 'vision-right', 'corrected-vision-left', 'corrected-vision-right',
      'refraction-sph-left', 'refraction-sph-right', 'refraction-cyl-left', 'refraction-cyl-right',
      'refraction-axis-left', 'refraction-axis-right', 'axial-length-left', 'axial-length-right',
      'corneal-curvature-left', 'corneal-curvature-right', 'hyperopia-reserve',
    ],
  },
  {
    label: '实验室检查',
    typeIds: [
      'lab-vitamin-d', 'lab-ferritin', 'lab-hemoglobin', 'lab-calcium', 'lab-zinc',
    ],
  },
];

export default function GrowthCurvePage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const [selectedType, setSelectedType] = useState('height');
  const [showForm, setShowForm] = useState(false);
  const [formValue, setFormValue] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
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

  if (!child) {
    return <div className="p-8 text-gray-500">Please add a child profile first.</div>;
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

  const handleAdd = async () => {
    if (!formValue || !formDate) {
      return;
    }

    const ageMonths = computeAgeMonthsAt(child.birthDate, formDate);
    const now = isoNow();
    try {
      await insertMeasurement({
        measurementId: ulid(),
        childId: child.childId,
        typeId: selectedType,
        value: parseFloat(formValue),
        measuredAt: formDate,
        ageMonths,
        percentile: null,
        source: 'manual',
        notes: null,
        now,
      });
      const updated = await getMeasurements(child.childId);
      setMeasurements(updated);
      setShowForm(false);
      setFormValue('');
    } catch {
      // bridge unavailable
    }
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

  const ageMonths = computeAgeMonths(child.birthDate);
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
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-gray-400 hover:text-gray-600 text-sm">
          &larr; Back to profile
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Growth Curves</h1>

      <div className="mb-4">
        <select
          value={selectedType}
          onChange={(event) => setSelectedType(event.target.value)}
          className="border rounded-lg px-3 py-1.5 text-sm"
        >
          {TYPE_GROUPS.map((group) => {
            const groupTypes = group.typeIds
              .map((typeId) => availableTypes.find((standard) => standard.typeId === typeId))
              .filter(Boolean);
            if (groupTypes.length === 0) return null;
            return (
              <optgroup key={group.label} label={group.label}>
                {groupTypes.map((standard) => (
                  <option key={standard!.typeId} value={standard!.typeId}>
                    {standard!.displayName} ({standard!.unit})
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>

      <div className="border rounded-lg p-4 mb-6">
        {chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-gray-400">
            <p>No {typeInfo?.displayName ?? selectedType} data yet. Add a measurement below.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="age" label={{ value: 'Months', position: 'insideBottom', offset: -5 }} />
              <YAxis label={{ value: typeInfo?.unit ?? '', angle: -90, position: 'insideLeft' }} />
              <Tooltip
                formatter={(value: number) => [`${value} ${typeInfo?.unit}`, typeInfo?.displayName]}
                labelFormatter={(age) => `${age} months`}
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
        <p className="text-xs text-gray-400 mt-2">Note: {referenceNote}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {showForm ? (
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="font-medium text-sm">Record {typeInfo?.displayName}</h3>
          <div className="flex gap-3">
            <input
              type="number"
              step={typeInfo?.precision === 2 ? '0.01' : '0.1'}
              placeholder={`Value (${typeInfo?.unit})`}
              value={formValue}
              onChange={(event) => setFormValue(event.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm flex-1"
            />
            <input
              type="date"
              value={formDate}
              onChange={(event) => setFormDate(event.target.value)}
              className="border rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              Save
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>
        ) : (
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
        >
          + Record measurement
        </button>
        )}

        {showOCR ? (
          <div className="w-full border rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium text-sm">Import from health sheet (OCR)</h3>
                <p className="text-xs text-gray-500">
                  Extracts structured growth measurements only. Nothing is saved until you confirm the candidates.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowOCR(false);
                  resetOCRDraft();
                }}
                className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-md"
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
                <p className="text-xs text-gray-500" data-testid="ocr-image-name">
                  已选择：{ocrImageName}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => void handleOCRAnalyze()}
                  disabled={!ocrImageDataUrl || ocrRuntimeAvailable === false || ocrStatus === 'analyzing'}
                  className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-md disabled:opacity-50"
                >
                  {ocrStatus === 'analyzing' ? 'Analyzing...' : 'Analyze sheet'}
                </button>
                <button
                  onClick={resetOCRDraft}
                  className="px-4 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-md"
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
                  <p className="text-sm text-gray-500">未识别到可导入的受支持测量值。</p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {ocrCandidates.map((candidate, index) => (
                        <div key={`${candidate.typeId}-${index}`} className="rounded-md border p-3 space-y-2">
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
                              className="border rounded-md px-3 py-1.5 text-sm"
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
                              className="border rounded-md px-3 py-1.5 text-sm"
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
                              className="border rounded-md px-3 py-1.5 text-sm"
                            />
                          </div>
                          {candidate.notes && (
                            <p className="text-xs text-gray-500">{candidate.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => void handleImportOCR()}
                      className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                      Import selected OCR measurements
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShowOCR(true)}
            className="px-4 py-2 text-sm bg-slate-700 text-white rounded-md hover:bg-slate-800"
          >
            + Import from health sheet (OCR)
          </button>
        )}
      </div>

      {typeMeasurements.length > 0 && (
        <div className="mt-6">
          <h3 className="font-medium text-sm mb-2">History</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Date</th>
                <th className="pb-2">Age</th>
                <th className="pb-2">Value</th>
                <th className="pb-2">Source</th>
                <th className="pb-2">Percentile</th>
              </tr>
            </thead>
            <tbody>
              {typeMeasurements
                .slice()
                .reverse()
                .map((measurement) => (
                  <tr key={measurement.measurementId} className="border-b last:border-0">
                    <td className="py-2">{measurement.measuredAt.split('T')[0]}</td>
                    <td>{measurement.ageMonths}m</td>
                    <td>
                      {measurement.value} {typeInfo?.unit}
                    </td>
                    <td>{measurement.source ?? '-'}</td>
                    <td>{measurement.percentile != null ? `P${Math.round(measurement.percentile)}` : '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
