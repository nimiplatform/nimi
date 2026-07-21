import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { DesktopRendererClockView } from '../../renderer/contract.js';

// D-STRM-010 polling recovery constants (spec: 2s interval, 30 retries, 60s total)
export const JOB_POLL_INTERVAL_MS = 2_000;
export const JOB_POLL_MAX_RETRIES = 30;
export const JOB_RECOVERY_TIMEOUT_MS = 60_000;

export type JobStatus = 'SUBMITTED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TIMEOUT';

export type JobControllerPhase =
  | 'idle'
  | 'subscribing'
  | 'recovering'
  | 'cancelling'
  | 'fetching_artifacts'
  | 'terminal'
  | 'recovery_timeout';

export type ScenarioArtifact = {
  url?: string;
  mimeType?: string;
  [key: string]: unknown;
};

export type ScenarioJobState = {
  jobId: string;
  phase: JobControllerPhase;
  jobStatus: JobStatus | null;
  progress: number | null;
  errorMessage: string | null;
  reasonCode: string | null;
  traceId: string | null;
  artifacts: ScenarioArtifact[] | null;
  pollRetryCount: number;
  cancelRequested: boolean;
  startedAt: number;
  terminalAt: number | null;
};

export type JobPollResult = {
  status: JobStatus;
  reasonCode?: string;
  reasonDetail?: string;
  traceId?: string;
  progress?: number;
};

export type JobCancelResult = {
  status: JobStatus;
  reasonCode?: string;
};

export type JobControllerDeps = {
  pollJob: (jobId: string) => Promise<JobPollResult>;
  cancelJob: (jobId: string) => Promise<JobCancelResult>;
  fetchArtifacts: (jobId: string) => Promise<ScenarioArtifact[]>;
};

type JobListener = (state: ScenarioJobState) => void;

function emptyJobState(jobId: string): ScenarioJobState {
  return {
    jobId,
    phase: 'idle',
    jobStatus: null,
    progress: null,
    errorMessage: null,
    reasonCode: null,
    traceId: null,
    artifacts: null,
    pollRetryCount: 0,
    cancelRequested: false,
    startedAt: 0,
    terminalAt: null,
  };
}

export function isTerminalStatus(status: JobStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED' || status === 'TIMEOUT';
}

