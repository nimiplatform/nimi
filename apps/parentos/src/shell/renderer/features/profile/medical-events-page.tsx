import { Button } from '@nimiplatform/nimi-kit/ui';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { getMedicalEvents } from '../../bridge/sqlite-bridge.js';
import type { MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import { AppSelect } from '../../app-shell/app-select.js';
import { AISummaryCard } from './ai-summary-card.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';
import { MedicalEventsAnalysisPanel } from './medical-events-analysis-panel.js';
import { MedicalEventsForm } from './medical-events-form.js';
import {
  EVENT_TYPE_LABELS,
} from './medical-events-page-shared.js';
import { MedicalEventsTimeline } from './medical-events-timeline.js';
import { useMedicalEventsFormState } from './medical-events-page-form-state.js';
import { useMedicalEventsInsights } from './medical-events-page-insights.js';

export default function MedicalEventsPage() {
  const { activeChildId, children } = useAppStore();
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

  if (!child) {
    return (
      <ProfileDetailShell title="就医记录">
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const ageMonths = computeAgeMonths(child.birthDate);

  return (
    <ProfileDetailShell
      title="就医记录"
      actions={
        <>
          {events.length > 0 ? (
            <Button
              tone={insights.showAnalysis ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => {
                insights.setShowAnalysis(!insights.showAnalysis);
                if (!insights.showAnalysis && !insights.aiInsight) void insights.generateAIInsight();
              }}
              className="rounded-2xl"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
                <path d="M11 8v6M8 11h6" />
              </svg>
              {insights.showAnalysis ? '收起分析' : '智能识别'}
            </Button>
          ) : null}
          {!formState.showForm ? (
            <Button tone="primary" size="sm" onClick={() => formState.setShowForm(true)} className="rounded-2xl">
              添加事件
            </Button>
          ) : null}
        </>
      }
      aiSummary={
        <AISummaryCard domain="medical" childName={child.displayName} childId={child.childId}
          ageLabel={`${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`} gender={child.gender}
          dataContext={events.length > 0 ? `共 ${events.length} 条就医记录` : ''}
        />
      }
    >
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
              stroke={'var(--nimi-text-muted)'} strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input placeholder="搜索诊断、医院、用药..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] py-1.5 pl-8 pr-14 text-sm text-[var(--nimi-text-primary)]" />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[13px] text-[var(--nimi-text-muted)]">清除</button>
            )}
          </div>
          <AppSelect
            value={filterType}
            onChange={setFilterType}
            options={[{ value: 'all', label: '全部类型' }, ...Object.entries(EVENT_TYPE_LABELS).map(([val, label]) => ({ value: val, label }))]}
            aria-label="筛选就医事件类型"
            className="w-40 shrink-0"
          />
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
    </ProfileDetailShell>
  );
}
