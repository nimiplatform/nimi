import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore, computeAgeMonths, formatAge } from '../../app-shell/app-store.js';
import { getMedicalEvents } from '../../bridge/sqlite-bridge.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { MedicalEventsAnalysisPanel } from './medical-events-analysis-panel.js';
import { MedicalEventsForm } from './medical-events-form.js';
import {
  EVENT_TYPE_LABELS,
} from './medical-events-page-shared.js';
import { MedicalEventsTimeline } from './medical-events-timeline.js';
import { useMedicalEventsFormState } from './medical-events-page-form-state.js';
import { useMedicalEventsInsights } from './medical-events-page-insights.js';

export default function MedicalEventsPage() {
  const { activeChildId, setActiveChildId, children } = useAppStore();
  const child = children.find((c) => c.childId === activeChildId);
  const [events, setEvents] = useState<MedicalEventRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');

  useEffect(() => {
    if (activeChildId) {
      getMedicalEvents(activeChildId).then(setEvents).catch(catchLog('medical-events', 'action:load-medical-events-failed'));
    }
  }, [activeChildId]);

  const formState = useMedicalEventsFormState(child, events, setEvents);
  const insights = useMedicalEventsInsights(child, events);

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

  if (!child) return <div className="p-8" style={{ color: S.sub }}>请先添加孩子</div>;

  const ageMonths = computeAgeMonths(child.birthDate);

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, minHeight: '100%' }}>
      <div className="flex items-center gap-2 mb-6">
        <Link to="/profile" className="text-[14px] hover:underline" style={{ color: S.sub }}>&larr; 返回档案</Link>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: S.text }}>就医记录</h1>
        <div className="flex gap-2">
          {events.length > 0 ? (
            <button
              onClick={() => {
                insights.setShowAnalysis(!insights.showAnalysis);
                if (!insights.showAnalysis && !insights.aiInsight) void insights.generateAIInsight();
              }}
              className={S.radiusSm + ' text-sm px-4 py-2 text-white flex items-center gap-1.5'}
              style={{ background: insights.showAnalysis ? '#6b7280' : S.blue }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
                <path d="M11 8v6M8 11h6" />
              </svg>
              {insights.showAnalysis ? '收起分析' : '智能识别'}
            </button>
          ) : null}
          {!formState.showForm ? (
            <button onClick={() => formState.setShowForm(true)} className={S.radiusSm + ' text-sm px-4 py-2 text-white'} style={{ background: S.accent }}>
              添加事件
            </button>
          ) : null}
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

      {events.length > 0 && insights.analysis && insights.showAnalysis ? (
        <MedicalEventsAnalysisPanel
          analysis={insights.analysis}
          aiInsight={insights.aiInsight}
          aiLoading={insights.aiLoading}
          onRefresh={() => { void insights.generateAIInsight(true); }}
          onSelectDiagnosis={(diagnosis) => {
            setSearchQuery(diagnosis);
            insights.setShowAnalysis(false);
          }}
          onSelectMedication={(name) => {
            setSearchQuery(name);
            insights.setShowAnalysis(false);
          }}
        />
      ) : null}

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
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: S.sub }}>清除</button>
            )}
          </div>
          <AppSelect value={filterType} onChange={setFilterType}
            options={[{ value: 'all', label: '全部类型' }, ...Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => ({ value: val, label }))]} />
        </div>
      )}

      {/* ── Add Form ── */}
      {formState.showForm ? (
        <MedicalEventsForm
          editingEventId={formState.editingEventId}
          formEventType={formState.formEventType}
          setFormEventType={formState.setFormEventType}
          formTitle={formState.formTitle}
          setFormTitle={formState.setFormTitle}
          formEventDate={formState.formEventDate}
          setFormEventDate={formState.setFormEventDate}
          formEndDate={formState.formEndDate}
          setFormEndDate={formState.setFormEndDate}
          formShowEndDate={formState.formShowEndDate}
          setFormShowEndDate={formState.setFormShowEndDate}
          formSeverity={formState.formSeverity}
          setFormSeverity={formState.setFormSeverity}
          formResult={formState.formResult}
          setFormResult={formState.setFormResult}
          formHospital={formState.formHospital}
          setFormHospital={formState.setFormHospital}
          formNotes={formState.formNotes}
          setFormNotes={formState.setFormNotes}
          formLabValues={formState.formLabValues}
          setFormLabValues={formState.setFormLabValues}
          formSymptomTags={formState.formSymptomTags}
          setFormSymptomTags={formState.setFormSymptomTags}
          formMeds={formState.formMeds}
          setFormMeds={formState.setFormMeds}
          historyDrugs={formState.historyDrugs}
          ocrLoading={formState.ocrLoading}
          ocrError={formState.ocrError}
          ocrImageName={formState.ocrImageName}
          ocrInputRef={formState.ocrInputRef}
          submitError={formState.submitError}
          saving={formState.saving}
          onClose={formState.closeForm}
          onSubmit={() => { void formState.submitForm(); }}
          onOCRUpload={(file) => { void formState.handleOCRUpload(file); }}
        />
      ) : null}

      <section>
        <MedicalEventsTimeline
          events={events}
          filteredEvents={filteredEvents}
          searchQuery={searchQuery}
          eventAiLoading={insights.eventAiLoading}
          eventAiResult={insights.eventAiResult}
          onEdit={formState.startEditing}
          onAnalyze={(event) => { void insights.analyzeEvent(event); }}
          onCloseAI={insights.closeEventAnalysis}
        />
      </section>
    </div>
  );
}
