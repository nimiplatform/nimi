import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { insertMedicalEvent, updateMedicalEvent, getMedicalEvents, getAppSetting, setAppSetting } from '../../bridge/sqlite-bridge.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { analyzeMedicalEvents } from '../../engine/smart-alerts.js';
import type { MedicalAnalysis, MedicalAlert } from '../../engine/smart-alerts.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { filterAIResponse } from '../../engine/ai-safety-filter.js';
import { resolveParentosTextGenerateConfig } from '../settings/parentos-ai-runtime.js';
import { ProfileDatePicker } from './profile-date-picker.js';
import { DrugComboBox, type DrugSelection } from './drug-combobox.js';
import { readImageFileAsDataUrl } from './checkup-ocr.js';

/* ── Event type config ── */

/**
 * 就医场景分类（互斥、不重叠）:
 *   门诊 — 普通看病（含诊断、开药）
 *   急诊 — 紧急就医（外伤、骨折、急症等）
 *   住院 — 住院治疗（含手术）
 *   体检 — 常规体检、专项筛查（听力/视力等）
 *   用药 — 独立的长期/居家用药记录（非就诊开药）
 *   其他 — 不属于以上场景
 *
 * 诊断结果 → title 字段
 * 处方/用药 → medication + dosage 字段
 * 外伤/骨折/皮肤 → title 中描述，severity 字段标注严重程度
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  visit: '门诊',
  emergency: '急诊',
  hospitalization: '住院',
  checkup: '体检',
  medication: '用药',
  'lab-report': '检验报告',
  other: '其他',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  visit: '#6366f1',
  emergency: '#ef4444',
  hospitalization: '#f59e0b',
  checkup: '#3b82f6',
  medication: '#10b981',
  'lab-report': '#8b5cf6',
  other: '#6b7280',
};

const EVENT_TYPE_ICONS: Record<string, string> = {
  visit: '🏥',
  emergency: '🚑',
  hospitalization: '🛏️',
  checkup: '🩺',
  medication: '💊',
  'lab-report': '🧪',
  other: '📋',
};

/* ── Lab report definitions ── */

interface LabRange { max: number; color: string; label: string }
interface LabItem { key: string; label: string; unit: string; ranges: LabRange[] }

const LAB_ITEMS: LabItem[] = [
  { key: 'vitamin-d', label: '维生素D', unit: 'ng/mL', ranges: [
    { max: 12, color: '#dc2626', label: '严重缺乏' }, { max: 20, color: '#f59e0b', label: '缺乏' },
    { max: 30, color: '#eab308', label: '不足' }, { max: 100, color: '#22c55e', label: '充足' },
  ]},
  { key: 'ferritin', label: '铁蛋白', unit: 'ng/mL', ranges: [
    { max: 12, color: '#dc2626', label: '耗竭' }, { max: 30, color: '#f59e0b', label: '不足' }, { max: 150, color: '#22c55e', label: '正常' },
  ]},
  { key: 'hemoglobin', label: '血红蛋白', unit: 'g/L', ranges: [
    { max: 110, color: '#dc2626', label: '贫血' }, { max: 120, color: '#f59e0b', label: '偏低' }, { max: 160, color: '#22c55e', label: '正常' },
  ]},
  { key: 'calcium', label: '血钙', unit: 'mmol/L', ranges: [
    { max: 2.20, color: '#dc2626', label: '偏低' }, { max: 2.70, color: '#22c55e', label: '正常' }, { max: Infinity, color: '#f59e0b', label: '偏高' },
  ]},
  { key: 'zinc', label: '血锌', unit: 'μmol/L', ranges: [
    { max: 10.7, color: '#dc2626', label: '缺乏' }, { max: 17.6, color: '#22c55e', label: '正常' }, { max: Infinity, color: '#f59e0b', label: '偏高' },
  ]},
];

interface LabReportData { type: 'lab-report'; values: Record<string, number | null> }

function parseLabReport(notes: string | null): LabReportData | null {
  if (!notes) return null;
  try { const p = JSON.parse(notes) as Record<string, unknown>; return p.type === 'lab-report' ? p as unknown as LabReportData : null; } catch { return null; }
}

function labRangeFor(item: LabItem, value: number): LabRange {
  return item.ranges.find((r) => value <= r.max) ?? item.ranges[item.ranges.length - 1]!;
}

const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe'] as const;
const SEVERITY_LABELS: Record<string, string> = { mild: '轻度', moderate: '中度', severe: '重度' };
const SEVERITY_COLORS: Record<string, string> = { mild: '#22c55e', moderate: '#f59e0b', severe: '#ef4444' };
const RESULT_OPTIONS = ['pass', 'refer', 'fail'] as const;
const RESULT_LABELS: Record<string, string> = { pass: '通过', refer: '转诊', fail: '未通过' };

const COMMON_SYMPTOMS = ['发烧', '咳嗽', '流鼻涕', '呕吐', '腹泻', '皮疹', '腹痛', '头痛'] as const;

/** Visit type options for segmented control (subset of EVENT_TYPE_LABELS) */
const VISIT_TYPES = ['visit', 'emergency', 'hospitalization', 'checkup', 'medication', 'lab-report', 'other'] as const;

const ALERT_STYLES: Record<MedicalAlert['level'], { bg: string; border: string; icon: string }> = {
  danger: { bg: '#fef2f2', border: '#fca5a5', icon: '🚨' },
  warning: { bg: '#fffbeb', border: '#fcd34d', icon: '⚠️' },
  info: { bg: '#eff6ff', border: '#93c5fd', icon: 'ℹ️' },
};

/* ── Helpers ── */

