import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, computeAgeMonths } from '../../app-shell/app-store.js';
import { WelcomePage } from './welcome-page.js';
import { REMINDER_RULES, SENSITIVE_PERIODS } from '../../knowledge-base/index.js';
import {
  buildAllergyProfile,
  interceptAllergyCollisions,
  getActiveSeasonalAlerts,
  type EnhancedReminder,
} from '../../engine/smart-alerts.js';
import { applyReminderAction, persistAgendaPlan, type ReminderActionType } from '../../engine/reminder-actions.js';
import { buildReminderAgenda, getLocalToday, UnknownReminderRuleError, type ActiveReminder } from '../../engine/reminder-engine.js';
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
import { HealthCaptureModal } from '../profile/health-capture-modal.js';
import type { LinkedHealthRecordReminder } from '../profile/health-capture-orchestrator.js';
import { getRecordDataReminderSelection } from '../reminders/record-data-capture.js';
import { parseOrthodonticReminderBinding } from '../reminders/orthodontic-record-data-capture.js';
import { OrthodonticExpanderActivationModal } from '../profile/orthodontic-expander-activation-modal.js';
import { OrthodonticAlignerSwitchModal } from '../profile/orthodontic-aligner-switch-modal.js';
import {
  getOrthodonticCheckins,
  getOrthodonticDashboard,
  getUnwearIntervals,
  type OrthodonticApplianceRow,
  type OrthodonticCheckinRow,
  type OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { DashboardTaskList, type DashboardTaskCaptureIntent } from './dashboard-task-list.js';
import { buildDashboardTaskProjection } from './dashboard-task-projection.js';
import {
  DASHBOARD_TASK_CATALOG,
  HEALTH_CAPTURE_PROTOCOLS,
  type HealthCaptureProtocolId,
} from '../../knowledge-base/index.js';

const PROTOCOL_GROUP_LOOKUP = new Map(
  HEALTH_CAPTURE_PROTOCOLS.map((protocol) => [protocol.protocolId, protocol.groupId] as const),
);

interface HealthCaptureSelection {
  groupId: string;
  metricId?: string | null;
  linkedReminder?: LinkedHealthRecordReminder | null;
}

export default function TimelinePage() {
  const navigate = useNavigate();
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((item) => item.childId === activeChildId);
  const { d, loading, reload } = useDash(activeChildId);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const localToday = getLocalToday();
  const [freqOverrides, setFreqOverrides] = useState<FreqOverrideMap>(new Map());
  const [freqModalReminder, setFreqModalReminder] = useState<ActiveReminder | null>(null);
  // Both 待办事项 → 记录 (dashboard catalog row) and reminder 记录数据 open the
  // same sidebar modal as the profile page's 添加健康数据. When `linkedReminder`
  // is set, the per-group form forwards it into the insert so
  // health_record_events.linkedReminderStateId/RuleId is written per
  // capture-orchestrator-contract.md / local-storage.yaml.
  const [captureSelection, setCaptureSelection] = useState<HealthCaptureSelection | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Orthodontic record_data dispatch (PO-ORTHO-EXPANDER-ACTIVATION /
  // PO-ORTHO-ALIGNER-CHANGE). These rules deliberately bypass
  // reminder-capture-targets.yaml (per orthodontic-protocols.yaml constraint)
  // and route the click straight to the existing per-appliance modals so the
  // parent never has to leave the dashboard to record a turn / switch.
  const [orthoCapture, setOrthoCapture] = useState<
    | { kind: 'expander-activation'; appliance: OrthodonticApplianceRow }
    | {
        kind: 'aligner-change';
        appliance: OrthodonticApplianceRow;
        intervals: OrthodonticUnwearIntervalRow[];
        checkins: OrthodonticCheckinRow[];
        nowIso: string;
      }
    | null
  >(null);
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

  const agendaResult = useMemo(() => {
    if (!child) return { kind: 'idle' as const };
    try {
      const agenda = buildReminderAgenda(REMINDER_RULES, {
        birthDate: child.birthDate,
        gender: child.gender,
        ageMonths,
        profileCreatedAt: child.createdAt,
        localToday,
        nurtureMode: child.nurtureMode,
        domainOverrides: child.nurtureModeOverrides,
      }, d.reminderStates, freqOverrides);
      return { kind: 'ok' as const, agenda };
    } catch (error) {
      if (error instanceof UnknownReminderRuleError) {
        return { kind: 'unknown-rule' as const, ruleIds: error.ruleIds };
      }
      throw error;
    }
  }, [child, ageMonths, localToday, d.reminderStates, freqOverrides]);

  const agenda = agendaResult.kind === 'ok' ? agendaResult.agenda : null;

  const allergyProfile = useMemo(
    () => child ? buildAllergyProfile(child.allergies, d.allergyRecords) : null,
    [child, d.allergyRecords],
  );

  const todayFocus: EnhancedReminder[] = useMemo(
    () => agenda ? (allergyProfile ? interceptAllergyCollisions(agenda.todayFocus, allergyProfile) : agenda.todayFocus) : [],
    [agenda, allergyProfile],
  );

  const upcoming: EnhancedReminder[] = useMemo(() => {
    if (!agenda) return [];
    const base = allergyProfile
      ? interceptAllergyCollisions(agenda.upcoming, allergyProfile)
      : agenda.upcoming;
    // PO-ORTHO-ALIGNER-CHANGE lead time: floor(daysPerAligner / 2). Short cycles
    // (e.g. 7 days) get a 3-day lead window instead of the global 7-day window so
    // the reminder doesn't sit at the bottom of the list for the entire cycle.
    // The cycle progress widget below the list still shows full progress.
    const cycle = d.orthoCycle;
    if (!cycle) return base;
    const leadDays = Math.max(1, Math.floor(cycle.daysPerAligner / 2));
    return base.filter((reminder) => {
      if (reminder.rule.ruleId !== 'PO-ORTHO-ALIGNER-CHANGE') return true;
      return reminder.daysUntilStart <= leadDays;
    });
  }, [agenda, allergyProfile, d.orthoCycle]);

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

  // Catalog-only count for the 待办事项 → 今天 tab badge and default-tab pick.
  // Mirrors the projection that <DashboardTaskList showOnly="catalog" /> builds
  // internally; both stay deterministic per PO-TIME-010.a so the counts agree.
  const dashboardCatalogCount = useMemo(() => {
    if (!child || !agenda) return 0;
    const projection = buildDashboardTaskProjection({
      today: localToday,
      child: { childId: child.childId, birthDate: child.birthDate },
      reminderAgenda: agenda,
      customTodos: d.customTodos,
      catalogRows: DASHBOARD_TASK_CATALOG,
    });
    return projection.mainList.filter((entry) => entry.source === 'catalog').length;
  }, [child, agenda, localToday, d.customTodos]);

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
    reminder: ActiveReminder,
    action: ReminderActionType,
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

  const openRecordDataCapture = useCallback(async (reminder: ActiveReminder) => {
    setCaptureError(null);
    // Orthodontic protocol reminders route to per-appliance modals instead of
    // the generic HealthCaptureModal — their capture surface is governed by
    // orthodontic-protocols.yaml checkinType bindings, not
    // reminder-capture-targets.yaml.
    let orthoBinding: ReturnType<typeof parseOrthodonticReminderBinding>;
    try {
      orthoBinding = parseOrthodonticReminderBinding(reminder);
    } catch (parseError) {
      setCaptureSelection(null);
      setOrthoCapture(null);
      setCaptureError(parseError instanceof Error ? parseError.message : String(parseError));
      return;
    }
    if (orthoBinding) {
      if (!child) return;
      try {
        if (orthoBinding.kind === 'unwear-open') {
          // Closing an open wear-gap interval is a per-appliance action with no
          // dashboard-resident modal yet; jump to /profile so the parent can
          // manage the interval from the orthodontic surface.
          navigate('/profile');
          return;
        }
        const dashboard = await getOrthodonticDashboard(child.childId);
        const appliance = dashboard.activeAppliances.find(
          (row) => row.applianceId === orthoBinding!.applianceId,
        );
        if (!appliance) {
          throw new Error(`找不到提醒绑定的矫治器（applianceId=${orthoBinding.applianceId}）`);
        }
        if (orthoBinding.kind === 'expander-activation') {
          setCaptureSelection(null);
          setOrthoCapture({ kind: 'expander-activation', appliance });
          return;
        }
        // aligner-change needs intervals + checkins to compute the cycle
        // progress that drives the modal's next-tray default.
        const [intervals, checkins] = await Promise.all([
          getUnwearIntervals({ applianceId: appliance.applianceId, limit: null }),
          getOrthodonticCheckins({ applianceId: appliance.applianceId, limitDays: null }),
        ]);
        setCaptureSelection(null);
        setOrthoCapture({
          kind: 'aligner-change',
          appliance,
          intervals,
          checkins,
          nowIso: new Date().toISOString(),
        });
      } catch (loadError) {
        setCaptureSelection(null);
        setOrthoCapture(null);
        setCaptureError(loadError instanceof Error ? loadError.message : String(loadError));
      }
      return;
    }
    try {
      setCaptureSelection(getRecordDataReminderSelection(reminder));
    } catch (nextError) {
      setCaptureSelection(null);
      setCaptureError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [child, navigate]);

  // Dashboard task `maintain` card → HealthCaptureModal sidebar selection.
  // The catalog row's captureProtocolId maps to a sidebar group; the 记录
  // button opens the same per-group form that the profile page's 添加健康
  // 数据 entry uses. metricIds[0] is forwarded as initialMetricId so the form
  // can highlight the metric the catalog row asks to capture.
  const openDashboardTaskCapture = useCallback((intent: DashboardTaskCaptureIntent) => {
    setCaptureError(null);
    const groupId = PROTOCOL_GROUP_LOOKUP.get(intent.captureProtocolId as HealthCaptureProtocolId);
    if (!groupId) {
      setCaptureSelection(null);
      setCaptureError(`未识别的 captureProtocolId: ${intent.captureProtocolId}`);
      return;
    }
    setCaptureSelection({ groupId, metricId: intent.metricIds[0] ?? null });
  }, []);

  if (!child) {
    return <WelcomePage />;
  }

  if (agendaResult.kind === 'unknown-rule') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center" style={{ color: '#b91c1c' }}>
        <p className="text-base font-medium">提醒目录不完整</p>
        <p className="text-[14px]" style={{ color: C.sub }}>
          发现未登记的 ruleId：{agendaResult.ruleIds.join('、')}
        </p>
        <p className="text-[14px]" style={{ color: C.sub }}>
          提醒流按 PO-TIME-007 fail-close。重启 ParentOS 即可触发 schema v17 自动清理这些游离记录；如果重启后仍有未登记的 ruleId，请修复 reminder-rules.yaml 或 orthodontic-protocols.yaml。
        </p>
      </div>
    );
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
      {/* Ambient gradient — diffuse pink + blue cloud that warms the whole dashboard.
       * Placed once at the page shell so inner cards stay neutral and don't stack blurs. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        style={{
          backgroundImage: [
            'radial-gradient(at 18% 12%, rgba(186,230,253,0.35) 0px, transparent 52%)',
            'radial-gradient(at 82% 18%, rgba(255,207,226,0.28) 0px, transparent 52%)',
            'radial-gradient(at 48% 96%, rgba(221,214,254,0.26) 0px, transparent 55%)',
          ].join(', '),
          filter: 'blur(28px)',
        }}
      />
      <div className="hide-scrollbar relative z-[1] min-w-0 flex-1 overflow-y-auto px-6 pb-8" style={{ paddingTop: 28 }}>
        <div className="mb-6 flex gap-6">
          <ChildContextCard child={child} ageMonths={ageMonths} />
          <RecentChangesHeroCard items={homeVm.recentChanges} />
        </div>
        <div className="grid auto-rows-min grid-cols-8 gap-6">
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

      <div className="relative z-[1]">
        {/* Catalog-only DashboardTaskList renders inside the 待办事项 panel's
         * 今天 tab via the `dashboardTodayContent` slot. showOnly='catalog' +
         * headerless skips reminder/personal rows (already owned by the panel)
         * and strips the outer 今日任务 card so the cards inline cleanly. */}
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
          orthoCycle={d.orthoCycle}
          onAction={handleAction}
          onOpenCapture={openRecordDataCapture}
          onCustomTodoChanged={reload}
          observationNudges={observationNudges}
          dashboardTodayCount={dashboardCatalogCount}
          dashboardTodayContent={
            <DashboardTaskList
              today={localToday}
              child={{ childId: child.childId, birthDate: child.birthDate }}
              reminderAgenda={agenda}
              customTodos={d.customTodos}
              onDashboardTaskCapture={openDashboardTaskCapture}
              showOnly="catalog"
              headerless
            />
          }
        />
      </div>

      {captureError ? (
        <div className="absolute bottom-5 right-5 z-[2] rounded-[16px] px-4 py-3 text-[13px]" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          {captureError}
        </div>
      ) : null}

      {captureSelection ? (
        <HealthCaptureModal
          open
          childId={child.childId}
          childBirthDate={child.birthDate}
          initialGroupId={captureSelection.groupId}
          initialMetricId={captureSelection.metricId ?? null}
          linkedReminder={captureSelection.linkedReminder ?? null}
          onClose={() => {
            setCaptureSelection(null);
          }}
          onSaved={() => {
            const groupId = captureSelection.groupId;
            setCaptureSelection(null);
            navigate(`/profile?focus=${encodeURIComponent(groupId)}`);
          }}
        />
      ) : null}

      {orthoCapture?.kind === 'expander-activation' ? (
        <OrthodonticExpanderActivationModal
          appliance={orthoCapture.appliance}
          onClose={() => setOrthoCapture(null)}
          onSaved={async () => {
            setOrthoCapture(null);
            await reload();
          }}
          onError={setCaptureError}
        />
      ) : null}

      {orthoCapture?.kind === 'aligner-change' ? (
        <OrthodonticAlignerSwitchModal
          appliance={orthoCapture.appliance}
          intervals={orthoCapture.intervals}
          checkins={orthoCapture.checkins}
          nowIso={orthoCapture.nowIso}
          onClose={() => setOrthoCapture(null)}
          onSaved={async () => {
            setOrthoCapture(null);
            await reload();
          }}
          onError={setCaptureError}
        />
      ) : null}

      {freqModalReminder && child && freqModalReminder.rule.repeatRule && (
        <FrequencyModal
          childId={child.childId}
          ruleId={freqModalReminder.rule.ruleId}
          ruleTitle={freqModalReminder.rule.title}
          currentIntervalMonths={freqModalReminder.rule.repeatRule.intervalMonths}
          existingOverride={null}
          canDisable={freqModalReminder.rule.priority !== 'P0'}
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
