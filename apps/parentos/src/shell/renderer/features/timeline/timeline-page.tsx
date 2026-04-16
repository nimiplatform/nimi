import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { WelcomePage } from './welcome-page.js';
import { REMINDER_RULES, SENSITIVE_PERIODS } from '../../knowledge-base/index.js';
import {
  buildAllergyProfile,
  interceptAllergyCollisions,
  getActiveSeasonalAlerts,
  type EnhancedReminder,
} from '../../engine/smart-alerts.js';
import { applyReminderAction, persistAgendaPlan } from '../../engine/reminder-actions.js';
import { buildReminderAgenda, getLocalToday, type ActiveReminder } from '../../engine/reminder-engine.js';
import { useDash, buildTimelineHomeViewModel, C } from './timeline-data.js';
import {
  ChildContextCard,
  GrowthSnapshotCard,
  MilestoneTimelineCard,
  MonthlyReportCard,
  ObservationDistributionCard,
  OutdoorGoalCard,
  QuickLinksStrip,
  RecentChangesHeroCard,
  RecentLinesCard,
  SleepTrendCard,
  StageFocusCard,
  VisionCard,
} from './timeline-cards.js';
import { autoGenerateMonthlyReport } from '../reports/auto-report.js';
import { FrequencyModal } from '../reminders/frequency-modal.js';
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import { computeObservationNudges } from './timeline-observation-nudges.js';
import { ReminderPanel } from './timeline-page-panels.js';

