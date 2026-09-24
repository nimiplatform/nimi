// NimiDay's running heart while the App is open: delivers reminders and
// rhythms on time, runs skills through the on-duty agent, keeps Nimi Home in
// step and turns shared activity into source changes. Nothing here runs when
// NimiDay is closed, and nothing is replayed behind the user's back.

import type { NimiAppActivityRecord, NimiLocalAppConversationEvent } from '@nimiplatform/sdk/app';
import { planReminders } from '../domain/deliveries.js';
import { planHomeSync, type HomeCopy, type OwnRecord } from '../domain/home-sync.js';
import { newId } from '../domain/ids.js';
import { markReminder } from '../domain/items.js';
import { inQuietHours, type ReminderSettings } from '../domain/reminders.js';
import { rhythmDue } from '../domain/rhythms.js';
import { CHAT_SKILL, chatSkill, resolveSkills } from '../domain/skills.js';
import { followedChanges, NIMIDAY_APP_ID, sourceApps, type ActivityRecordLike, type SourceApp, type SourceChange } from '../domain/sources.js';
import { toLocalDate } from '../domain/time.js';
import { asksToRecord } from '../domain/quick-capture.js';
import { executeDayTool, notSavedResult } from '../domain/tools.js';
import type { DayState, Language, LifeItem, RunTrigger, SkillDefinition, SkillRun } from '../domain/types.js';
import { undoRunChanges } from '../domain/undo.js';
import { buildDayWork, methodOverflow, MethodTooLongError } from '../domain/work.js';
import { describeRemind, formatWhen, type Copy } from '../i18n/index.js';
import type { DayActions } from '../store/actions.js';
import type { DayStore } from '../store/day-store.js';
import type { ActivityBridge, ActivityCoverage, ActivityStatus } from './activity-bridge.js';
import { parseObjectRef } from './activity-bridge.js';
import type { AgentDesk, SendResult, TurnScope } from './agent-desk.js';
import { deliver } from './notifier.js';

const TICK_MS = 20_000;
const HEARTBEAT_MS = 5 * 60_000;
const TOOL_POLL_MS = 1_000;
/** Output-format failures worth one automatic retry when nothing has changed yet. */
const RETRYABLE_OUTPUT_FAILURES: ReadonlySet<string> = new Set(['AI_OUTPUT_INVALID']);
/** How often an active run asks Runtime whether its turn is still running. */
const RECONCILE_MS = 15_000;
const HOME_SYNC_DELAY_MS = 1_500;
/** Desk phases on the way to a kept appointment. */
const RESTORING_PHASES: ReadonlySet<string> = new Set(['idle', 'loading', 'opening']);

export type NavTarget =
  | { readonly view: 'today' }
  | { readonly view: 'items'; readonly itemId?: string }
  | { readonly view: 'care'; readonly circleId?: string }
  | { readonly view: 'routines'; readonly runId?: string }
  | { readonly view: 'assistant' }
  | { readonly view: 'settings' };

export type EngineState = {
  readonly now: Date;
  readonly sessionStartedAt: Date;
  readonly changes: readonly SourceChange[];
  readonly sourceApps: readonly SourceApp[];
  readonly activityStatus: ActivityStatus;
  /** How much of the shared activity is in hand; drives "load more" and what the assistant is told. */
  readonly activityCoverage: ActivityCoverage;
  readonly activityHasMore: boolean;
  readonly activeRunId: string | null;
  readonly waitingForAgent: boolean;
  /**
   * The user asked in conversation for something to be kept or arranged, the
   * reply came back, yet nothing changed in NimiDay. Shown under that reply so
   * a spoken promise is never mistaken for a saved reminder.
   */
  readonly unconfirmed: { readonly messageId: string; readonly request: string } | null;
};

export type StartSkillInput = {
  readonly skillId: string;
  readonly trigger: RunTrigger;
  /** Reuse an existing run record (a rhythm waiting for the user to start). */
  readonly runId?: string;
  readonly rhythmId?: string | null;
  readonly focusCircleId?: string | null;
  /** A routine NimiDay starts on its own: sent as an App-originated turn, never as user speech. */
  readonly routineName?: string;
  readonly scheduledFor?: string;
};

export type StartSkillResult =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly reason: 'no-agent' | 'work-unavailable' | 'unknown-skill' | 'unknown-circle' | 'method-too-long'; readonly message: string };

export type EngineDeps = {
  readonly store: DayStore;
  readonly actions: DayActions;
  readonly desk: AgentDesk;
  readonly activity: ActivityBridge;
  readonly language: () => Language;
  readonly copy: () => Copy;
  readonly navigate: (target: NavTarget) => void;
  readonly now?: () => Date;
};

type ActiveRun = {
  readonly runId: string;
  readonly turnId: string;
  /** The agent and conversation this turn was sent to; never whoever is on duty later. */
  readonly scope: TurnScope;
  readonly handled: Set<string>;
  processing: Promise<void>;
  poll: ReturnType<typeof setInterval> | null;
  /** Diagnostics kept for the run's technical details. */
  toolStarts: number;
  toolIssue: string | null;
  reconcile: ReturnType<typeof setInterval> | null;
};

