import type { DesktopAIActivitySnapshot } from '@nimiplatform/sdk/runtime/generated';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { SystemEntryAIState } from './system-entry-ai-model.js';
import { systemEntryDayRange, systemEntryTimestampIso } from './system-entry-time.js';

type Audit = Pick<ReturnType<DesktopRendererSdkPort['accountProduct']>['audit'], 'getDesktopAIActivitySnapshot' | 'subscribeDesktopAIActivity' | 'getDesktopAIUsageSummary'>;
export type SystemEntryAIObserver = {
  getSnapshot(): SystemEntryAIState;
  start(): void;
  refresh(): Promise<void>;
  stop(): void;
};

// @nimi-authority: rule.nimi.desktop.shell-ui.system-entry-projection
export function createSystemEntryAIObserver(input: {
  audit: Audit;
  onChange(state: SystemEntryAIState): void;
  now?: () => number;
  timeZone?: () => string;
}): SystemEntryAIObserver {
  const now = input.now ?? Date.now;
  const range = () => systemEntryDayRange(now(), input.timeZone?.());
  let state: SystemEntryAIState = { range: range(), activity: { status: 'loading', value: null, error: null }, usage: { status: 'loading', value: null, error: null } };
  let active = false;
  let epoch = 0;
  let controller: AbortController | undefined;
  let usageReading: Promise<void> | undefined;
  let usageTimer: ReturnType<typeof setTimeout> | undefined;
  let activityUsageTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let previousMembership = '';
  const publish = (next: SystemEntryAIState): void => { state = next; if (active) input.onChange(state); };
  const scheduleUsage = (): void => {
    if (usageTimer) clearTimeout(usageTimer);
    if (!active) return;
    const milliseconds = Math.max(25, Math.min(60_000, range().endMs - now() + 25));
    usageTimer = setTimeout(() => { usageTimer = undefined; void refreshUsage(); }, milliseconds);
  };
  const refreshUsage = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (usageReading) return usageReading;
    const capturedEpoch = epoch;
    const requested = range();
    if (requested.date !== state.range.date || requested.timeZone !== state.range.timeZone) {
      publish({ ...state, range: requested, usage: { status: 'loading', value: null, error: null } });
    }
    const task = (async () => {
      try {
        const response = await input.audit.getDesktopAIUsageSummary({ fromTime: requested.fromTime, toTime: requested.toTime }, { signal: controller?.signal, timeoutMs: 10_000 });
        if (!active || capturedEpoch !== epoch) return;
        const current = range();
        if (current.date !== requested.date || current.timeZone !== requested.timeZone) {
          publish({ ...state, range: current, usage: { status: 'loading', value: null, error: null } });
          return;
        }
        const summary = response.summary;
        if (!summary || systemEntryTimestampIso(summary.fromTime) !== new Date(requested.startMs).toISOString()
          || systemEntryTimestampIso(summary.toTime) !== new Date(requested.endMs).toISOString()) {
          throw new Error('system-entry-usage-range-mismatch');
        }
        publish({ ...state, range: requested, usage: { status: 'ready', value: summary, error: null } });
      } catch (error) {
        if (active && capturedEpoch === epoch) publish({ ...state, range: requested, usage: { status: 'unavailable', value: null, error: error instanceof Error ? error.message : 'system-entry-usage-unavailable' } });
      }
    })();
    const tracked = task.finally(() => {
      if (usageReading === tracked) usageReading = undefined;
      if (active && capturedEpoch === epoch) {
        const current = range();
        if (current.date !== requested.date || current.timeZone !== requested.timeZone) void refreshUsage();
        else scheduleUsage();
      }
    });
    usageReading = tracked;
    return tracked;
  };
  const acceptActivity = (snapshot: DesktopAIActivitySnapshot): void => {
    if (!snapshot.generationId || !/^\d+$/u.test(snapshot.revision)) throw new Error('system-entry-activity-invalid');
    const previous = state.activity.value;
    if (previous?.generationId === snapshot.generationId && BigInt(snapshot.revision) < BigInt(previous.revision)) return;
    publish({ ...state, activity: { status: 'ready', value: snapshot, error: null } });
    const membership = `${snapshot.generationId}:${snapshot.executions.map((execution) => execution.attemptId).sort().join('|')}`;
    if (membership !== previousMembership) {
      previousMembership = membership;
      if (activityUsageTimer) clearTimeout(activityUsageTimer);
      activityUsageTimer = setTimeout(() => { activityUsageTimer = undefined; void refreshUsage(); }, 1_000);
    }
  };
  const observe = async (capturedEpoch: number, backoffMs: number): Promise<void> => {
    try {
      const initial = await input.audit.getDesktopAIActivitySnapshot({ limit: 100 }, { signal: controller?.signal, timeoutMs: 10_000 });
      if (!active || capturedEpoch !== epoch) return;
      if (!initial.snapshot) throw new Error('system-entry-activity-unavailable');
      acceptActivity(initial.snapshot);
      for await (const snapshot of input.audit.subscribeDesktopAIActivity({ limit: 100 }, { signal: controller?.signal })) {
        if (!active || capturedEpoch !== epoch) return;
        acceptActivity(snapshot);
        backoffMs = 1_000;
      }
      if (active && capturedEpoch === epoch) throw new Error('system-entry-activity-stream-ended');
    } catch (error) {
      if (!active || capturedEpoch !== epoch) return;
      publish({ ...state, activity: { status: 'unavailable', value: null, error: error instanceof Error ? error.message : 'system-entry-activity-unavailable' } });
      retryTimer = setTimeout(() => { retryTimer = undefined; void observe(capturedEpoch, Math.min(backoffMs * 2, 15_000)); }, backoffMs);
    }
  };
  const start = (): void => {
      if (active) return;
      active = true; epoch += 1; controller = new AbortController();
      publish({ range: range(), activity: { status: 'loading', value: null, error: null }, usage: { status: 'loading', value: null, error: null } });
      void observe(epoch, 1_000); void refreshUsage();
  };
  const stop = (): void => {
      active = false; epoch += 1; controller?.abort(); controller = undefined;
      if (usageTimer) clearTimeout(usageTimer);
      if (activityUsageTimer) clearTimeout(activityUsageTimer);
      if (retryTimer) clearTimeout(retryTimer);
      usageTimer = activityUsageTimer = retryTimer = undefined;
      usageReading = undefined;
  };
  return {
    getSnapshot: () => state,
    start,
    async refresh(): Promise<void> {
      if (!active) return;
      // Renew both owner reads after an observation interruption. Merely
      // publishing the previous active list would revive stale work.
      stop(); start();
      await usageReading;
    },
    stop,
  };
}
