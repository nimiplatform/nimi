// Reminder panel controller — shared data pipeline + capture-modal cluster for
// the 待办事项 surface. Both the dashboard right rail (`TimelinePage`) and the
// profile 待办事项 drawer (`ProfileTodoDrawer`) consume this so the two
// surfaces render identical content and behavior from one source of truth.
//
// The hook owns: reminder agenda construction, allergy interception, seasonal
// alerts, observation nudges, the PO-TIME-010 dashboard-task catalog count, and
// the record-data / orthodontic capture handlers + modal state. It returns the
// props for `<ReminderPanel>` and a ready-to-render `modalsNode`.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { computeAgeMonths, type ChildProfile } from '../../app-shell/app-store.js';
import {
  REMINDER_RULES,
  OBSERVATION_DIMENSIONS,
  DASHBOARD_TASK_CATALOG,
  HEALTH_CAPTURE_PROTOCOLS,
  type HealthCaptureProtocolId,
} from '../../knowledge-base/index.js';
import {
  buildAllergyProfile,
  interceptAllergyCollisions,
  getActiveSeasonalAlerts,
  type EnhancedReminder,
} from '../../engine/smart-alerts.js';
import { applyReminderAction, persistAgendaPlan, type ReminderActionType } from '../../engine/reminder-actions.js';
import {
  buildReminderAgenda,
  getLocalToday,
  UnknownReminderRuleError,
  type ActiveReminder,
  type ReminderAgenda,
} from '../../engine/reminder-engine.js';
import { loadAllFreqOverrides, type FreqOverrideMap } from '../../engine/reminder-freq-overrides.js';
import { getActiveDimensions } from '../../engine/observation-matcher.js';
import { catchLog, catchLogThen } from '../../infra/telemetry/catch-log.js';
import { computeObservationNudges } from './timeline-observation-nudges.js';
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
import { useDash, type DashData } from './timeline-data.js';
import { ReminderPanel, type ReminderPanelProps } from './timeline-page-panels.js';

const PROTOCOL_GROUP_LOOKUP = new Map(
  HEALTH_CAPTURE_PROTOCOLS.map((protocol) => [protocol.protocolId, protocol.groupId] as const),
);

interface HealthCaptureSelection {
  groupId: string;
  metricId?: string | null;
  linkedReminder?: LinkedHealthRecordReminder | null;
}

type OrthoCaptureState =
  | { kind: 'expander-activation'; appliance: OrthodonticApplianceRow }
  | {
      kind: 'aligner-change';
      appliance: OrthodonticApplianceRow;
      intervals: OrthodonticUnwearIntervalRow[];
      checkins: OrthodonticCheckinRow[];
      nowIso: string;
    }
  | null;

export type AgendaResult =
  | { kind: 'idle' }
  | { kind: 'ok'; agenda: ReminderAgenda }
  | { kind: 'unknown-rule'; ruleIds: readonly string[] };

export interface ReminderPanelController {
  d: DashData;
  loading: boolean;
  reload: () => Promise<void>;
  ageMonths: number;
  agendaResult: AgendaResult;
  agenda: ReminderAgenda | null;
  /** Props for `<ReminderPanel>` — caller adds `embedded` for the drawer. */
  panelProps: Omit<ReminderPanelProps, 'embedded'>;
  /** Capture modals (record-data / orthodontic) + error toast. The modals
   *  portal to `document.body`, so this is safe to render inside a transformed
   *  drawer surface. */
  modalsNode: ReactNode;
}

/**
 * Shared controller for the 待办事项 panel. `child` is `undefined` before a
 * child profile is selected — the hook stays inert (empty agenda) in that case.
 */
export function useReminderPanelController(child: ChildProfile | undefined): ReminderPanelController {
  const navigate = useNavigate();
  const { d, loading, reload } = useDash(child?.childId ?? null);
  const ageMonths = child ? computeAgeMonths(child.birthDate) : 0;
  const localToday = getLocalToday();

  const [freqOverrides, setFreqOverrides] = useState<FreqOverrideMap>(new Map());
  const [captureSelection, setCaptureSelection] = useState<HealthCaptureSelection | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [orthoCapture, setOrthoCapture] = useState<OrthoCaptureState>(null);

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
    void reloadFreqOverrides().catch(
      catchLogThen('timeline', 'action:load-freq-overrides-failed', () => setFreqOverrides(new Map())),
    );
  }, [reloadFreqOverrides]);

  const agendaResult = useMemo<AgendaResult>(() => {
    if (!child) return { kind: 'idle' };
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
      return { kind: 'ok', agenda };
    } catch (error) {
      if (error instanceof UnknownReminderRuleError) {
        return { kind: 'unknown-rule', ruleIds: error.ruleIds };
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
    // get a tighter lead window so the reminder doesn't sit at the bottom of the
    // list for the entire cycle.
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

  const observationNudges = useMemo(() => {
    if (!child) return [];
    const activeDims = getActiveDimensions(OBSERVATION_DIMENSIONS, ageMonths);
    return computeObservationNudges(activeDims, d.journalEntries);
  }, [child, ageMonths, d.journalEntries]);

  // Catalog-only count for the 今天 tab badge and default-tab pick. Mirrors the
  // projection that `<DashboardTaskList showOnly="catalog" />` builds internally.
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

  const dashboardTodayContent = agenda && child ? (
    <DashboardTaskList
      today={localToday}
      child={{ childId: child.childId, birthDate: child.birthDate }}
      reminderAgenda={agenda}
      customTodos={d.customTodos}
      onDashboardTaskCapture={openDashboardTaskCapture}
      showOnly="catalog"
      headerless
    />
  ) : null;

  const panelProps: Omit<ReminderPanelProps, 'embedded'> = {
    todayFocus,
    upcoming,
    p0OverflowCount: agenda?.p0Overflow.count ?? 0,
    p0OverflowItems: agenda?.p0Overflow.items ?? [],
    onboardingCatchupCount: agenda?.onboardingCatchup.count ?? 0,
    onboardingCatchupItems: agenda?.onboardingCatchup.items ?? [],
    overdueCount: agenda?.overdueSummary.count ?? 0,
    overdueItems: agenda?.overdueSummary.items ?? [],
    seasonalTasks,
    customTodos: d.customTodos,
    childId: child?.childId ?? '',
    orthoCycle: d.orthoCycle,
    onAction: handleAction,
    onOpenCapture: openRecordDataCapture,
    onCustomTodoChanged: reload,
    observationNudges,
    dashboardTodayCount: dashboardCatalogCount,
    dashboardTodayContent,
  };

  const modalsNode = (
    <>
      {captureError ? (
        <div
          className="fixed bottom-5 right-5 z-[110] rounded-[16px] px-4 py-3 text-[13px]"
          style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
        >
          {captureError}
        </div>
      ) : null}

      {captureSelection && child ? (
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
    </>
  );

  return { d, loading, reload, ageMonths, agendaResult, agenda, panelProps, modalsNode };
}

/**
 * Self-contained 待办事项 panel for embedding surfaces (the profile drawer).
 * Renders the embedded `<ReminderPanel>` plus its capture modals. The host owns
 * the outer frame (header, scroll container, slide-in chrome).
 */
export function ReminderPanelSurface({ child }: { child: ChildProfile }) {
  const { panelProps, modalsNode } = useReminderPanelController(child);
  return (
    <>
      <ReminderPanel {...panelProps} embedded />
      {modalsNode}
    </>
  );
}