/** Group events by YYYY-MM for timeline sections */
function groupByMonth(events: MedicalEventRow[]): [string, MedicalEventRow[]][] {
  const map = new Map<string, MedicalEventRow[]>();
  for (const ev of events) {
    const ym = ev.eventDate.slice(0, 7); // "2026-04"
    const list = map.get(ym);
    if (list) list.push(ev);
    else map.set(ym, [ev]);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y} 年 ${parseInt(m!, 10)} 月`;
}

export default function MedicalEventsPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [events, setEvents] = useState<MedicalEventRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state — default to "visit" (most common)
  const [formEventType, setFormEventType] = useState('visit');
  const [formTitle, setFormTitle] = useState('');
  const [formEventDate, setFormEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [formEndDate, setFormEndDate] = useState('');
  const [formSeverity, setFormSeverity] = useState('');
  const [formResult, setFormResult] = useState('');
  const [formHospital, setFormHospital] = useState('');
  const [formMedication, setFormMedication] = useState('');
  const [formDosage, setFormDosage] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formLabValues, setFormLabValues] = useState<Record<string, string>>({});
  const [formSymptomTags, setFormSymptomTags] = useState<Set<string>>(new Set());
  const [formMeds, setFormMeds] = useState<Array<{ name: string; dose: string; unit: string; frequency: string; days: string; tags: string[] }>>([]);
  const [formShowEndDate, setFormShowEndDate] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrImageName, setOcrImageName] = useState<string | null>(null);
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventAiLoading, setEventAiLoading] = useState<string | null>(null);
  const [eventAiResult, setEventAiResult] = useState<Record<string, string>>({});

  useEffect(() => {
    if (activeChildId) {
      getMedicalEvents(activeChildId).then(setEvents).catch(catchLog('medical-events', 'action:load-medical-events-failed'));
    }
  }, [activeChildId]);

  // ── Local smart analysis ──
  const analysis: MedicalAnalysis | null = useMemo(
    () => (events.length > 0 ? analyzeMedicalEvents(events) : null),
    [events],
  );

  // ── AI deep insight ──
  const generateAIInsight = useCallback(async (skipCache = false) => {
    if (!child || !analysis || events.length === 0) return;
    const cacheKeyStr = `medical_insight_${child.childId}`;

    if (!skipCache) {
      try {
        const cached = await getAppSetting(cacheKeyStr);
        if (cached) {
          const parsed = JSON.parse(cached) as { text: string; ts: string };
          if (Date.now() - new Date(parsed.ts).getTime() < 24 * 60 * 60 * 1000) {
            setAiInsight(parsed.text);
            return;
          }
        }
      } catch { /* no cache */ }
    }

    setAiLoading(true);
    try {
      const diagSummary = analysis.diagnoses.slice(0, 10)
        .map((d) => `${d.diagnosis}(${d.count}次，末次${d.lastDate.split('T')[0]})`)
        .join('；');
      const medSummary = analysis.medications.slice(0, 10)
        .map((m) => `${m.name}(${m.count}次${m.dosage ? '，' + m.dosage : ''})`)
        .join('；');
      const alertSummary = analysis.alerts
        .map((a) => `[${a.level}] ${a.title}`)
        .join('；');

      const am = computeAgeMonths(child.birthDate);
      const prompt = [
        '你是一位专业的儿童健康管理顾问。',
        '请根据以下就医记录摘要，为家长提供一段综合健康分析（3-5句话）。',
        '要求：',
        '- 重点分析诊断规律、用药合理性、就医频率',
        '- 如发现值得关注的模式，给出具体建议',
        '- 使用客观温和的语气，不使用焦虑性词汇',
        '- 仅输出分析文本',
        '',
        `孩子：${child.displayName}，${Math.floor(am / 12)}岁${am % 12}个月，${child.gender === 'female' ? '女' : '男'}`,
        `就医总次数：${analysis.totalEvents}`,
        `诊断汇总：${diagSummary || '无'}`,
        `用药汇总：${medSummary || '无'}`,
        `系统预警：${alertSummary || '无'}`,
        `常去医院：${analysis.frequentHospitals.join('、') || '未记录'}`,
      ].join('\n');

      const client = getPlatformClient();
      const insightParams = resolveParentosTextGenerateConfig({ temperature: 0.3, maxTokens: 600 });
      const output = await client.runtime.ai.text.generate({
        ...insightParams,
        input: [{ role: 'user', content: prompt }],
        metadata: {
          callerKind: 'third-party-app' as const,
          callerId: 'app.nimi.parentos',
          surfaceId: 'parentos.medical.smart-insight',
        },
      });

      const filtered = filterAIResponse(output.text);
      const text = filtered.safe ? filtered.filtered : '数据已记录，建议持续更新就医信息以获取更精准的健康分析。';
      setAiInsight(text);

      try {
        await setAppSetting(cacheKeyStr, JSON.stringify({ text, ts: isoNow() }), isoNow());
      } catch { /* non-critical */ }
    } catch {
      setAiInsight(null);
    } finally {
      setAiLoading(false);
    }
  }, [child, analysis, events]);

  // ── Search & filter ──
  const filteredEvents = useMemo(() => {
    let result = [...events];
    if (filterType !== 'all') {
      result = result.filter((e) => e.eventType === filterType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.hospital?.toLowerCase().includes(q) ?? false) ||
          (e.medication?.toLowerCase().includes(q) ?? false) ||
          (e.notes?.toLowerCase().includes(q) ?? false),
      );
    }
    return result.sort(
      (a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime(),
    );
  }, [events, filterType, searchQuery]);

  // ── Timeline grouping ──
  const timelineGroups = useMemo(() => groupByMonth(filteredEvents), [filteredEvents]);

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);

  const resetForm = () => {
    setFormEventType('visit');
    setFormTitle('');
    setFormEventDate(new Date().toISOString().slice(0, 10));
    setFormEndDate('');
    setFormSeverity('');
    setFormResult('');
    setFormHospital('');
    setFormMedication('');
    setFormDosage('');
    setFormNotes('');
    setFormLabValues({});
    setFormSymptomTags(new Set());
    setFormMeds([]);
    setFormShowEndDate(false);
    setSubmitError(null);
    setShowForm(false);
  };

  /** OCR: upload image → AI extracts medical record fields → fill form */
  const handleOCRUpload = async (file: File) => {
    setOcrLoading(true);
    setOcrError(null);
    setOcrImageName(file.name);
    try {
      const imageUrl = await readImageFileAsDataUrl(file);
      const client = getPlatformClient();
      if (!client.runtime?.ai?.text?.generate) {
        setOcrError('AI 运行时不可用，请确认已启动');
        return;
      }

      const prompt = [
        '你是一位医疗记录识别助手。请从这张病历/处方单图片中提取以下信息，以 JSON 格式输出：',
        '{',
        '  "eventType": "visit|emergency|hospitalization|checkup|medication|other",',
        '  "title": "诊断/主要症状",',
        '  "eventDate": "YYYY-MM-DD 或 null",',
        '  "hospital": "医院名称 或 null",',
        '  "severity": "mild|moderate|severe 或 null",',
        '  "medications": [{"name":"药名","dose":"剂量","unit":"单位","frequency":"用法","days":"天数"}],',
        '  "notes": "其他重要信息摘要 或 null"',
        '}',
        '规则：',
        '- 仅提取图片中明确可见的信息，不要推测。',
        '- 如果某字段在图片中找不到，设为 null。',
        '- medications 数组只包含图片中明确列出的药品。',
        '- 仅输出 JSON，不要输出其他内容。',
      ].join('\n');

      const ocrParams = resolveParentosTextGenerateConfig({ temperature: 0, maxTokens: 1000 });
      const output = await client.runtime.ai.text.generate({
        ...ocrParams,
        input: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', imageUrl, detail: 'high' },
          ],
        }],
        metadata: {
          callerKind: 'third-party-app' as const,
          callerId: 'app.nimi.parentos',
          surfaceId: 'parentos.medical.ocr-intake',
        },
      });

      // Parse JSON from AI response
      const jsonMatch = output.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        setOcrError('未能从图片中识别出有效信息');
        return;
      }

      const data = JSON.parse(jsonMatch[0]) as {
        eventType?: string;
        title?: string;
        eventDate?: string | null;
        hospital?: string | null;
        severity?: string | null;
        medications?: Array<{ name?: string; dose?: string; unit?: string; frequency?: string; days?: string }>;
        notes?: string | null;
      };

      // Fill form fields
      if (data.eventType && data.eventType in EVENT_TYPE_LABELS) setFormEventType(data.eventType);
      if (data.title) setFormTitle(data.title);
      if (data.eventDate) setFormEventDate(data.eventDate);
      if (data.hospital) setFormHospital(data.hospital);
      if (data.severity && ['mild', 'moderate', 'severe'].includes(data.severity)) setFormSeverity(data.severity);
      if (data.notes) setFormNotes(data.notes);

      if (data.medications && data.medications.length > 0) {
        setFormMeds(data.medications.map((m) => ({
          name: m.name ?? '',
          dose: m.dose ?? '',
          unit: m.unit ?? '次',
          frequency: m.frequency ?? '',
          days: m.days ?? '',
          tags: [],
        })));
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : '识别失败，请重试');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleSubmit = async () => {
    const isLab = formEventType === 'lab-report';
    const effectiveTitle = isLab ? '检验报告' : formTitle.trim();
    if (!isLab && !formTitle.trim()) {
      setSubmitError('请填写诊断或症状');
      return;
    }
    if (!formEventDate) {
      setSubmitError('请选择发生日期');
      return;
    }
    setSubmitError(null);
    setSaving(true);
    const now = isoNow();

    // Serialize lab values into notes if lab-report type
    let effectiveNotes = formNotes || null;
    if (isLab) {
      const labValues: Record<string, number | null> = {};
      for (const item of LAB_ITEMS) {
        const v = formLabValues[item.key];
        labValues[item.key] = v ? parseFloat(v) : null;
      }
      effectiveNotes = JSON.stringify({ type: 'lab-report', values: labValues } satisfies LabReportData);
    }

    // Pack symptom tags and meds list into medication/notes
    const symptomStr = formSymptomTags.size > 0 ? [...formSymptomTags].join('、') : '';
    const fullTitle = [effectiveTitle, symptomStr].filter(Boolean).join(' — ');
    const medStr = formMeds.length > 0
      ? formMeds.filter((m) => m.name.trim()).map((m) => {
          const parts = [m.name.trim()];
          if (m.dose) parts.push(`${m.dose}${m.unit}`);
          if (m.frequency) parts.push(m.frequency);
          if (m.days) parts.push(`${m.days}天`);
          return parts.join(' ');
        }).join('；')
      : formMedication || null;

    try {
      await insertMedicalEvent({
        eventId: ulid(),
        childId: child.childId,
        eventType: formEventType,
        title: fullTitle || effectiveTitle,
        eventDate: formEventDate,
        endDate: formShowEndDate && formEndDate ? formEndDate : null,
        ageMonths: computeAgeMonthsAt(child.birthDate, formEventDate),
        severity: formSeverity || null,
        result: formResult || null,
        hospital: formHospital || null,
        medication: isLab ? null : (medStr || null),
        dosage: isLab ? null : (formDosage || null),
        notes: effectiveNotes,
        photoPath: null,
        now,
      });
      const updated = await getMedicalEvents(child.childId);
      setEvents(updated);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(`保存失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (ev: MedicalEventRow) => {
    setEditingEventId(ev.eventId);
    setFormEventType(ev.eventType);
    setFormTitle(ev.title);
    setFormEventDate(ev.eventDate.split('T')[0]!);
    setFormEndDate(ev.endDate?.split('T')[0] ?? '');
    setFormSeverity(ev.severity ?? '');
    setFormResult(ev.result ?? '');
    setFormHospital(ev.hospital ?? '');
    setFormMedication(ev.medication ?? '');
    setFormDosage(ev.dosage ?? '');
    setFormNotes(ev.notes ?? '');
    // Load lab values if this is a lab-report
    const labData = parseLabReport(ev.notes);
    if (labData) {
      const lv: Record<string, string> = {};
      for (const [k, v] of Object.entries(labData.values)) { if (v != null) lv[k] = String(v); }
      setFormLabValues(lv);
    } else {
      setFormLabValues({});
    }
    setSubmitError(null);
    setShowForm(true);
  };

  const handleUpdate = async () => {
    const isLab = formEventType === 'lab-report';
    if (!editingEventId || (!isLab && !formTitle.trim())) {
      setSubmitError('请填写诊断或症状');
      return;
    }
    setSubmitError(null);
    setSaving(true);

    let effectiveNotes = formNotes || null;
    if (isLab) {
      const labValues: Record<string, number | null> = {};
      for (const item of LAB_ITEMS) { const v = formLabValues[item.key]; labValues[item.key] = v ? parseFloat(v) : null; }
      effectiveNotes = JSON.stringify({ type: 'lab-report', values: labValues } satisfies LabReportData);
    }

    try {
      await updateMedicalEvent({
        eventId: editingEventId,
        title: isLab ? '检验报告' : formTitle.trim(),
        eventDate: formEventDate,
        endDate: formEndDate || null,
        severity: formSeverity || null,
        result: formResult || null,
        hospital: formHospital || null,
        medication: isLab ? null : (formMedication || null),
        dosage: isLab ? null : (formDosage || null),
        notes: effectiveNotes,
        photoPath: null,
        now: isoNow(),
      });
      const updated = await getMedicalEvents(child.childId);
      setEvents(updated);
      setEditingEventId(null);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(`保存失败：${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const analyzeEvent = async (ev: MedicalEventRow) => {
    setEventAiLoading(ev.eventId);
    try {
      const am = computeAgeMonths(child.birthDate);
      const prompt = [
        '你是一位专业的儿童健康顾问。请根据以下单次就医记录，给出简短的分析建议（2-3句话）。',
        '要求：客观温和，关注是否需要复查、用药注意事项、日常护理建议。仅输出分析文本。',
        '',
        `孩子：${child.displayName}，${Math.floor(am / 12)}岁${am % 12}个月`,
        `就诊类型：${EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}`,
        `诊断/症状：${ev.title}`,
        `日期：${ev.eventDate.split('T')[0]}`,
        ev.severity ? `严重程度：${SEVERITY_LABELS[ev.severity] ?? ev.severity}` : '',
        ev.hospital ? `医院：${ev.hospital}` : '',
        ev.medication ? `用药：${ev.medication}${ev.dosage ? '，剂量：' + ev.dosage : ''}` : '',
        ev.notes ? `备注：${ev.notes}` : '',
      ].filter(Boolean).join('\n');

      const client = getPlatformClient();
      const eventParams = resolveParentosTextGenerateConfig({ temperature: 0.3, maxTokens: 300 });
      const output = await client.runtime.ai.text.generate({
        ...eventParams,
        input: [{ role: 'user', content: prompt }],
        metadata: {
          callerKind: 'third-party-app' as const,
          callerId: 'app.nimi.parentos',
          surfaceId: 'parentos.medical.event-analysis',
        },
      });

      const filtered = filterAIResponse(output.text);
      setEventAiResult((prev) => ({
        ...prev,
        [ev.eventId]: filtered.safe ? filtered.filtered : '暂无法生成分析，请确认 AI 运行时已启动。',
      }));
    } catch {
      setEventAiResult((prev) => ({
        ...prev,
        [ev.eventId]: 'AI 分析暂不可用，请稍后重试。',
      }));
    } finally {
      setEventAiLoading(null);
    }
  };

  const showResultField = formEventType === 'checkup';

  // Extract history drugs from past events for personalized suggestions
  const historyDrugs = useMemo(() => {
    const drugMap = new Map<string, { name: string; unit?: string; frequency?: string }>();
    for (const ev of events) {
      if (!ev.medication) continue;
      for (const chunk of ev.medication.split('；')) {
        const name = chunk.split(/\s/)[0]?.trim();
        if (name && !drugMap.has(name)) drugMap.set(name, { name });
      }
    }
    return [...drugMap.values()];
  }, [events]);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>就医记录</h1>
        <div className="flex gap-2">
          {events.length > 0 && (
            <button
              onClick={() => { setShowAnalysis(!showAnalysis); if (!showAnalysis && !aiInsight) void generateAIInsight(); }}
              className={S.radiusSm + ' text-sm px-4 py-2 text-white flex items-center gap-1.5'}
              style={{ background: showAnalysis ? '#6b7280' : S.blue }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                <path d="M11 8v6M8 11h6" />
              </svg>
              {showAnalysis ? '收起分析' : '智能识别'}
            </button>
          )}
          {!showForm && (
            <button onClick={() => setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
              添加事件
            </button>
          )}
        </div>
      </div>
      <div className="mb-5">
        <AppSelect value={activeChildId ?? ''} onChange={(v) => setActiveChildId(v || null)}
          options={children.map((c) => ({ value: c.childId, label: `${c.displayName}，${formatAge(computeAgeMonths(c.birthDate))}` }))} />
      </div>

      {/* AI Summary */}
      <AISummaryCard domain="medical" childName={child.displayName} childId={child.childId}
        ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
        dataContext={events.length > 0 ? `共 ${events.length} 条就医记录` : ''}
      />

      {/* ── Smart Analysis Panel ── */}
      {showAnalysis && analysis && (
        <section className={S.radius + ' mb-6 p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[16px]">🔍</span>
              <h2 className="text-[14px] font-semibold" style={{ color: S.text }}>智能识别分析</h2>
            </div>
            <button
              onClick={() => void generateAIInsight(true)}
              disabled={aiLoading}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-colors hover:bg-[#f0f0ec] disabled:opacity-40"
              style={{ color: S.sub }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                className={aiLoading ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
              {aiLoading ? 'AI 分析中' : 'AI 深度分析'}
            </button>
          </div>

          {analysis.alerts.length > 0 && (
            <div className="space-y-2 mb-4">
              {analysis.alerts.map((alert, i) => {
                const st = ALERT_STYLES[alert.level];
                return (
                  <div key={i} className={S.radiusSm + ' px-4 py-3'} style={{ background: st.bg, border: `1px solid ${st.border}` }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[13px]">{st.icon}</span>
                      <span className="text-[12px] font-semibold" style={{ color: S.text }}>{alert.title}</span>
                    </div>
                    <p className="text-[11px] ml-6" style={{ color: S.sub }}>{alert.message}</p>
                  </div>
                );
              })}
            </div>
          )}

          {analysis.diagnoses.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>诊断汇总</h3>
              <div className="flex flex-wrap gap-1.5">
                {analysis.diagnoses.slice(0, 12).map((d) => (
                  <button key={d.diagnosis}
                    onClick={() => { setSearchQuery(d.diagnosis); setShowAnalysis(false); }}
                    className={S.radiusSm + ' text-[11px] px-2.5 py-1 transition-colors hover:opacity-80'}
                    style={{ background: S.accent + '18', color: S.accent, border: `1px solid ${S.accent}33` }}>
                    {d.diagnosis}<span className="ml-1 opacity-60">x{d.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {analysis.medications.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold mb-2" style={{ color: S.text }}>用药汇总</h3>
              <div className="flex flex-wrap gap-1.5">
                {analysis.medications.slice(0, 12).map((m) => (
                  <button key={m.name}
                    onClick={() => { setSearchQuery(m.name); setShowAnalysis(false); }}
                    className={S.radiusSm + ' text-[11px] px-2.5 py-1 transition-colors hover:opacity-80'}
                    style={{ background: S.blue + '18', color: S.blue, border: `1px solid ${S.blue}33` }}>
                    {m.name}{m.dosage && <span className="ml-1 opacity-60">{m.dosage}</span>}
                    <span className="ml-1 opacity-60">x{m.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 flex-wrap mb-4">
            {Object.entries(analysis.eventsByType).map(([type, count]) => (
              <div key={type} className="text-[11px] flex items-center gap-1" style={{ color: S.sub }}>
                <span className="font-medium" style={{ color: S.text }}>{EVENT_TYPE_LABELS[type] ?? type}</span>
                <span>{count}次</span>
              </div>
            ))}
            {analysis.frequentHospitals.length > 0 && (
              <div className="text-[11px]" style={{ color: S.sub }}>
                常去：{analysis.frequentHospitals.join('、')}
              </div>
            )}
          </div>

          {aiLoading && !aiInsight ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 rounded-full w-full" style={{ background: '#eceeed' }} />
              <div className="h-3 rounded-full w-4/5" style={{ background: '#eceeed' }} />
            </div>
          ) : aiInsight ? (
            <div className={S.radiusSm + ' p-3'} style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[12px]">✨</span>
                <span className="text-[11px] font-semibold" style={{ color: S.text }}>AI 综合分析</span>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: S.text }}>{aiInsight}</p>
            </div>
          ) : null}
        </section>
      )}

      {/* ── Search & Filter ── */}
      {events.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={S.sub} strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input placeholder="搜索诊断、医院、用药..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={S.radiusSm + ' border pl-8 pr-14 py-1.5 text-sm w-full'}
              style={{ borderColor: S.border }} />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: S.sub }}>清除</button>
            )}
          </div>
          <AppSelect value={filterType} onChange={setFilterType}
            options={[{ value: 'all', label: '全部类型' }, ...Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => ({ value: val, label }))]} />
        </div>
      )}

      {/* ── Add Form ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.25)' }} onClick={() => { setEditingEventId(null); resetForm(); }}>
        <div className="w-[520px] max-h-[85vh] flex flex-col rounded-2xl shadow-xl" style={{ background: '#f4f5f0' }} onClick={(e) => e.stopPropagation()}>

          {/* ── Header ── */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center text-[18px]" style={{ background: '#EEF3F1' }}>
                {EVENT_TYPE_ICONS[formEventType] ?? '🏥'}
              </span>
              <h2 className="text-[16px] font-bold" style={{ color: S.text }}>{editingEventId ? '编辑就医记录' : '新增就医记录'}</h2>
            </div>
            <button onClick={() => { setEditingEventId(null); resetForm(); }} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors" style={{ color: S.sub }}>✕</button>
          </div>

          {/* ── AI Quick-Entry Banner ── */}
          {!editingEventId && (
            <>
              <input ref={ocrInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleOCRUpload(f); e.target.value = ''; }} />
              <div className="mx-6 mb-4 rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, #EEF3F1, #e8f0e8)', border: `1px solid ${S.border}` }}>
                <span className="text-[22px]">{ocrLoading ? '⏳' : '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold" style={{ color: S.text }}>智能录入</p>
                  {ocrLoading ? (
                    <p className="text-[10px]" style={{ color: S.accent }}>正在识别 {ocrImageName}...</p>
                  ) : ocrError ? (
                    <p className="text-[10px]" style={{ color: '#dc2626' }}>{ocrError}</p>
                  ) : ocrImageName ? (
                    <p className="text-[10px]" style={{ color: S.accent }}>✓ 已从 {ocrImageName} 提取信息，请确认并补充</p>
                  ) : (
                    <p className="text-[10px]" style={{ color: S.sub }}>上传病历/处方单图片，AI 自动提取关键信息填入表单</p>
                  )}
                </div>
                <button
                  onClick={() => ocrInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="shrink-0 px-3 py-1.5 text-[11px] font-medium text-white rounded-lg transition-colors hover:brightness-110 disabled:opacity-50"
                  style={{ background: S.accent }}>
                  {ocrLoading ? '识别中...' : '上传识别'}
                </button>
              </div>
            </>
          )}

          {/* ── Scrollable content ── */}
          <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">

            {/* ━━ Card 1: 就诊基础 ━━ */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <p className="text-[12px] font-semibold" style={{ color: S.text }}>就诊基础</p>

              {/* Visit type — segmented control */}
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>就诊类型</p>
                <div className="flex flex-wrap gap-1.5">
                  {VISIT_TYPES.map((t) => (
                    <button key={t} onClick={() => setFormEventType(t)}
                      className="px-3 py-2 text-[11px] font-medium rounded-xl transition-all"
                      style={formEventType === t
                        ? { background: EVENT_TYPE_COLORS[t] ?? S.accent, color: '#fff' }
                        : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}>
                      {EVENT_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>就诊日期</p>
                  <ProfileDatePicker value={formEventDate} onChange={setFormEventDate}
                    style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text, borderRadius: 12 }} />
                </div>
                <div>
                  {formShowEndDate ? (
                    <>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] font-medium" style={{ color: S.sub }}>结束日期</p>
                        <button onClick={() => { setFormShowEndDate(false); setFormEndDate(''); }} className="text-[10px]" style={{ color: S.sub }}>取消</button>
                      </div>
                      <ProfileDatePicker value={formEndDate} onChange={setFormEndDate} allowClear
                        style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text, borderRadius: 12 }} />
                    </>
                  ) : (
                    <div className="flex items-end h-full pb-0.5">
                      <button onClick={() => setFormShowEndDate(true)}
                        className="text-[11px] font-medium rounded-xl px-3 py-2 transition-colors hover:bg-[#f0f2ee]"
                        style={{ border: `1px dashed ${S.border}`, color: S.sub }}>
                        + 持续治疗/住院
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Hospital */}
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>就诊机构</p>
                <input value={formHospital} onChange={(e) => setFormHospital(e.target.value)} placeholder="医院/诊所名称"
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50"
                  style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
              </div>
            </div>

            {/* ━━ Card 2: 病情与诊断 ━━ */}
            {formEventType !== 'lab-report' && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <p className="text-[12px] font-semibold" style={{ color: S.text }}>病情与诊断</p>

              {/* Diagnosis */}
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>确诊疾病/主要症状</p>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="如：手足口病、急性上呼吸道感染"
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50"
                  style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
              </div>

              {/* Symptom tags */}
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>伴随症状（可多选）</p>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_SYMPTOMS.map((s) => (
                    <button key={s} onClick={() => setFormSymptomTags((prev) => {
                      const next = new Set(prev);
                      if (next.has(s)) {
                        next.delete(s);
                      } else {
                        next.add(s);
                      }
                      return next;
                    })}
                      className="px-2.5 py-1.5 text-[11px] rounded-xl transition-all"
                      style={formSymptomTags.has(s)
                        ? { background: S.accent, color: '#fff' }
                        : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Severity — visual */}
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>严重程度</p>
                <div className="flex gap-1.5">
                  {SEVERITY_OPTIONS.map((sv) => (
                    <button key={sv} onClick={() => setFormSeverity(formSeverity === sv ? '' : sv)}
                      className="flex-1 py-2.5 text-[11px] font-medium rounded-xl transition-all"
                      style={formSeverity === sv
                        ? { background: SEVERITY_COLORS[sv], color: '#fff' }
                        : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}>
                      {SEVERITY_LABELS[sv]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Checkup result */}
              {showResultField && (
                <div>
                  <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>筛查结果</p>
                  <div className="flex gap-1.5">
                    {RESULT_OPTIONS.map((r) => (
                      <button key={r} onClick={() => setFormResult(formResult === r ? '' : r)}
                        className="flex-1 py-2.5 text-[11px] font-medium rounded-xl transition-all"
                        style={formResult === r
                          ? { background: S.accent, color: '#fff' }
                          : { border: `1px solid ${S.border}`, color: S.sub, background: '#fafaf8' }}>
                        {RESULT_LABELS[r]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* ━━ Card 2b: Lab report ━━ */}
            {formEventType === 'lab-report' && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <p className="text-[12px] font-semibold" style={{ color: S.text }}>化验项目</p>
              <p className="text-[10px]" style={{ color: S.sub }}>填写有数值的项目即可</p>
              <div className="grid grid-cols-2 gap-2">
                {LAB_ITEMS.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <label className="text-[11px] w-16 shrink-0 font-medium" style={{ color: S.text }}>{item.label}</label>
                    <input type="number" step="0.1" placeholder={item.unit}
                      value={formLabValues[item.key] ?? ''}
                      onChange={(e) => setFormLabValues({ ...formLabValues, [item.key]: e.target.value })}
                      className="flex-1 rounded-xl px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50"
                      style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8' }} />
                    <span className="text-[10px] w-14 shrink-0" style={{ color: S.sub }}>{item.unit}</span>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* ━━ Card 3: 用药与处置 ━━ */}
            {formEventType !== 'lab-report' && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold" style={{ color: S.text }}>用药与处置</p>
                {formMeds.length > 0 && <span className="text-[10px]" style={{ color: S.sub }}>{formMeds.length} 种药品</span>}
              </div>

              {/* Dynamic medication list */}
              <div className="space-y-3">
                {formMeds.map((med, i) => (
                  <div key={i} className="rounded-xl px-3 py-3 space-y-2" style={{ background: '#fafaf8', border: `1px solid ${S.border}` }}>
                    {/* Row 1: Drug name (ComboBox) + delete */}
                    <div className="flex items-center gap-2">
                      <DrugComboBox
                        value={med.name}
                        onChange={(v) => setFormMeds((p) => p.map((m, idx) => idx === i ? { ...m, name: v } : m))}
                        onSelect={(sel: DrugSelection) => setFormMeds((p) => p.map((m, idx) => idx === i ? { ...m, name: sel.name, unit: sel.unit, frequency: sel.frequency, tags: sel.tags } : m))}
                        historyDrugs={historyDrugs}
                        placeholder="搜索药品名称或拼音首字母"
                      />
                      <button onClick={() => setFormMeds((p) => p.filter((_, idx) => idx !== i))}
                        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors" style={{ color: S.sub }}>✕</button>
                    </div>
                    {/* Row 2: Dose + Unit + Frequency + Days */}
                    <div className="flex items-center gap-2">
                      <input value={med.dose} onChange={(e) => setFormMeds((p) => p.map((m, idx) => idx === i ? { ...m, dose: e.target.value } : m))}
                        placeholder="剂量" className="w-16 rounded-lg px-2 py-1.5 text-[12px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50"
                        style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fff', color: S.text }} />
                      <span className="text-[11px] px-2 py-1 rounded-lg" style={{ background: '#EEF3F1', color: S.accent }}>{med.unit || '次'}</span>
                      <input value={med.frequency} onChange={(e) => setFormMeds((p) => p.map((m, idx) => idx === i ? { ...m, frequency: e.target.value } : m))}
                        placeholder="频次（如每日3次）" className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-[12px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50"
                        style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fff', color: S.text }} />
                      <input value={med.days} onChange={(e) => setFormMeds((p) => p.map((m, idx) => idx === i ? { ...m, days: e.target.value } : m))}
                        placeholder="天" className="w-12 rounded-lg px-2 py-1.5 text-[12px] outline-none text-center transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50"
                        style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fff', color: S.text }} />
                      <span className="text-[11px] shrink-0" style={{ color: S.sub }}>天</span>
                    </div>
                    {/* Row 3: Quick-reference tags (if from dictionary) */}
                    {med.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        <span className="text-[9px]" style={{ color: S.sub }}>常见用法参考：</span>
                        {med.tags.map((tag) => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#f0f7e4', color: '#6b8a1a' }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button onClick={() => setFormMeds((p) => [...p, { name: '', dose: '', unit: '次', frequency: '', days: '', tags: [] }])}
                className="w-full py-2.5 text-[11px] font-medium rounded-xl transition-colors hover:bg-[#f0f2ee]"
                style={{ border: `1px dashed ${S.border}`, color: S.sub }}>
                + 添加药品
              </button>
            </div>
            )}

            {/* ━━ Card 4: 附件与备注 ━━ */}
            <div className="rounded-xl p-4 space-y-3" style={{ background: '#fff' }}>
              <p className="text-[12px] font-semibold" style={{ color: S.text }}>附件与备注</p>
              <div>
                <p className="text-[11px] mb-1.5 font-medium" style={{ color: S.sub }}>补充说明</p>
                <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="医嘱、复诊安排、其他需要记录的信息..."
                  rows={2}
                  className="w-full rounded-xl px-3 py-2.5 text-[13px] outline-none transition-shadow focus:ring-2 focus:ring-[#c8e64a]/50 resize-none"
                  style={{ borderWidth: 1, borderStyle: 'solid', borderColor: S.border, background: '#fafaf8', color: S.text }} />
              </div>
            </div>

            {/* Error */}
            {submitError && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl">{submitError}</p>
            )}
          </div>

          {/* ── Sticky footer ── */}
          <div className="shrink-0 px-6 py-4" style={{ borderTop: `1px solid ${S.border}`, background: '#f4f5f0' }}>
            <div className="flex items-center justify-end gap-2.5">
              <button onClick={() => { setEditingEventId(null); resetForm(); }} className="px-5 py-2.5 text-[13px] rounded-xl transition-colors hover:bg-[#e8e8e4]" style={{ background: '#e8e8e4', color: S.sub }}>取消</button>
              <button onClick={editingEventId ? handleUpdate : handleSubmit} disabled={saving}
                className="px-6 py-2.5 text-[13px] font-medium text-white rounded-xl transition-colors hover:brightness-110 disabled:opacity-50"
                style={{ background: S.accent }}>
                {saving ? '保存中...' : editingEventId ? '更新记录' : '保存记录'}
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── Timeline ── */}
      <section>
        {filteredEvents.length === 0 ? (
          <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
            <span className="text-[28px]">🏥</span>
            <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>
              {events.length === 0 ? '还没有就医记录' : '未找到匹配的记录'}
            </p>
            <p className="text-[11px] mt-1" style={{ color: S.sub }}>
              {events.length === 0 ? '记录门诊、体检、用药等信息' : '尝试调整筛选条件'}
            </p>
          </div>
        ) : (
          <div className="relative">
            {searchQuery && (
              <p className="text-[11px] mb-3" style={{ color: S.sub }}>
                找到 {filteredEvents.length} 条匹配记录
              </p>
            )}

            {/* Vertical timeline line — same as milestone */}
            <div className="absolute left-[18px] top-0 bottom-0 w-[2px]" style={{ background: S.border }} />

            {timelineGroups.map(([ym, monthEvents]) => (
              <div key={ym} className="relative pl-10 pb-6">
                {/* Timeline dot — month header */}
                <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center"
                  style={{ background: S.card, borderColor: S.accent }}>
                  <div className="w-[6px] h-[6px] rounded-full" style={{ background: S.accent }} />
                </div>

                {/* Month label */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[12px] font-bold" style={{ color: S.text }}>{formatMonthLabel(ym)}</span>
                  <span className="text-[10px]" style={{ color: S.sub }}>{monthEvents.length} 条记录</span>
                </div>

                {/* Event cards */}
                <div className="space-y-1.5">
                  {monthEvents.map((ev) => {
                    const typeColor = EVENT_TYPE_COLORS[ev.eventType] ?? '#6b7280';
                    const dateStr = ev.eventDate.split('T')[0]!;
                    const day = parseInt(dateStr.split('-')[2]!, 10);
                    const isSevere = ev.severity === 'severe';

                    return (
                      <div key={ev.eventId}>
                        <div className={`flex items-start gap-2.5 p-2.5 ${S.radiusSm} transition-all duration-150`}
                          style={{
                            background: isSevere ? '#fef2f2' : S.card,
                            border: `1px solid ${isSevere ? '#fca5a5' : S.border}`,
                          }}>
                          {/* Type icon */}
                          <div className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[12px] shrink-0 font-medium"
                            style={{ background: typeColor + '18', color: typeColor }}>
                            {EVENT_TYPE_ICONS[ev.eventType] ?? '📋'}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[12px] font-medium" style={{ color: S.text }}>{ev.title}</p>
                              {ev.severity && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                  ev.severity === 'severe' ? 'bg-red-100 text-red-700'
                                    : ev.severity === 'moderate' ? 'bg-amber-100 text-amber-700'
                                      : ''
                                }`} style={ev.severity === 'mild' ? { background: '#f0f0ec', color: S.sub } : undefined}>
                                  {SEVERITY_LABELS[ev.severity] ?? ev.severity}
                                </span>
                              )}
                              {ev.result && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                  ev.result === 'pass' ? 'bg-green-100 text-green-700'
                                    : ev.result === 'fail' ? 'bg-red-100 text-red-700'
                                      : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {RESULT_LABELS[ev.result] ?? ev.result}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] truncate" style={{ color: S.sub }}>
                              {day}日
                              {ev.endDate ? ` - ${ev.endDate.split('T')[0]}` : ''}
                              {ev.hospital ? ` · ${ev.hospital}` : ''}
                              {` · ${formatAge(ev.ageMonths)}`}
                            </p>
                            {(ev.medication || ev.dosage) && (
                              <p className="text-[10px] mt-0.5" style={{ color: S.accent }}>
                                💊 {ev.medication}{ev.dosage ? ` · ${ev.dosage}` : ''}
                              </p>
                            )}
                            {ev.notes && (() => {
                              const labData = parseLabReport(ev.notes);
                              if (labData) {
                                return (
                                  <div className="mt-1.5 space-y-1">
                                    {LAB_ITEMS.map((item) => {
                                      const val = labData.values[item.key];
                                      if (val == null) return null;
                                      const range = labRangeFor(item, val);
                                      return (
                                        <div key={item.key} className="flex items-center gap-2 text-[10px]">
                                          <span className="w-14 shrink-0" style={{ color: S.sub }}>{item.label}</span>
                                          <span className="font-medium" style={{ color: S.text }}>{val} {item.unit}</span>
                                          <span className="px-1 py-0.5 rounded text-[9px]" style={{ background: `${range.color}20`, color: range.color }}>{range.label}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              }
                              return <p className="text-[10px] mt-0.5 truncate" style={{ color: S.sub }}>{ev.notes}</p>;
                            })()}
                          </div>

                          {/* Right side: type badge + actions */}
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{ background: typeColor + '18', color: typeColor }}>
                              {EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType}
                            </span>
                            <div className="flex gap-1">
                              <button
                                onClick={() => startEditing(ev)}
                                className="text-[10px] px-1.5 py-0.5 rounded-full transition-colors hover:bg-[#f0f0ec]"
                                style={{ color: S.sub }}
                                title="编辑">
                                ✏️
                              </button>
                              <button
                                onClick={() => void analyzeEvent(ev)}
                                disabled={eventAiLoading === ev.eventId}
                                className="text-[10px] px-1.5 py-0.5 rounded-full transition-colors hover:bg-[#f0f0ec] disabled:opacity-40"
                                style={{ color: S.sub }}
                                title="AI 分析">
                                {eventAiLoading === ev.eventId ? '⏳' : '✨'}
                              </button>
                            </div>
                          </div>
                        </div>
                        {/* Per-event AI analysis result */}
                        {eventAiResult[ev.eventId] && (
                          <div className={`ml-[38px] mt-1 p-2.5 ${S.radiusSm}`}
                            style={{ background: '#f9faf7', border: `1px solid ${S.border}` }}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px]">✨</span>
                                <span className="text-[10px] font-semibold" style={{ color: S.text }}>AI 分析</span>
                              </div>
                              <button onClick={() => setEventAiResult((prev) => {
                                const next = { ...prev };
                                delete next[ev.eventId];
                                return next;
                              })} className="text-[10px] hover:bg-[#f0f0ec] px-1 rounded" style={{ color: S.sub }}>
                                收起
                              </button>
                            </div>
                            <p className="text-[10px] leading-relaxed" style={{ color: S.text }}>
                              {eventAiResult[ev.eventId]}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
