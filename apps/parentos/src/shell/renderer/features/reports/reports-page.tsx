import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';
import { ProfileDatePicker } from '../profile/profile-date-picker.js';
import { useAppStore } from '../../app-shell/app-store.js';
import {
  getGrowthReports, getJournalEntries, getMeasurements, getMilestoneRecords,
  getReminderStates, getSleepRecords, getVaccineRecords, insertGrowthReport,
  updateGrowthReportContent,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import {
  buildStructuredGrowthReport, parseReportContent,
  type GrowthReportType, type NarrativeReportContent, type ParsedReportContent,
  type StructuredGrowthReportContent,
} from './structured-report.js';

type PersistedReport = Awaited<ReturnType<typeof getGrowthReports>>[number];
type GenerateState = 'idle' | 'saving' | 'error';
type PeriodPreset = 'this-month' | 'last-month' | 'this-quarter' | 'last-quarter' | 'custom';

const PRESET_OPTIONS: Array<{ id: PeriodPreset; label: string }> = [
  { id: 'this-month', label: '本月' }, { id: 'last-month', label: '上月' },
  { id: 'this-quarter', label: '本季度' }, { id: 'last-quarter', label: '上季度' },
  { id: 'custom', label: '自定义' },
];

function computePresetDates(preset: PeriodPreset) {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  switch (preset) {
    case 'this-month': return { start: `${y}-${pad(m + 1)}-01`, end: fmt(now) };
    case 'last-month': return { start: fmt(new Date(y, m - 1, 1)), end: fmt(new Date(y, m, 0)) };
    case 'this-quarter': return { start: fmt(new Date(y, Math.floor(m / 3) * 3, 1)), end: fmt(now) };
    case 'last-quarter': { const q = Math.floor(m / 3) * 3; return { start: fmt(new Date(y, q - 3, 1)), end: fmt(new Date(y, q, 0)) }; }
    case 'custom': return { start: '', end: '' };
  }
}

function deriveReportType(preset: PeriodPreset): GrowthReportType {
  if (preset === 'this-month' || preset === 'last-month') return 'monthly';
  if (preset === 'this-quarter' || preset === 'last-quarter') return 'quarterly-letter';
  return 'custom';
}

function reportBadgeLabel(c: ParsedReportContent): string {
  if (c.version === 2) return c.format === 'narrative-ai' ? 'AI 叙事' : '叙事';
  const l: Record<string, string> = { monthly: '月度', quarterly: '季度', 'quarterly-letter': '季度信', custom: '自定义' };
  return l[c.reportType] ?? '综合';
}

function reportToPlainText(c: ParsedReportContent): string {
  const l: string[] = [c.title, c.subtitle, ''];
  if (c.version === 2) {
    if (c.opening) l.push(c.opening, '');
    for (const s of c.narrativeSections) l.push(`【${s.title}】`, s.narrative, '');
    if (c.milestoneReplay) l.push('【里程碑时刻】', c.milestoneReplay, '');
    if (c.highlights?.length) { l.push('【本月亮点】'); for (const h of c.highlights) l.push(`🌟 ${h}`); l.push(''); }
    if (c.watchNext?.length) { l.push('【下月留意】'); for (const w of c.watchNext) l.push(`👀 ${w}`); l.push(''); }
    if (c.actionItems.length > 0) { l.push('【下一步行动】'); for (const a of c.actionItems) l.push(`→ ${a.text}`); l.push(''); }
    if (c.closingMessage) l.push(c.closingMessage, '');
  } else { for (const s of c.sections) { l.push(`【${s.title}】`); for (const item of s.items) l.push(`· ${item}`); l.push(''); } }
  l.push(c.safetyNote); return l.join('\n');
}

/* ── Editable Text ── */

function EditableText({ text, onSave }: { text: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const start = () => { setDraft(text); setEditing(true); setTimeout(() => ref.current?.focus(), 0); };
  if (editing) return (<div>
    <textarea ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)}
      className={`w-full ${S.radiusSm} px-3 py-2 text-[14px] leading-[1.8] outline-none resize-y min-h-[80px]`}
      style={{ background: S.bg, color: S.text, border: `1px solid ${S.accent}` }} />
    <div className="flex gap-2 mt-2">
      <button onClick={() => { onSave(draft); setEditing(false); }} className="px-3 py-1 rounded-lg text-[12px] font-medium text-white" style={{ background: S.accent }}>保存</button>
      <button onClick={() => setEditing(false)} className="px-3 py-1 rounded-lg text-[12px]" style={{ color: S.sub }}>取消</button>
    </div>
  </div>);
  return (<div className="group relative">
    <p className="text-[14px] leading-[1.8]" style={{ color: S.text }}>{text}</p>
    <button onClick={start} className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded flex items-center justify-center" style={{ color: S.sub }} title="编辑">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
    </button>
  </div>);
}