export default function TimelinePage() {
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((item) => item.childId === activeChildId);
  const { d, loading, reload } = useDash(activeChildId);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const localToday = getLocalToday();
  const [freqOverrides, setFreqOverrides] = useState<FreqOverrideMap>(new Map());
  const [freqModalReminder, setFreqModalReminder] = useState<ActiveReminder | null>(null);
  const autoGenTriggered = useRef(false);

  const repeatableRuleIds = useMemo(
    () => REMINDER_RULES.filter((rule) => rule.repeatRule).map((rule) => rule.ruleId),
    [],
  );

  const reloadFreqOverrides = useCallback(async () => {
    if (!child) {
      setFreqOverrides(new Map());
      return;
    }
    const overrides = await loadAllFreqOverrides(child.childId, repeatableRuleIds);
    setFreqOverrides(overrides);
  }, [child, repeatableRuleIds]);

  useEffect(() => {
    void reloadFreqOverrides().catch(catchLogThen('timeline', 'action:load-freq-overrides-failed', () => setFreqOverrides(new Map())));
  }, [reloadFreqOverrides]);

  const agenda = useMemo(
    () => child ? buildReminderAgenda(REMINDER_RULES, {
      birthDate: child.birthDate,
      gender: child.gender,
      ageMonths,
      profileCreatedAt: child.createdAt,
      localToday,
      nurtureMode: child.nurtureMode,
      domainOverrides: child.nurtureModeOverrides,
    }, d.reminderStates, freqOverrides) : null,
    [child, ageMonths, localToday, d.reminderStates, freqOverrides],
  );

  const allergyProfile = useMemo(
    () => child ? buildAllergyProfile(child.allergies, d.allergyRecords) : null,
    [child, d.allergyRecords],
  );

  const todayFocus: EnhancedReminder[] = useMemo(
    () => agenda ? (allergyProfile ? interceptAllergyCollisions(agenda.todayFocus, allergyProfile) : agenda.todayFocus) : [],
    [agenda, allergyProfile],
  );

  const upcoming: EnhancedReminder[] = useMemo(
    () => agenda ? (allergyProfile ? interceptAllergyCollisions(agenda.upcoming, allergyProfile) : agenda.upcoming) : [],
    [agenda, allergyProfile],
  );

  const seasonalTasks = useMemo(() => {
    if (!allergyProfile || !child) return [];
    return getActiveSeasonalAlerts(allergyProfile).map((task) => ({ ...task, childId: child.childId }));
  }, [allergyProfile, child]);

  const periods = useMemo(
    () => SENSITIVE_PERIODS.filter((period) => ageMonths >= period.ageRange.startMonths && ageMonths <= period.ageRange.endMonths),
    [ageMonths],
  );

  const homeVm = useMemo(
    () => child && agenda ? buildTimelineHomeViewModel({ child, d, ageMonths, agenda }) : null,
    [child, d, ageMonths, agenda],
  );

  const observationNudges = useMemo(() => {
    if (!child) return [];
    const activeDims = getActiveDimensions(OBSERVATION_DIMENSIONS, ageMonths);
    return computeObservationNudges(activeDims, d.journalEntries);
  }, [child, ageMonths, d.journalEntries]);

  useEffect(() => {
    if (!child || !agenda) return;
    persistAgendaPlan(child.childId, agenda, d.reminderStates)
      .then((didPersist) => {
        if (didPersist) void reload();
      })
      .catch(catchLog('timeline', 'action:persist-agenda-plan-failed'));
  }, [child, agenda, d.reminderStates, reload]);

  useEffect(() => {
    if (!child || loading || d.latestMonthlyReport || autoGenTriggered.current) return;
    autoGenTriggered.current = true;
    autoGenerateMonthlyReport(child)
      .then((id) => {
        if (id) void reload();
      })
      .catch(catchLog('timeline', 'action:auto-generate-monthly-report-failed'));
  }, [child, loading, d.latestMonthlyReport, reload]);

  const handleAction = useCallback(async (
    reminder: EnhancedReminder,
    action: 'complete' | 'acknowledge' | 'schedule' | 'snooze' | 'mark_not_applicable' | 'dismiss_today',
    extra?: string | null,
  ) => {
    if (!child) return;
    await applyReminderAction({
      childId: child.childId,
      reminder,
      state: reminder.state,
      action,
      scheduledDate: action === 'schedule' ? extra ?? null : undefined,
      snoozedUntil: action === 'snooze' ? extra ?? null : undefined,
    }).catch(catchLog('timeline', 'action:apply-reminder-action-failed'));
    await reload();
  }, [child, reload]);

  if (!child) {
    return <WelcomePage />;
  }

  if (loading || !agenda || !homeVm) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'transparent' }}>
        <p className="text-sm" style={{ color: C.sub }}>加载中...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full" style={{ background: 'transparent' }}>
      <div className="hide-scrollbar relative min-w-0 flex-1 overflow-y-auto px-6 pb-8" style={{ paddingTop: 28 }}>
        <div className="grid auto-rows-min grid-cols-8 gap-6">
          <ChildContextCard child={child} childList={childList} ageMonths={ageMonths} />
          <RecentChangesHeroCard items={homeVm.recentChanges} />
          <QuickLinksStrip ageMonths={ageMonths} />
          {/* Growth snapshot (left) + Sleep trend & Vision (right, stacked) */}
          <div className="col-span-8 flex gap-6">
            <div className="min-w-0 flex-1 [&>div]:h-full">
              <GrowthSnapshotCard snapshot={homeVm.growthSnapshot} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              <div className="flex-1 [&>div]:h-full">
                <SleepTrendCard summary={homeVm.sleepTrend} />
              </div>
              <div className="flex-1 [&>div]:h-full">
                <VisionCard snapshot={homeVm.visionSnapshot} />
              </div>
            </div>
          </div>
          <OutdoorGoalCard records={d.outdoorRecords} goalMinutes={d.outdoorGoalMinutes} />
          {periods.length > 0 ? <StageFocusCard periods={periods} /> : null}
          <MilestoneTimelineCard summary={homeVm.milestoneTimeline} />
          <RecentLinesCard lines={homeVm.recentLines} />
          <ObservationDistributionCard summary={homeVm.observationDistribution} />
          {d.latestMonthlyReport ? <MonthlyReportCard report={d.latestMonthlyReport} /> : null}
        </div>
      </div>

      <ReminderPanel
        todayFocus={todayFocus}
        upcoming={upcoming}
        p0OverflowCount={agenda.p0Overflow.count}
        p0OverflowItems={agenda.p0Overflow.items}
        onboardingCatchupCount={agenda.onboardingCatchup.count}
        onboardingCatchupItems={agenda.onboardingCatchup.items}
        overdueCount={agenda.overdueSummary.count}
        overdueItems={agenda.overdueSummary.items}
        seasonalTasks={seasonalTasks}
        customTodos={d.customTodos}
        childId={child.childId}
        onAction={handleAction}
        onCustomTodoChanged={reload}
        observationNudges={observationNudges}
      />

      {freqModalReminder && child && freqModalReminder.rule.repeatRule && (
        <FrequencyModal
          childId={child.childId}
          ruleId={freqModalReminder.rule.ruleId}
          ruleTitle={freqModalReminder.rule.title}
          currentIntervalMonths={freqModalReminder.rule.repeatRule.intervalMonths}
          existingOverride={null}
          onSaved={() => {
            void reload();
            void reloadFreqOverrides();
          }}
          onClose={() => setFreqModalReminder(null)}
        />
      )}
    </div>
  );
}
