import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, computeAgeMonthsAt, formatAge } from '../../app-shell/app-store.js';
import { insertMedicalEvent, updateMedicalEvent, getMedicalEvents, getAppSetting, setAppSetting } from '../../bridge/sqlite-bridge.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { ulid, isoNow } from '../../bridge/ulid.js';
import { S } from '../../app-shell/page-style.js';
import { AISummaryCard } from './ai-summary-card.js';
import { analyzeMedicalEvents } from '../../engine/smart-alerts.js';
import type { MedicalAnalysis, MedicalAlert } from '../../engine/smart-alerts.js';
import { getPlatformClient } from '@nimiplatform/sdk';
import { filterAIResponse } from '../../engine/ai-safety-filter.js';

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
  other: '其他',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  visit: '#6366f1',
  emergency: '#ef4444',
  hospitalization: '#f59e0b',
  checkup: '#3b82f6',
  medication: '#10b981',
  other: '#6b7280',
};

const EVENT_TYPE_ICONS: Record<string, string> = {
  visit: '🏥',
  emergency: '🚑',
  hospitalization: '🛏️',
  checkup: '🩺',
  medication: '💊',
  other: '📋',
};

const SEVERITY_OPTIONS = ['mild', 'moderate', 'severe'] as const;
const SEVERITY_LABELS: Record<string, string> = { mild: '轻度', moderate: '中度', severe: '重度' };
const RESULT_OPTIONS = ['pass', 'refer', 'fail'] as const;
const RESULT_LABELS: Record<string, string> = { pass: '通过', refer: '转诊', fail: '未通过' };

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
  const { activeChildId, children } = useAppStore();
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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventAiLoading, setEventAiLoading] = useState<string | null>(null);
  const [eventAiResult, setEventAiResult] = useState<Record<string, string>>({});

  useEffect(() => {
    if (activeChildId) {
      getMedicalEvents(activeChildId).then(setEvents).catch(() => {});
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
      const output = await client.runtime.ai.text.generate({
        model: 'auto',
        temperature: 0.3,
        maxTokens: 600,
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
    setSubmitError(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!formTitle.trim()) {
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
    try {
      await insertMedicalEvent({
        eventId: ulid(),
        childId: child.childId,
        eventType: formEventType,
        title: formTitle.trim(),
        eventDate: formEventDate,
        endDate: formEndDate || null,
        ageMonths: computeAgeMonthsAt(child.birthDate, formEventDate),
        severity: formSeverity || null,
        result: formResult || null,
        hospital: formHospital || null,
        medication: formMedication || null,
        dosage: formDosage || null,
        notes: formNotes || null,
        photoPath: null,
        now,
      });
      const updated = await getMedicalEvents(child.childId);
      setEvents(updated);
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(`保存失败：${msg}`);
      console.error('[medical-events] insert failed:', err);
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
    setSubmitError(null);
    setShowForm(true);
  };

  const handleUpdate = async () => {
    if (!editingEventId || !formTitle.trim()) {
      setSubmitError('请填写诊断或症状');
      return;
    }
    setSubmitError(null);
    setSaving(true);
    try {
      await updateMedicalEvent({
        eventId: editingEventId,
        title: formTitle.trim(),
        eventDate: formEventDate,
        endDate: formEndDate || null,
        severity: formSeverity || null,
        result: formResult || null,
        hospital: formHospital || null,
        medication: formMedication || null,
        dosage: formDosage || null,
        notes: formNotes || null,
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
      const output = await client.runtime.ai.text.generate({
        model: 'auto',
        temperature: 0.3,
        maxTokens: 300,
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

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[13px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-2">
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
      <p className="text-[12px] mb-5" style={{ color: S.sub }}>
        {child.displayName}，{Math.floor(ageMonths / 12)}岁{ageMonths % 12}个月 · 共 {events.length} 条记录
      </p>

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
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
            className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }}>
            <option value="all">全部类型</option>
            {Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Add Form ── */}
      {showForm && (
        <section className={S.radius + ' mb-6 p-5'} style={{ background: S.card, boxShadow: S.shadow }}>
          <h2 className="text-lg font-semibold mb-3" style={{ color: S.text }}>{editingEventId ? '编辑就医记录' : '新增就医记录'}</h2>
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <select value={formEventType} onChange={(e) => setFormEventType(e.target.value)}
                className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }}>
                {Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <input placeholder="诊断/症状（如：感冒发烧、手足口病）" value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                className={S.radiusSm + ' border px-2 py-1.5 text-sm flex-1 min-w-40'}
                style={{ borderColor: S.border }} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                发生日期
                <input type="date" value={formEventDate} onChange={(e) => setFormEventDate(e.target.value)}
                  className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }} />
              </label>
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                结束日期（可选）
                <input type="date" value={formEndDate} onChange={(e) => setFormEndDate(e.target.value)}
                  className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }} />
              </label>
              <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                严重程度
                <select value={formSeverity} onChange={(e) => setFormSeverity(e.target.value)}
                  className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }}>
                  <option value="">可选</option>
                  {SEVERITY_OPTIONS.map((v) => <option key={v} value={v}>{SEVERITY_LABELS[v]}</option>)}
                </select>
              </label>
            </div>
            {showResultField && (
              <div className="flex gap-2">
                <label className="text-xs flex flex-col gap-1" style={{ color: S.sub }}>
                  筛查结果
                  <select value={formResult} onChange={(e) => setFormResult(e.target.value)}
                    className={S.radiusSm + ' border px-2 py-1.5 text-sm'} style={{ borderColor: S.border }}>
                    <option value="">可选</option>
                    {RESULT_OPTIONS.map((v) => <option key={v} value={v}>{RESULT_LABELS[v]}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <input placeholder="医院/诊所" value={formHospital}
                onChange={(e) => setFormHospital(e.target.value)}
                className={S.radiusSm + ' border px-2 py-1.5 text-sm flex-1'} style={{ borderColor: S.border }} />
              <input placeholder="用药名称（多个用逗号分隔）" value={formMedication}
                onChange={(e) => setFormMedication(e.target.value)}
                className={S.radiusSm + ' border px-2 py-1.5 text-sm flex-1'} style={{ borderColor: S.border }} />
              <input placeholder="剂量" value={formDosage}
                onChange={(e) => setFormDosage(e.target.value)}
                className={S.radiusSm + ' border px-2 py-1.5 text-sm w-28'} style={{ borderColor: S.border }} />
            </div>
            <input placeholder="备注" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
              className={S.radiusSm + ' border px-2 py-1.5 text-sm w-full'} style={{ borderColor: S.border }} />
            {submitError && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{submitError}</p>
            )}
            <div className="flex gap-2">
              <button onClick={editingEventId ? handleUpdate : handleSubmit} disabled={saving}
                className={S.radiusSm + ' text-xs px-4 py-1.5 text-white disabled:opacity-50'}
                style={{ background: S.accent }}>
                {saving ? '保存中...' : editingEventId ? '更新' : '保存'}
              </button>
              <button onClick={() => { setEditingEventId(null); resetForm(); }} className={S.radiusSm + ' text-xs px-3 py-1.5'}
                style={{ background: '#f0f0ec', color: S.sub }}>取消</button>
            </div>
          </div>
        </section>
      )}

      {/* ── Timeline ── */}
      <section>
        {filteredEvents.length === 0 ? (
          <div className={S.radius + ' p-8 text-center'} style={{ background: S.card, boxShadow: S.shadow }}>
            <p className="text-sm" style={{ color: S.sub }}>
              {events.length === 0 ? '暂无就医记录，点击「添加事件」开始记录' : '未找到匹配的记录'}
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
                            {ev.notes && (
                              <p className="text-[10px] mt-0.5 truncate" style={{ color: S.sub }}>{ev.notes}</p>
                            )}
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