/* ── Narrative Viewer ── */

function NarrativeViewer({ content, reportId, onContentUpdate }: { content: NarrativeReportContent; reportId?: string; onContentUpdate?: (u: NarrativeReportContent) => void }) {
  const canEdit = Boolean(reportId && onContentUpdate);
  const editSection = (sid: string, narrative: string) => onContentUpdate?.({ ...content, narrativeSections: content.narrativeSections.map((s) => s.id === sid ? { ...s, narrative } : s) });
  const editField = (f: 'opening' | 'milestoneReplay' | 'closingMessage', v: string) => onContentUpdate?.({ ...content, [f]: v });

  return (<div className="space-y-4">
    <div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
      <h2 className="text-[20px] font-bold leading-tight" style={{ color: S.text }}>{content.title}</h2>
      <p className="text-[12px] mt-1" style={{ color: S.sub }}>{content.subtitle}</p>
      {content.format === 'narrative-ai' && <span className="text-[10px] px-2 py-0.5 rounded-full mt-2 inline-block" style={{ background: '#f0f5e6', color: S.accent }}>AI 撰写</span>}
    </div>

    {content.opening && (<div className={`${S.radius} p-5`} style={{ background: '#fefce8', boxShadow: S.shadow }}>
      {canEdit ? <EditableText text={content.opening} onSave={(v) => editField('opening', v)} /> : <p className="text-[14px] leading-[1.8] italic" style={{ color: S.text }}>{content.opening}</p>}
    </div>)}

    {content.narrativeSections.map((section) => (<div key={section.id} className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
      <h3 className="text-[14px] font-semibold mb-2" style={{ color: S.text }}>{section.title}</h3>
      {canEdit ? <EditableText text={section.narrative} onSave={(v) => editSection(section.id, v)} /> : <p className="text-[14px] leading-[1.8]" style={{ color: S.text }}>{section.narrative}</p>}
      {section.dataPoints && section.dataPoints.length > 0 && (<div className="mt-3 flex flex-wrap gap-3">
        {section.dataPoints.map((dp) => (<div key={dp.label} className={`${S.radiusSm} px-3 py-2`} style={{ background: S.bg }}>
          <span className="text-[10px] uppercase tracking-wide" style={{ color: S.sub }}>{dp.label}</span>
          <span className="text-[14px] font-semibold ml-2" style={{ color: S.text }}>{dp.value}</span>
          {dp.detail && <span className="text-[11px] ml-1" style={{ color: S.sub }}>{dp.detail}</span>}
        </div>))}
      </div>)}
    </div>))}

    {content.milestoneReplay && (<div className={`${S.radius} p-5`} style={{ background: '#fef9c3', boxShadow: S.shadow }}>
      <div className="flex items-center gap-2 mb-2"><span className="text-[16px]">⭐</span><h3 className="text-[14px] font-semibold" style={{ color: S.text }}>里程碑时刻</h3></div>
      {canEdit ? <EditableText text={content.milestoneReplay} onSave={(v) => editField('milestoneReplay', v)} /> : <p className="text-[14px] leading-[1.8]" style={{ color: S.text }}>{content.milestoneReplay}</p>}
    </div>)}

    {((content.highlights?.length ?? 0) > 0 || (content.watchNext?.length ?? 0) > 0) && (<div className="grid gap-3 sm:grid-cols-2">
      {content.highlights && content.highlights.length > 0 && (<div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
        <h3 className="text-[14px] font-semibold mb-3" style={{ color: S.text }}>🌟 本月亮点</h3>
        <ul className="space-y-2">{content.highlights.map((h, i) => <li key={i} className={`${S.radiusSm} px-3 py-2 text-[13px]`} style={{ background: '#f0f5e6', color: S.text }}>{h}</li>)}</ul>
      </div>)}
      {content.watchNext && content.watchNext.length > 0 && (<div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
        <h3 className="text-[14px] font-semibold mb-3" style={{ color: S.text }}>👀 下月留意</h3>
        <ul className="space-y-2">{content.watchNext.map((w, i) => <li key={i} className={`${S.radiusSm} px-3 py-2 text-[13px]`} style={{ background: '#fefce8', color: S.text }}>{w}</li>)}</ul>
      </div>)}
    </div>)}

    {content.trendSignals.length > 0 && (<div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
      <h3 className="text-[14px] font-semibold mb-3" style={{ color: S.text }}>趋势信号</h3>
      <div className="grid gap-3 sm:grid-cols-2">{content.trendSignals.map((sig) => (<div key={sig.id} className={`${S.radiusSm} p-3`} style={{ background: S.bg, border: `1px solid ${S.border}` }}>
        <h4 className="text-[12px] font-semibold" style={{ color: S.text }}>{sig.title}</h4>
        <p className="mt-1 text-[12px]" style={{ color: S.text }}>{sig.summary}</p>
      </div>))}</div>
    </div>)}

    {content.actionItems.length > 0 && (<div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
      <h3 className="text-[14px] font-semibold mb-3" style={{ color: S.text }}>下一步行动</h3>
      <div className="space-y-2">{content.actionItems.map((a) => (<Link key={a.id} to={a.linkTo ?? '/advisor'} className={`flex items-center gap-3 ${S.radiusSm} px-4 py-3 transition-colors hover:opacity-90`} style={{ background: '#f0f5e6', border: `1px solid ${S.accent}40` }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={S.accent} strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        <span className="text-[13px] font-medium" style={{ color: S.text }}>{a.text}</span>
      </Link>))}</div>
    </div>)}

    {content.closingMessage && (<div className={`${S.radius} p-5`} style={{ background: '#f0fdf4', boxShadow: S.shadow }}>
      {canEdit ? <EditableText text={content.closingMessage} onSave={(v) => editField('closingMessage', v)} /> : <p className="text-[14px] leading-[1.8]" style={{ color: S.text }}>{content.closingMessage}</p>}
    </div>)}

    <div className={`${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}>
      <p className="text-[11px]" style={{ color: S.sub }}>数据来源：{content.sources.join('，')}</p>
      <p className="text-[11px] mt-1" style={{ color: '#92400e' }}>{content.safetyNote}</p>
    </div>
  </div>);
}

/* ── V1 Structured Viewer ── */

function StructuredViewer({ content }: { content: StructuredGrowthReportContent }) {
  return (<div className="space-y-4">
    <div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}>
      <h2 className="text-[20px] font-bold" style={{ color: S.text }}>{content.title}</h2>
      <p className="text-[12px] mt-1" style={{ color: S.sub }}>{content.subtitle}</p>
      <p className="text-[11px] mt-3" style={{ color: '#92400e' }}>{content.safetyNote}</p>
    </div>
    {content.metrics.length > 0 && <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{content.metrics.map((m) => (<div key={m.id} className={`${S.radiusSm} p-3`} style={{ background: S.card, boxShadow: S.shadow }}><div className="text-[10px] uppercase" style={{ color: S.sub }}>{m.label}</div><div className="mt-1 text-[18px] font-semibold" style={{ color: S.text }}>{m.value}</div>{m.detail && <div className="text-[10px]" style={{ color: S.sub }}>{m.detail}</div>}</div>))}</div>}
    {content.overview.length > 0 && <div className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}><h3 className="text-[14px] font-semibold mb-3" style={{ color: S.text }}>概览</h3><ul className="space-y-2">{content.overview.map((item) => <li key={item} className={`${S.radiusSm} px-3 py-2 text-[12px]`} style={{ background: S.bg, color: S.text }}>{item}</li>)}</ul></div>}
    <div className="grid gap-3 sm:grid-cols-2">{content.sections.map((sec) => (<div key={sec.id} className={`${S.radius} p-5`} style={{ background: S.card, boxShadow: S.shadow }}><h3 className="text-[14px] font-semibold mb-3" style={{ color: S.text }}>{sec.title}</h3><ul className="space-y-2">{sec.items.map((item) => <li key={item} className={`${S.radiusSm} px-3 py-2 text-[12px]`} style={{ background: S.bg, color: S.text }}>{item}</li>)}</ul></div>))}</div>
    <div className={`${S.radius} p-4`} style={{ background: S.card, boxShadow: S.shadow }}><p className="text-[11px]" style={{ color: S.sub }}>数据来源：{content.sources.join('，')}</p></div>
  </div>);
}

function ReportViewer({ content, reportId, onContentUpdate }: { content: ParsedReportContent; reportId?: string; onContentUpdate?: (u: NarrativeReportContent) => void }) {
  if (content.version === 2) return <NarrativeViewer content={content} reportId={reportId} onContentUpdate={onContentUpdate} />;
  return <StructuredViewer content={content} />;
}

/* ── Main Page ── */

export default function ReportsPage() {
  const { activeChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [reports, setReports] = useState<PersistedReport[]>([]);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('this-quarter');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [generateState, setGenerateState] = useState<GenerateState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const d = computePresetDates('this-quarter'); setPeriodStart(d.start); setPeriodEnd(d.end); }, []);
  useEffect(() => {
    if (!child) { setReports([]); setExpandedReportId(null); return; }
    const cid = child.childId; let cancelled = false;
    getGrowthReports(cid).then((rows) => { if (!cancelled) setReports(rows); }).catch(catchLog('reports', 'action:load-growth-reports-failed'));
    return () => { cancelled = true; };
  }, [child]);

  if (!child) return <div style={{ minHeight: '100vh' }}><div className={S.container} style={{ paddingTop: S.topPad }}><p style={{ color: S.sub }}>请先添加孩子档案。</p></div></div>;

  const activeChild = child;
  const latestReport = reports[0] ?? null;
  let latestContent: ParsedReportContent | null = null;
  if (latestReport) { try { latestContent = parseReportContent(latestReport.content); } catch { /* */ } }

  const handlePresetChange = (p: PeriodPreset) => { setPeriodPreset(p); if (p !== 'custom') { const d = computePresetDates(p); setPeriodStart(d.start); setPeriodEnd(d.end); } };
  const handleDateChange = (field: 'start' | 'end', value: string) => {
    if (field === 'start') setPeriodStart(value); else setPeriodEnd(value);
    const ns = field === 'start' ? value : periodStart; const ne = field === 'end' ? value : periodEnd;
    let matched = false;
    for (const p of PRESET_OPTIONS) { if (p.id === 'custom') continue; const d = computePresetDates(p.id); if (d.start === ns && d.end === ne) { setPeriodPreset(p.id); matched = true; break; } }
    if (!matched) setPeriodPreset('custom');
  };

  const handleContentUpdate = async (reportId: string, updated: NarrativeReportContent) => {
    try { await updateGrowthReportContent({ reportId, content: JSON.stringify(updated), now: isoNow() }); setReports(await getGrowthReports(activeChild.childId)); } catch { /* */ }
  };

  const handleGenerate = async () => {
    if (!periodStart || !periodEnd) { setErrorMessage('请选择报告时间范围。'); return; }
    setGenerateState('saving'); setErrorMessage(null);
    try {
      const now = isoNow();
      const [measurements, milestones, vaccines, journalEntries, reminderStates] = await Promise.all([
        getMeasurements(activeChild.childId), getMilestoneRecords(activeChild.childId),
        getVaccineRecords(activeChild.childId), getJournalEntries(activeChild.childId, 200), getReminderStates(activeChild.childId),
      ]);
      const report = buildStructuredGrowthReport({ child: activeChild, reportType: deriveReportType(periodPreset), now, measurements, milestones, vaccines, journalEntries, reminderStates });
      const reportId = ulid();
      await insertGrowthReport({ reportId, childId: activeChild.childId, reportType: report.reportType, periodStart: report.periodStart, periodEnd: report.periodEnd, ageMonthsStart: report.ageMonthsStart, ageMonthsEnd: report.ageMonthsEnd, content: JSON.stringify(report.content), generatedAt: now, now });
      setReports(await getGrowthReports(activeChild.childId)); setExpandedReportId(reportId); setGenerateState('idle');
      setTimeout(() => { if (typeof viewerRef.current?.scrollIntoView === 'function') viewerRef.current.scrollIntoView({ behavior: 'smooth' }); }, 100);
    } catch { setGenerateState('error'); setErrorMessage('报告生成失败，请重试。'); }
  };

  const handleCopy = (content: ParsedReportContent) => {
    navigator.clipboard.writeText(reportToPlainText(content)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(catchLog('reports', 'action:clipboard-write-failed', 'warn'));
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="mb-5">
          <h1 className="text-[18px] font-bold" style={{ color: S.text }}>成长报告</h1>
          <p className="text-[12px] mt-0.5" style={{ color: S.sub }}>基于本地数据自动生成，每月更新</p>
        </div>

        {errorMessage && <div className={`mb-4 ${S.radiusSm} px-4 py-3 text-[13px]`} style={{ border: '1px solid #fed7d7', background: '#fff5f5', color: '#c53030' }}>{errorMessage}</div>}

        {latestContent && latestReport ? (
          <div className="mb-6">
            <ReportViewer content={latestContent} reportId={latestReport.reportId} onContentUpdate={latestContent.version === 2 ? (u) => void handleContentUpdate(latestReport.reportId, u) : undefined} />
            <div className="mt-3"><button onClick={() => handleCopy(latestContent!)} className={`${S.radiusSm} px-4 py-2 text-[12px] font-medium`} style={{ background: S.card, border: `1px solid ${S.border}`, color: S.text }}>{copied ? '已复制 ✓' : '复制文本'}</button></div>
          </div>
        ) : (
          <div className={`${S.radius} p-8 text-center mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
            <p className="text-[14px]" style={{ color: S.sub }}>还没有成长报告</p>
            <p className="text-[12px] mt-1" style={{ color: S.sub }}>报告会在首页自动生成，也可以在下方手动创建</p>
          </div>
        )}

        {reports.length > 1 && (<div className="mb-6">
          <p className="text-[12px] font-semibold mb-3" style={{ color: S.sub }}>历史报告</p>
          <div className="space-y-2">{reports.slice(1).map((report) => {
            const isExpanded = expandedReportId === report.reportId;
            let parsed: ParsedReportContent | null = null; let title = '报告';
            try { parsed = parseReportContent(report.content); title = parsed.title; } catch { /* */ }
            return (<div key={report.reportId}>
              <button onClick={() => setExpandedReportId((prev) => prev === report.reportId ? null : report.reportId)}
                className={`w-full ${S.radius} p-4 text-left transition-all`} style={{ border: `1px solid ${isExpanded ? S.accent : S.border}`, background: isExpanded ? '#e8eccc' : S.card }}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium flex-1 truncate" style={{ color: S.text }}>{title}</span>
                  {parsed && <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ background: S.bg, color: S.sub }}>{reportBadgeLabel(parsed)}</span>}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={S.sub} strokeWidth="2" className={`shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
                </div>
                <p className="text-[11px] mt-1" style={{ color: S.sub }}>{report.periodStart.slice(0, 10)} 至 {report.periodEnd.slice(0, 10)}</p>
              </button>
              {isExpanded && parsed && (<div ref={viewerRef} className="mt-2 pb-4">
                <ReportViewer content={parsed} reportId={report.reportId} onContentUpdate={parsed.version === 2 ? (u) => void handleContentUpdate(report.reportId, u) : undefined} />
                <div className="mt-3"><button onClick={() => handleCopy(parsed!)} className={`${S.radiusSm} px-4 py-2 text-[12px] font-medium`} style={{ background: S.card, border: `1px solid ${S.border}`, color: S.text }}>{copied ? '已复制 ✓' : '复制文本'}</button></div>
              </div>)}
            </div>);
          })}</div>
        </div>)}

        <div className="mb-8">
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-[12px] font-medium" style={{ color: S.sub }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" /></svg>
            高级选项 · 手动生成报告
          </button>
          {showAdvanced && (<div className={`${S.radius} p-5 mt-3`} style={{ background: S.card, boxShadow: S.shadow }}>
            <div className="mb-3">
              <p className="text-[11px] font-medium mb-2" style={{ color: S.sub }}>时间范围</p>
              <div className="flex flex-wrap gap-2">{PRESET_OPTIONS.map((p) => <button key={p.id} onClick={() => handlePresetChange(p.id)} className="px-3 py-1 rounded-full text-[11px] transition-colors" style={periodPreset === p.id ? { background: S.accent, color: '#fff' } : { background: S.bg, color: S.text, border: `1px solid ${S.border}` }}>{p.label}</button>)}</div>
            </div>
            <div className="flex gap-3 mb-4">
              <div className="flex-1"><label className="block text-[10px] mb-1" style={{ color: S.sub }}>开始日期</label><ProfileDatePicker value={periodStart} onChange={(v) => handleDateChange('start', v)} size="small" /></div>
              <div className="flex-1"><label className="block text-[10px] mb-1" style={{ color: S.sub }}>结束日期</label><ProfileDatePicker value={periodEnd} onChange={(v) => handleDateChange('end', v)} size="small" /></div>
            </div>
            <button onClick={() => void handleGenerate()} disabled={generateState === 'saving'}
              className={`w-full ${S.radiusSm} py-2.5 text-[13px] font-medium text-white disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90`} style={{ background: S.accent }}>
              {generateState === 'saving' ? '正在生成报告...' : '生成综合报告'}
            </button>
          </div>)}
        </div>
      </div>
    </div>
  );
}
