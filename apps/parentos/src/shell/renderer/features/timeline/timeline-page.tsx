import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../app-shell/app-store.js';
import { WelcomePage } from './welcome-page.js';
import { SENSITIVE_PERIODS } from '../../knowledge-base/index.js';
import type { ActiveReminder } from '../../engine/reminder-engine.js';
import { buildTimelineHomeViewModel, C } from './timeline-data.js';
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
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { ReminderPanel } from './timeline-page-panels.js';
import { useReminderPanelController } from './reminder-panel-controller.js';

export default function TimelinePage() {
  const { activeChildId, children: childList } = useAppStore();
  const child = childList.find((item) => item.childId === activeChildId);

  // Shared 待办事项 controller — owns the reminder agenda, capture handlers, and
  // the right-rail panel props. The profile 待办事项 drawer consumes the same
  // hook so both surfaces render identical content.
  const { d, loading, reload, ageMonths, agendaResult, agenda, panelProps, modalsNode } =
    useReminderPanelController(child);

  const [freqModalReminder, setFreqModalReminder] = useState<ActiveReminder | null>(null);
  const autoGenTriggered = useRef(false);

  const periods = useMemo(
    () => SENSITIVE_PERIODS.filter((period) => ageMonths >= period.ageRange.startMonths && ageMonths <= period.ageRange.endMonths),
    [ageMonths],
  );

  const homeVm = useMemo(
    () => child && agenda ? buildTimelineHomeViewModel({ child, d, ageMonths, agenda }) : null,
    [child, d, ageMonths, agenda],
  );

  useEffect(() => {
    if (!child || loading || d.latestMonthlyReport || autoGenTriggered.current) return;
    autoGenTriggered.current = true;
    autoGenerateMonthlyReport(child)
      .then((id) => {
        if (id) void reload();
      })
      .catch(catchLog('timeline', 'action:auto-generate-monthly-report-failed'));
  }, [child, loading, d.latestMonthlyReport, reload]);

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
        <ReminderPanel {...panelProps} />
      </div>

      {modalsNode}

      {freqModalReminder && freqModalReminder.rule.repeatRule && (
        <FrequencyModal
          childId={child.childId}
          ruleId={freqModalReminder.rule.ruleId}
          ruleTitle={freqModalReminder.rule.title}
          currentIntervalMonths={freqModalReminder.rule.repeatRule.intervalMonths}
          existingOverride={null}
          canDisable={freqModalReminder.rule.priority !== 'P0'}
          onSaved={() => {
            void reload();
          }}
          onClose={() => setFreqModalReminder(null)}
        />
      )}
    </div>
  );
}