function reasonOf(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? 'unknown');
  const record = error as { reasonCode?: unknown; code?: unknown; message?: unknown };
  return String(record.reasonCode ?? record.code ?? record.message ?? 'unknown');
}

function toActivityLike(record: NimiAppActivityRecord): ActivityRecordLike {
  return {
    activityId: record.activityId,
    key: record.key,
    source: {
      kind: record.source.kind,
      sourceRef: record.source.sourceRef ?? null,
      appId: record.source.appId,
      displayName: record.source.displayName,
      available: record.source.available,
    },
    revision: record.revision,
    kind: record.kind,
    todoState: record.todoState,
    attention: record.attention,
    title: record.title,
    summary: record.summary,
    objectRef: record.objectRef,
    type: record.type,
    occurredAt: record.occurredAt,
    agent: record.agent ? { displayName: record.agent.displayName } : null,
    userView: { unread: record.userView.unread, needsAttention: record.userView.needsAttention },
    groupRef: groupRefOf(record.data),
  };
}

/** A publisher's opaque grouping value (ParentOS: one per child); never parsed or trusted beyond grouping. */
function groupRefOf(data: NimiAppActivityRecord['data']): string | null {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>).groupRef : undefined;
  return typeof value === 'string' && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9._:-]+$/u.test(value) ? value : null;
}

function settingsOf(state: DayState): ReminderSettings {
  return { allDayRemindTime: state.profile.allDayRemindTime, quiet: state.profile.quiet };
}

export type DayEngine = ReturnType<typeof createDayEngine>;