function delay(clock: DesktopRendererClockView, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const cancel = clock.schedule(ms, (result) => {
      if (result.ok) {
        resolve();
      } else {
        reject(new Error(result.error));
      }
    });
    signal?.addEventListener('abort', () => {
      cancel();
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export interface ScenarioJobController {
  getJobState(jobId: string): ScenarioJobState;
  subscribeJobEvents(listener: JobListener): () => void;
  startJobTracking(jobId: string): void;
  feedJobEvent(jobId: string, event: JobPollResult): void;
  startPollingRecovery(
    jobId: string,
    deps: JobControllerDeps,
    options?: { readonly pollIntervalMs?: number },
  ): AbortController;
  requestCancel(jobId: string, deps: JobControllerDeps): Promise<void>;
  clearJobTracking(jobId: string): void;
  dispose(): void;
}

class DesktopScenarioJobController implements ScenarioJobController {
  private readonly jobs = new Map<string, ScenarioJobState>();
  private readonly recoveries = new Map<string, AbortController>();
  private readonly listeners = new Set<JobListener>();

  constructor(private readonly clock: DesktopRendererClockView) {}

  private notify(state: ScenarioJobState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // Listener failures cannot corrupt controller state or other subscribers.
      }
    }
  }

  getJobState(jobId: string): ScenarioJobState {
    return this.jobs.get(jobId) || emptyJobState(jobId);
  }

  subscribeJobEvents(listener: JobListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startJobTracking(jobId: string): void {
  const state: ScenarioJobState = {
    ...emptyJobState(jobId),
    phase: 'subscribing',
    startedAt: this.clock.now(),
  };
    this.jobs.set(jobId, state);
    this.notify(state);
  }

  feedJobEvent(jobId: string, event: JobPollResult): void {
  const current = this.jobs.get(jobId);
  if (!current || current.phase === 'terminal' || current.phase === 'recovery_timeout') {
    return;
  }

  if (isTerminalStatus(event.status)) {
    const terminalState: ScenarioJobState = {
      ...current,
      phase: 'terminal',
      jobStatus: event.status,
      progress: event.progress ?? current.progress,
      reasonCode: event.reasonCode ?? current.reasonCode,
      traceId: event.traceId ?? current.traceId,
      errorMessage: event.reasonDetail ?? current.errorMessage,
      terminalAt: this.clock.now(),
    };
    this.jobs.set(jobId, terminalState);

    // Abort any active polling recovery
    const ac = this.recoveries.get(jobId);
    if (ac) {
      ac.abort();
      this.recoveries.delete(jobId);
    }

    this.notify(terminalState);
    return;
  }

  const updated: ScenarioJobState = {
    ...current,
    jobStatus: event.status,
    progress: event.progress ?? current.progress,
    reasonCode: event.reasonCode ?? current.reasonCode,
    traceId: event.traceId ?? current.traceId,
  };
    this.jobs.set(jobId, updated);
    this.notify(updated);
  }

  startPollingRecovery(jobId: string, deps: JobControllerDeps, options?: { pollIntervalMs?: number }): AbortController {
  const current = this.jobs.get(jobId);
  if (!current) {
    this.startJobTracking(jobId);
  } else if (current.phase === 'terminal' || current.phase === 'recovery_timeout') {
    const ac = new AbortController();
    ac.abort();
    return ac;
  }

  const existing = this.recoveries.get(jobId);
  if (existing) {
    existing.abort();
    this.recoveries.delete(jobId);
  }

  const ac = new AbortController();
  this.recoveries.set(jobId, ac);

  const recoveryState: ScenarioJobState = {
    ...(this.jobs.get(jobId) || emptyJobState(jobId)),
    phase: 'recovering',
    pollRetryCount: 0,
  };
  this.jobs.set(jobId, recoveryState);
  this.notify(recoveryState);

  logRendererEvent({
    level: 'info',
    area: 'scenario-job-controller',
    message: 'scenario-job:recovery-start',
    details: { jobId },
  });

  void (async () => {
    try {
      for (let i = 0; i < JOB_POLL_MAX_RETRIES; i++) {
        await delay(this.clock, options?.pollIntervalMs ?? JOB_POLL_INTERVAL_MS, ac.signal);

        const latest = this.jobs.get(jobId);
        if (!latest || latest.phase === 'terminal' || latest.phase === 'recovery_timeout') {
          return;
        }

        const result = await deps.pollJob(jobId);

        const afterPoll = this.jobs.get(jobId);
        if (!afterPoll || afterPoll.phase === 'terminal' || afterPoll.phase === 'recovery_timeout') {
          return;
        }

        if (isTerminalStatus(result.status)) {
          let finalState: ScenarioJobState = {
            ...afterPoll,
            phase: 'terminal',
            jobStatus: result.status,
            progress: result.progress ?? afterPoll.progress,
            reasonCode: result.reasonCode ?? afterPoll.reasonCode,
            traceId: result.traceId ?? afterPoll.traceId,
            errorMessage: result.reasonDetail ?? afterPoll.errorMessage,
            pollRetryCount: i + 1,
            terminalAt: this.clock.now(),
          };

          if (result.status === 'COMPLETED') {
            finalState = { ...finalState, phase: 'fetching_artifacts' };
            this.jobs.set(jobId, finalState);
            this.notify(finalState);

            try {
              const artifacts = await deps.fetchArtifacts(jobId);
              finalState = {
                ...finalState,
                phase: 'terminal',
                artifacts,
              };
              logRendererEvent({
                level: 'info',
                area: 'scenario-job-controller',
                message: 'scenario-job:artifacts-fetched',
                details: { jobId, artifactCount: artifacts.length },
              });
            } catch {
              finalState = { ...finalState, phase: 'terminal' };
            }
          }

          this.jobs.set(jobId, finalState);
          this.recoveries.delete(jobId);
          this.notify(finalState);

          logRendererEvent({
            level: 'info',
            area: 'scenario-job-controller',
            message: 'scenario-job:recovery-terminal',
            details: { jobId, status: result.status, retries: i + 1 },
          });
          return;
        }

        const pollingState: ScenarioJobState = {
          ...afterPoll,
          jobStatus: result.status,
          progress: result.progress ?? afterPoll.progress,
          traceId: result.traceId ?? afterPoll.traceId,
          pollRetryCount: i + 1,
        };
        this.jobs.set(jobId, pollingState);
        this.notify(pollingState);
      }

      // Max retries exhausted
      const timeoutCurrent = this.jobs.get(jobId);
      if (timeoutCurrent && timeoutCurrent.phase !== 'terminal') {
        const timeoutState: ScenarioJobState = {
          ...timeoutCurrent,
          phase: 'recovery_timeout',
          pollRetryCount: JOB_POLL_MAX_RETRIES,
        };
        this.jobs.set(jobId, timeoutState);
        this.recoveries.delete(jobId);
        this.notify(timeoutState);

        logRendererEvent({
          level: 'warn',
          area: 'scenario-job-controller',
          message: 'scenario-job:recovery-timeout',
          details: { jobId, retries: JOB_POLL_MAX_RETRIES },
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      const current = this.jobs.get(jobId);
      if (current && current.phase !== 'terminal') {
        const errorState: ScenarioJobState = {
          ...current,
          phase: 'recovery_timeout',
          errorMessage: error instanceof Error ? error.message : 'Recovery failed',
        };
        this.jobs.set(jobId, errorState);
        this.recoveries.delete(jobId);
        this.notify(errorState);
      }
    }
  })();

  return ac;
  }

  async requestCancel(jobId: string, deps: JobControllerDeps): Promise<void> {
  const current = this.jobs.get(jobId);
  if (!current || current.phase === 'terminal' || current.phase === 'recovery_timeout') {
    return;
  }

  const cancellingState: ScenarioJobState = {
    ...current,
    phase: 'cancelling',
    cancelRequested: true,
  };
  this.jobs.set(jobId, cancellingState);
  this.notify(cancellingState);

  logRendererEvent({
    level: 'info',
    area: 'scenario-job-controller',
    message: 'scenario-job:cancel-requested',
    details: { jobId },
  });

  try {
    const result = await deps.cancelJob(jobId);
    if (isTerminalStatus(result.status)) {
      this.feedJobEvent(jobId, { status: result.status, reasonCode: result.reasonCode });
      return;
    }
    this.startPollingRecovery(jobId, deps);
  } catch (error) {
    const reasonCode = error instanceof Error ? error.message : String(error || '');
    if (reasonCode.includes('AI_MEDIA_JOB_NOT_CANCELLABLE')) {
      logRendererEvent({
        level: 'warn',
        area: 'scenario-job-controller',
        message: 'scenario-job:cancel-not-cancellable',
        details: { jobId },
      });

      // Job already terminal — poll once for final status
      try {
        const pollResult = await deps.pollJob(jobId);
        if (isTerminalStatus(pollResult.status)) {
          this.feedJobEvent(jobId, {
            status: pollResult.status,
            reasonCode: pollResult.reasonCode,
            reasonDetail: pollResult.reasonDetail,
            traceId: pollResult.traceId,
          });
          return;
        }
      } catch {
        // Fall through to recovery polling below.
      }
    }

    this.startPollingRecovery(jobId, deps);
  }
  }

  clearJobTracking(jobId: string): void {
  this.jobs.delete(jobId);
  const ac = this.recoveries.get(jobId);
  if (ac) {
    ac.abort();
    this.recoveries.delete(jobId);
  }
  }

  dispose(): void {
    for (const recovery of this.recoveries.values()) recovery.abort();
    this.recoveries.clear();
    this.jobs.clear();
    this.listeners.clear();
  }
}

export function createScenarioJobController(
  clock: DesktopRendererClockView,
): ScenarioJobController {
  return new DesktopScenarioJobController(clock);
}