export function createDayEngine(deps: EngineDeps) {
  const now = deps.now ?? (() => new Date());
  const sessionStartedAt = now();
  let state: EngineState = {
    now: sessionStartedAt,
    sessionStartedAt,
    changes: [],
    sourceApps: [],
    activityStatus: 'idle',
    activityCoverage: { openTodos: 'loading', recent: 'loading', recentCount: 0 },
    activityHasMore: false,
    activeRunId: null,
    waitingForAgent: false,
    unconfirmed: null,
  };
  const listeners = new Set<() => void>();
  const cleanups: (() => void)[] = [];
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let lastHeartbeat = 0;
  let firstTick = true;
  let quietHeld = 0;
  let wasQuiet = false;
  let homeTimer: ReturnType<typeof setTimeout> | null = null;
  let homeSyncing = false;
  const queue: string[] = [];
  let active: ActiveRun | null = null;
  let pumping = false;

  const publish = (patch: Partial<EngineState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  const data = () => deps.store.getSnapshot().state;
  const ready = () => deps.store.getSnapshot().status === 'ready';
  // Once stopped (or once the store's session has ended), nothing that was
  // already under way may still act: no sends, tool results, Home records or
  // queue progress.
  let stopped = false;
  const live = () => !stopped && ready();
  // While the post changes hands nothing queued may start, not even from a
  // finishing turn's callback: it waits for whoever is appointed next.
  let handingOver = false;
  const agentName = () => deps.desk.getState().agent?.displayName ?? data().profile.appointment?.displayName ?? deps.copy().common.agentFallback;
  const skills = (): SkillDefinition[] => resolveSkills(deps.language(), data().skillOverrides, data().customSkills);
  const circleName = (id: string | null) => (id ? data().circles.find((circle) => circle.id === id)?.name ?? null : null);

  // ---- Sources ----------------------------------------------------------------

  const recomputeChanges = () => {
    const activity = deps.activity.getState();
    const records = activity.records.map(toActivityLike);
    publish({
      activityStatus: activity.status,
      activityCoverage: activity.coverage,
      activityHasMore: activity.hasMore,
      changes: followedChanges(records, data().profile, data().circles),
      sourceApps: sourceApps(records),
    });
  };

  // ---- Reminders & rhythms ------------------------------------------------------

  const deliverReminders = (current: Date) => {
    const snapshot = data();
    const plan = planReminders(snapshot.items, current, sessionStartedAt, settingsOf(snapshot));
    if (plan.deliver.length === 0 && plan.missed.length === 0) return;
    const copy = deps.copy();
    const today = toLocalDate(current);
    const updates = new Map<string, LifeItem>();
    for (const missed of plan.missed) updates.set(missed.item.id, markReminder(missed.item, missed.at, 'missed', current));
    for (const delivery of plan.deliver) {
      updates.set(delivery.item.id, markReminder(delivery.item, delivery.at, 'reminded', current));
      if (delivery.quiet) {
        quietHeld += 1;
        continue;
      }
      const item = delivery.item;
      deliver({
        title: item.title,
        body: copy.engine.reminderBody(formatWhen(copy, item, today), circleName(item.circleId)),
        tag: `item:${item.id}`,
        tone: item.importance === 'important' ? 'warning' : 'info',
        system: snapshot.profile.systemNotifications && delivery.interrupt,
        action: { label: copy.common.open, onClick: () => deps.navigate({ view: 'items', itemId: item.id }) },
        onOpen: () => deps.navigate({ view: 'items', itemId: item.id }),
      });
    }
    deps.store.update((current) => ({
      ...current,
      items: current.items.map((item) => updates.get(item.id) ?? item),
    }), ['items']);
    if (plan.missed.length > 0 && firstTick) {
      deliver({
        title: copy.engine.missedSummary(plan.missed.length),
        body: copy.engine.missedSummaryBody,
        tag: 'missed-summary',
        system: false,
        action: { label: copy.common.open, onClick: () => deps.navigate({ view: 'today' }) },
      });
    }
  };

  const summarizeQuietHours = (current: Date) => {
    const quiet = inQuietHours(current, data().profile.quiet);
    if (wasQuiet && !quiet && quietHeld > 0) {
      const copy = deps.copy();
      deliver({
        title: copy.engine.quietSummary(quietHeld),
        body: copy.engine.quietSummaryBody,
        tag: 'quiet-summary',
        system: data().profile.systemNotifications,
        onOpen: () => deps.navigate({ view: 'today' }),
      });
      quietHeld = 0;
    }
    wasQuiet = quiet;
  };

  /**
   * Who can take a routine right now. While a kept appointment is still being
   * restored the answer is not known yet: that is neither "no assistant" nor
   * "unreachable", so routines coming due then wait for the restore to settle.
   */
  const staffing = (): 'ready' | 'restoring' | 'unreachable' | 'unappointed' => {
    const desk = deps.desk.getState();
    if (desk.phase === 'ready') return 'ready';
    if (desk.phase === 'unavailable') return 'unreachable';
    if (desk.restoring) return 'restoring';
    return 'unappointed';
  };

  const handleRhythms = (current: Date) => {
    const snapshot = data();
    const staff = staffing();
    for (const rhythm of snapshot.rhythms) {
      const due = rhythmDue(rhythm, current, sessionStartedAt);
      if (due.kind === 'none') continue;
      // Settling normally takes seconds; the on-time window still bounds the wait.
      if (due.kind === 'on-time' && staff === 'restoring') continue;
      const skill = skills().find((candidate) => candidate.id === rhythm.skillId);
      const occurrence = due.occurrence.toISOString();
      deps.store.update((state) => ({
        ...state,
        rhythms: state.rhythms.map((entry) => (entry.id === rhythm.id ? { ...entry, handledFor: occurrence } : entry)),
      }), ['rhythms']);
      const autoStart = due.kind === 'on-time' && rhythm.start === 'auto' && skill !== undefined
        && staff === 'ready' && deps.desk.work() !== null;
      if (autoStart && skill) {
        void startSkill({ skillId: skill.id, trigger: 'rhythm', rhythmId: rhythm.id, routineName: rhythm.name, scheduledFor: occurrence });
        continue;
      }
      const run: SkillRun = {
        id: newId('run', current),
        skillId: rhythm.skillId,
        skillName: skill?.name ?? rhythm.name,
        trigger: 'rhythm',
        rhythmId: rhythm.id,
        scheduledFor: occurrence,
        state: due.kind === 'missed' ? 'missed' : 'waiting-start',
        agentName: null,
        requestText: skill?.request ?? '',
        turnId: null,
        createdAt: current.toISOString(),
        startedAt: null,
        finishedAt: due.kind === 'missed' ? current.toISOString() : null,
        toolCalls: [],
        changes: [],
        undone: false,
        replyMessageId: null,
        replyText: null,
        error: due.kind === 'missed'
          ? (due.reason === 'late'
            ? { code: 'late', message: deps.copy().run.missedLate }
            : { code: 'not-running', message: deps.copy().run.missedReason })
          : null,
      };
      deps.actions.putRun(run);
      if (due.kind === 'on-time' && rhythm.notify) {
        const copy = deps.copy();
        const hasAgent = staff === 'ready';
        deliver({
          title: copy.engine.rhythmDue(rhythm.name),
          body: staff === 'unreachable' ? copy.engine.rhythmDueUnreachable(agentName()) : copy.engine.rhythmDueBody(hasAgent ? agentName() : null),
          tag: `rhythm:${rhythm.id}`,
          system: snapshot.profile.systemNotifications && !inQuietHours(current, snapshot.profile.quiet),
          action: hasAgent
            ? { label: copy.engine.rhythmStart, onClick: () => { void startSkill({ skillId: rhythm.skillId, trigger: 'rhythm', runId: run.id, rhythmId: rhythm.id }); } }
            : { label: copy.common.open, onClick: () => deps.navigate({ view: 'today' }) },
          onOpen: () => deps.navigate({ view: 'today' }),
        });
      }
    }
  };

  const tick = () => {
    if (!ready()) return;
    const current = now();
    publish({ now: current });
    summarizeQuietHours(current);
    deliverReminders(current);
    handleRhythms(current);
    if (current.getTime() - lastHeartbeat > HEARTBEAT_MS) {
      lastHeartbeat = current.getTime();
      deps.actions.updateProfile({ lastActiveAt: current.toISOString() });
    }
    firstTick = false;
  };

  // ---- Nimi Home --------------------------------------------------------------

  const homeCopy = (): HomeCopy => {
    const copy = deps.copy();
    return {
      reminderSummary: (item) => copy.engine.homeReminder(
        `${formatWhen(copy, item, toLocalDate(now()))} · ${describeRemind(copy, item.remind, item.time === null, data().profile.allDayRemindTime)}`,
        circleName(item.circleId),
      ),
      decisionSummary: (item) => copy.engine.homeDecision((item.decision?.options ?? []).join(' / ')),
      resultTitle: (run) => copy.engine.homeResultTitle(run.skillName, run.agentName ?? agentName()),
      resultSummary: (run) => copy.engine.homeResultSummary(run.changes.length),
    };
  };

  const syncHome = async () => {
    if (homeSyncing || !ready()) return;
    const activity = deps.activity.getState();
    if (activity.status !== 'ready' || !data().profile.homeMessages) return;
    homeSyncing = true;
    try {
      const own: OwnRecord[] = activity.records
        .filter((record) => record.source.kind === 'app' && record.source.appId === NIMIDAY_APP_ID)
        .map((record) => ({ activityId: record.activityId, key: record.key, revision: record.revision, kind: record.kind, todoState: record.todoState }));
      const puts = planHomeSync({ items: data().items, runs: data().runs, own, now: now(), copy: homeCopy() });
      const handle = deps.desk.getState().phase === 'ready' ? deps.desk.getState().agent?.agentHandle : undefined;
      for (const put of puts) {
        if (!live()) break;
        try {
          await deps.activity.put({
            key: put.key,
            revision: put.revision,
            kind: put.kind,
            ...(put.todoState ? { todoState: put.todoState } : {}),
            attention: put.attention,
            title: put.title.slice(0, 160),
            summary: put.summary.slice(0, 1000),
            objectRef: put.objectRef,
            type: put.type,
            data: put.data,
            occurredAt: put.occurredAt,
            ...(put.agentAttributed && handle ? { agentHandle: handle } : {}),
          });
        } catch {
          // A single failed publication is re-planned on the next sync.
        }
      }
    } finally {
      homeSyncing = false;
    }
  };

  const scheduleHomeSync = () => {
    if (homeTimer) clearTimeout(homeTimer);
    homeTimer = setTimeout(() => {
      homeTimer = null;
      void syncHome();
    }, HOME_SYNC_DELAY_MS);
  };

  // ---- Skill runs -------------------------------------------------------------

  const runById = (id: string) => data().runs.find((run) => run.id === id) ?? null;

  /** Why the on-duty agent cannot take a request right now, in the user's terms. */
  const notReadyMessage = (): string => {
    const desk = deps.desk.getState();
    const copy = deps.copy();
    return desk.unreachable ? copy.agent.unreachableBody(desk.unreachable.displayName) : copy.engine.noAgent;
  };

  const finishActive = (patch: Partial<SkillRun>) => {
    const current = active;
    if (!current) return;
    if (current.poll) clearInterval(current.poll);
    if (current.reconcile) clearInterval(current.reconcile);
    active = null;
    deps.actions.patchRun(current.runId, { finishedAt: now().toISOString(), ...patch });
    publish({ activeRunId: null });
    const run = runById(current.runId);
    if (run && run.trigger === 'chat') {
      // The conversation itself shows a plain reply; only skill use is worth a record (and an undo).
      if (run.changes.length === 0 && patch.state === 'done' && run.replyMessageId && asksToRecord(run.requestText)) {
        publish({ unconfirmed: { messageId: run.replyMessageId, request: run.requestText } });
      }
      if (run.toolCalls.length === 0 && run.changes.length === 0) deps.actions.removeRun(run.id);
      void pump();
      return;
    }
    if (run && patch.state === 'done') {
      const copy = deps.copy();
      deliver({
        title: copy.engine.runDone(run.skillName, run.agentName ?? agentName()),
        body: (run.replyText ?? '').slice(0, 140),
        tag: `run:${run.id}`,
        tone: 'success',
        system: data().profile.systemNotifications && !inQuietHours(now(), data().profile.quiet) && run.trigger === 'rhythm',
        action: { label: copy.common.open, onClick: () => deps.navigate({ view: 'routines', runId: run.id }) },
        onOpen: () => deps.navigate({ view: 'routines', runId: run.id }),
      });
    }
    void pump();
  };

  const processToolCalls = (run: ActiveRun) => {
    run.processing = run.processing.then(async () => {
      const work = deps.desk.work();
      if (!work || active !== run) return;
      const scope = run.scope;
      let calls;
      try {
        calls = await work.listToolCalls({ ...scope, turnId: run.turnId });
      } catch (error) {
        run.toolIssue = `tool-calls.list: ${reasonOf(error)}`;
        return;
      }
      if (!live()) return;
      for (const call of calls) {
        if (run.handled.has(call.callId) || active !== run) continue;
        run.handled.add(call.callId);
        let args: unknown = null;
        try {
          args = JSON.parse(call.argumentsJson);
        } catch {
          args = null;
        }
        const outcome = executeDayTool(call.name, args, {
          state: data(),
          changes: state.changes,
          sourcesAvailable: state.activityStatus === 'ready',
          sourceCoverage: state.activityCoverage,
          now: now(),
          runId: run.runId,
          agentName: agentName(),
        });
        let result = outcome.result;
        let isError = outcome.isError;
        let unsaved = false;
        if (outcome.items || outcome.notes || outcome.confirms) {
          if (outcome.items || outcome.notes) {
            deps.store.update((current) => ({
              ...current,
              ...(outcome.items ? { items: outcome.items } : {}),
              ...(outcome.notes ? { notes: outcome.notes } : {}),
            }), [...(outcome.items ? ['items' as const] : []), ...(outcome.notes ? ['notes' as const] : [])]);
          }
          // A change only counts once it is stored, and so does an entry a
          // request turned out to be: the assistant must never report something
          // done that a restart would lose.
          const saved = await deps.store.persist();
          if (!saved.ok) {
            unsaved = true;
            isError = true;
            result = notSavedResult(outcome.result, saved.error);
          }
        }
        if (!live()) return;
        let delivered = true;
        try {
          await work.submitToolResult({
            ...scope,
            turnId: run.turnId,
            callId: call.callId,
            resultJson: JSON.stringify(result),
            isError,
          });
        } catch (error) {
          delivered = false;
          run.toolIssue = `tool-result.submit: ${reasonOf(error)}`;
        }
        const copy = deps.copy();
        const summary = [outcome.summary, unsaved ? copy.run.notSaved : '', delivered ? '' : copy.run.uncertain].filter(Boolean).join(' · ');
        deps.actions.patchRun(run.runId, (current) => ({
          ...current,
          toolCalls: [...current.toolCalls, {
            callId: call.callId,
            name: call.name,
            summary,
            ok: !isError && delivered,
            at: now().toISOString(),
            ...(unsaved ? { unsaved: true } : {}),
          }],
          changes: outcome.change ? [...current.changes, outcome.change] : current.changes,
        }));
      }
    });
  };

  /**
   * A run whose terminal event never arrived (a dropped connection, a
   * conversation record NimiDay cannot read) must not stay "running" forever
   * and hold up every later run. Runtime is asked which turn is running; when
   * it is no longer this one, the run ends as "outcome unknown", keeping any
   * reply text that did arrive.
   */
  const reconcileActive = async (run: ActiveRun) => {
    if (active !== run) return;
    const current = await deps.desk.runtimeActiveTurn();
    if (current === undefined || current === run.turnId || active !== run) return;
    await run.processing;
    if (active !== run) return;
    const record = runById(run.runId);
    const streamed = deps.desk.getState().streaming;
    const partial = streamed && streamed.turnId === run.turnId ? streamed.text.trim() : '';
    finishActive({
      state: 'interrupted',
      ...(record && !record.replyText && partial ? { replyText: partial } : {}),
      error: { code: 'outcome-unknown', message: `live tools ${run.toolStarts}, handled ${run.handled.size}` },
    });
  };

  const onDeskEvent = (event: NimiLocalAppConversationEvent) => {
    const run = active;
    if (run && event.turnId === run.turnId) {
      switch (event.type) {
        case 'live-tool':
          if (event.tool.lifecycle === 'started') {
            run.toolStarts += 1;
            processToolCalls(run);
          }
          break;
        case 'message-committed':
          if (event.message.role === 'assistant') {
            const text = event.message.parts.map((part) => (part.kind === 'text' ? part.text : '')).join('\n').trim();
            deps.actions.patchRun(run.runId, { replyMessageId: event.message.messageId, replyText: text });
          }
          break;
        case 'turn-completed':
          void run.processing.then(() => finishActive({ state: 'done', error: null }));
          break;
        case 'turn-failed': {
          const record = runById(run.runId);
          // A reply in the wrong format, with nothing changed yet, is simply asked for once more.
          const retry = record !== null && RETRYABLE_OUTPUT_FAILURES.has(event.reasonCode)
            && record.changes.length === 0 && !autoRetried.has(run.runId);
          const detail = [
            event.message && event.message !== event.reasonCode ? event.message : null,
            `live tools ${run.toolStarts}, handled ${run.handled.size}`,
            run.toolIssue,
            retry ? 'retried automatically' : null,
          ].filter(Boolean).join(' · ');
          finishActive({ state: 'failed', error: { code: event.reasonCode, message: detail } });
          if (retry && record) void retryRun(record);
          break;
        }
        case 'turn-interrupted':
          finishActive({ state: 'interrupted', error: { code: event.reason, message: `live tools ${run.toolStarts}, handled ${run.handled.size}` } });
          break;
        default:
          break;
      }
    }
    if (event.type === 'turn-completed' || event.type === 'turn-failed' || event.type === 'turn-interrupted') {
      setTimeout(() => { void pump(); }, 300);
    }
  };

  const pump = async () => {
    if (!live() || handingOver || pumping || active || queue.length === 0) return;
    const desk = deps.desk.getState();
    if (desk.phase !== 'ready' || !desk.agent) return;
    if (desk.activeTurnId) {
      publish({ waitingForAgent: true });
      return;
    }
    pumping = true;
    try {
      const runId = queue[0]!;
      const run = runById(runId);
      const skill = run ? skillFor(run) : null;
      if (!run || !skill || run.state !== 'queued') {
        queue.shift();
        return;
      }
      const result = await launch(run, skill);
      if (!result.ok && result.reason === 'busy') {
        publish({ waitingForAgent: true });
        return;
      }
      queue.shift();
      if (!result.ok) {
        deps.actions.patchRun(runId, { state: 'failed', finishedAt: now().toISOString(), error: { code: result.reason, message: result.message } });
      }
    } finally {
      pumping = false;
      if (!active && queue.length > 0 && !state.waitingForAgent) setTimeout(() => { void pump(); }, 50);
    }
  };

  const skillFor = (run: SkillRun): SkillDefinition | null => (run.skillId === CHAT_SKILL
    ? chatSkill(deps.language())
    : skills().find((candidate) => candidate.id === run.skillId) ?? null);

  /** Sends one run as a work turn and makes it the active run when Runtime accepts it. */
  const launch = async (run: SkillRun, skill: SkillDefinition): Promise<SendResult> => {
    const runId = run.id;
    const desk = deps.desk.getState();
    if (desk.phase !== 'ready' || !desk.agent) return { ok: false, reason: 'not-ready', message: notReadyMessage() };
    let work: ReturnType<typeof buildDayWork>;
    try {
      work = buildDayWork({
        runId,
        skill,
        state: data(),
        changes: state.changes,
        sourcesAvailable: state.activityStatus === 'ready',
        sourceCoverage: state.activityCoverage,
        language: deps.language(),
        now: now(),
        focusCircleId: runById(runId)?.focusCircleId ?? null,
      }, desk.agent.displayName);
    } catch (error) {
      // Never hand over a shortened method: the run fails and says why.
      if (error instanceof MethodTooLongError) return { ok: false, reason: 'failed', message: deps.copy().engine.methodTooLong(skill.name) };
      throw error;
    }
    const routineName = routineByRun.get(runId);
    if (!live()) return { ok: false, reason: 'not-ready', message: notReadyMessage() };
    const result = await deps.desk.sendWork({ text: run.requestText, requestId: runId, work, ...(routineName ? { routineName } : {}) });
    if (!result.ok) return result;
    active = { runId, turnId: result.turnId, scope: result.scope, handled: new Set(), processing: Promise.resolve(), poll: null, toolStarts: 0, toolIssue: null, reconcile: null };
    const current = active;
    // Events drive execution; a light poll covers a recovered subscription that missed one.
    current.poll = setInterval(() => processToolCalls(current), TOOL_POLL_MS);
    current.reconcile = setInterval(() => { void reconcileActive(current); }, RECONCILE_MS);
    deps.actions.patchRun(runId, { state: 'running', turnId: result.turnId, startedAt: now().toISOString(), agentName: desk.agent.displayName });
    publish({ activeRunId: runId, waitingForAgent: false });
    return result;
  };

  /**
   * A message from the Assistant page. It carries the post's context and
   * NimiDay's skills, so the agent can note, look up and arrange things the
   * user asks for. It never waits in the queue: a busy agent is reported now.
   */
  const chat = (text: string): Promise<SendResult> => chatWith(text);

  const chatWith = async (text: string, onRun?: (runId: string) => void): Promise<SendResult> => {
    const desk = deps.desk.getState();
    const current = now();
    const runId = newId('run', current);
    onRun?.(runId);
    if (!deps.desk.work()) return deps.desk.send(text, runId);
    if (desk.phase !== 'ready' || !desk.agent) return { ok: false, reason: 'not-ready', message: notReadyMessage() };
    if (active || pumping || queue.length > 0 || desk.activeTurnId) return { ok: false, reason: 'busy', message: deps.copy().engine.busy(desk.agent.displayName) };
    if (state.unconfirmed) publish({ unconfirmed: null });
    const skill = chatSkill(deps.language());
    const run: SkillRun = {
      id: runId,
      skillId: CHAT_SKILL,
      skillName: skill.name,
      trigger: 'chat',
      rhythmId: null,
      scheduledFor: null,
      state: 'queued',
      agentName: desk.agent.displayName,
      requestText: text,
      turnId: null,
      createdAt: current.toISOString(),
      startedAt: null,
      finishedAt: null,
      toolCalls: [],
      changes: [],
      undone: false,
      replyMessageId: null,
      replyText: null,
      error: null,
    };
    deps.actions.putRun(run);
    pumping = true;
    try {
      const result = await launch(run, skill);
      if (!result.ok) deps.actions.removeRun(runId);
      return result;
    } finally {
      pumping = false;
      if (!active && queue.length > 0) setTimeout(() => { void pump(); }, 50);
    }
  };

  const routineByRun = new Map<string, string>();
  /** Runs started as the one automatic retry of a failed attempt; they are never retried again. */
  const autoRetried = new Set<string>();

  /** The same request as an earlier run: its skill, its trigger and the person or area it was about. */
  const againInput = (run: SkillRun): StartSkillInput => ({
    skillId: run.skillId,
    trigger: run.trigger === 'chat' ? 'user' : run.trigger,
    rhythmId: run.rhythmId,
    focusCircleId: run.focusCircleId ?? null,
  });

  const retryRun = async (failed: SkillRun) => {
    if (failed.trigger === 'chat') {
      // The failed conversation turn left nothing behind; say it again as the same request.
      deps.actions.removeRun(failed.id);
      const result = await chatWith(failed.requestText, (runId) => autoRetried.add(runId));
      if (!result.ok) return;
      return;
    }
    const routineName = routineByRun.get(failed.id);
    const started = await startSkill({
      ...againInput(failed),
      ...(routineName ? { routineName } : {}),
      ...(failed.scheduledFor ? { scheduledFor: failed.scheduledFor } : {}),
    });
    if (started.ok) autoRetried.add(started.runId);
  };

  const startSkill = async (input: StartSkillInput): Promise<StartSkillResult> => {
    const copy = deps.copy();
    const skill = skills().find((candidate) => candidate.id === input.skillId && candidate.enabled);
    if (!skill) return { ok: false, reason: 'unknown-skill', message: copy.engine.unknownSkill };
    if (methodOverflow(skill, deps.language()) > 0) return { ok: false, reason: 'method-too-long', message: copy.engine.methodTooLong(skill.name) };
    const desk = deps.desk.getState();
    if (desk.phase !== 'ready' || !desk.agent) return { ok: false, reason: 'no-agent', message: notReadyMessage() };
    if (!deps.desk.work()) return { ok: false, reason: 'work-unavailable', message: copy.engine.workUnavailable };
    const current = now();
    const circle = input.focusCircleId ? circleName(input.focusCircleId) : null;
    // A request about one person stays about that person; it never widens to everyone.
    if (input.focusCircleId && circle === null) return { ok: false, reason: 'unknown-circle', message: copy.engine.focusGone };
    const requestText = input.routineName
      ? copy.engine.routineRequest(input.routineName, skill.name)
      : skill.request.replace('{circle}', circle ?? copy.engine.everyone);
    const existing = input.runId ? runById(input.runId) : null;
    const runId = existing?.id ?? newId('run', current);
    const run: SkillRun = {
      id: runId,
      skillId: skill.id,
      skillName: skill.name,
      trigger: input.trigger,
      rhythmId: input.rhythmId ?? existing?.rhythmId ?? null,
      scheduledFor: existing?.scheduledFor ?? input.scheduledFor ?? null,
      state: 'queued',
      agentName: desk.agent.displayName,
      requestText,
      turnId: null,
      createdAt: existing?.createdAt ?? current.toISOString(),
      startedAt: null,
      finishedAt: null,
      toolCalls: [],
      changes: [],
      undone: false,
      replyMessageId: null,
      replyText: null,
      error: null,
      focusCircleId: input.focusCircleId ?? null,
    };
    if (input.routineName) routineByRun.set(runId, input.routineName);
    deps.actions.putRun(run);
    queue.push(runId);
    void pump();
    return { ok: true, runId };
  };

  // ---- Open requests from Home ------------------------------------------------

  const handleOpenRequest = async (request: { objectRef: string }): Promise<'opened' | 'object-unavailable'> => {
    const target = parseObjectRef(request.objectRef);
    if (!target) return 'object-unavailable';
    if (target.kind === 'item') {
      if (!data().items.some((item) => item.id === target.id)) return 'object-unavailable';
      deps.navigate({ view: 'items', itemId: target.id });
    } else {
      if (!runById(target.id)) return 'object-unavailable';
      deps.navigate({ view: 'routines', runId: target.id });
    }
    globalThis.focus?.();
    return 'opened';
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => {
      // A stopped engine can be started again (React re-mounts effects in development).
      stopped = false;
      cleanups.push(deps.store.subscribe(() => {
        recomputeChanges();
        scheduleHomeSync();
      }));
      cleanups.push(deps.activity.subscribe(() => {
        recomputeChanges();
        scheduleHomeSync();
      }));
      cleanups.push(deps.desk.onEvent(onDeskEvent));
      let lastPhase = deps.desk.getState().phase;
      cleanups.push(deps.desk.subscribe(() => {
        const desk = deps.desk.getState();
        if (desk.phase !== lastPhase) {
          lastPhase = desk.phase;
          // Routines that waited for the appointment to settle are handled right away.
          if (!RESTORING_PHASES.has(desk.phase)) tick();
        }
        if (active && desk.connection === 'lost') void reconcileActive(active);
        if (state.waitingForAgent && !desk.activeTurnId) {
          publish({ waitingForAgent: false });
          void pump();
        }
      }));
      deps.activity.start();
      void deps.activity.onOpenRequest(handleOpenRequest).then((stop) => cleanups.push(() => { void stop(); })).catch(() => undefined);
      const onVisible = () => { if (globalThis.document?.visibilityState === 'visible') tick(); };
      globalThis.document?.addEventListener('visibilitychange', onVisible);
      cleanups.push(() => globalThis.document?.removeEventListener('visibilitychange', onVisible));
      tickTimer = setInterval(tick, TICK_MS);
      recomputeChanges();
      tick();
    },
    stop: async () => {
      stopped = true;
      if (tickTimer) clearInterval(tickTimer);
      if (homeTimer) clearTimeout(homeTimer);
      if (active?.poll) clearInterval(active.poll);
      if (active?.reconcile) clearInterval(active.reconcile);
      cleanups.splice(0).forEach((cleanup) => cleanup());
      await deps.activity.stop();
    },
    tick,
    startSkill,
    chat,
    dismissUnconfirmed: () => publish({ unconfirmed: null }),
    /** Ask Runtime now whether the active run's turn is still running (after a reconnect, for example). */
    checkActiveRun: async () => { if (active) await reconcileActive(active); },
    /** Stop the turn NimiDay started from the Assistant page (a chat or a running skill). */
    stopActive: async (turnId: string) => {
      const run = active && active.turnId === turnId ? active : null;
      const outcome = await deps.desk.interrupt(turnId);
      // Whatever the stop reported short of success, Runtime's own view of the turn decides.
      if (outcome !== 'interrupted' && run) await reconcileActive(run);
    },
    stopRun: async () => {
      const run = active;
      if (!run) return;
      const outcome = await deps.desk.interrupt(run.turnId);
      // Its turn may already have ended without NimiDay hearing about it: Runtime's view decides.
      if (outcome !== 'interrupted') await reconcileActive(run);
    },
    /**
     * The post is about to change hands. NimiDay's own request on the current
     * agent is stopped (only that turn) and closed out here, because its events
     * and tool calls stop reaching NimiDay once the conversation is released.
     * Queued work stays queued and goes to whoever is appointed next.
     */
    /**
     * Hand the post to someone else. The queue is held for the whole handover;
     * with `stopCurrent`, NimiDay's own request on the departing agent is
     * stopped (only that turn) and closed out first. Queued work then goes to
     * whoever `appointNext` settles on, or stays queued if that fails.
     */
    handOver: async <T>(appointNext: () => Promise<T>, options: { readonly stopCurrent: boolean }): Promise<T> => {
      handingOver = true;
      try {
        const run = active;
        if (run && options.stopCurrent) {
          await deps.desk.interrupt(run.turnId);
          await run.processing;
          if (active === run) finishActive({ state: 'interrupted', error: { code: 'agent-changed', message: 'The on-duty agent changed while this was running.' } });
        }
        return await appointNext();
      } finally {
        handingOver = false;
        void pump();
      }
    },
    /** Try an earlier run again as the same request, also after NimiDay was reopened. */
    retry: async (runId: string): Promise<StartSkillResult> => {
      const run = runById(runId);
      if (!run) return { ok: false, reason: 'unknown-skill', message: deps.copy().engine.unknownSkill };
      return startSkill(againInput(run));
    },
    cancelQueued: (runId: string) => {
      const index = queue.indexOf(runId);
      if (index >= 0) queue.splice(index, 1);
      deps.actions.patchRun(runId, { state: 'dismissed', finishedAt: now().toISOString() });
    },
    dismissRun: (runId: string) => deps.actions.patchRun(runId, { state: 'dismissed' }),
    undoRun: (runId: string): { reverted: number; skipped: number; kept: number } | null => {
      const run = runById(runId);
      if (!run || run.undone) return null;
      let outcome = { reverted: 0, skipped: 0, kept: 0 };
      deps.store.update((current) => {
        const result = undoRunChanges(current, run, now());
        outcome = { reverted: result.reverted, skipped: result.skipped, kept: result.kept };
        return result.state;
      }, ['items', 'notes', 'runs']);
      return outcome;
    },
    openSource: async (change: SourceChange) => {
      try {
        return await deps.activity.open(change.id);
      } catch {
        return { outcome: 'failed' as const, reason: 'launch-failed' as const };
      }
    },
    acknowledgeSource: async (change: SourceChange) => {
      const record = deps.activity.getState().records.find((candidate) => candidate.activityId === change.id);
      if (record) await deps.activity.markRead(record);
    },
    hideSource: (change: SourceChange) => deps.actions.hideSource(change.id),
    syncHomeNow: () => syncHome(),
  };
}
