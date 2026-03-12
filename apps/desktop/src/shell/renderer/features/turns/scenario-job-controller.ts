import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

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

const activeJobs = new Map<string, ScenarioJobState>();
const recoveryAbortControllers = new Map<string, AbortController>();
const listeners = new Set<JobListener>();

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

function notify(state: ScenarioJobState): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // swallow listener errors
    }
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export function getJobState(jobId: string): ScenarioJobState {
  return activeJobs.get(jobId) || emptyJobState(jobId);
}

export function subscribeJobEvents(listener: JobListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startJobTracking(jobId: string): void {
  const state: ScenarioJobState = {
    ...emptyJobState(jobId),
    phase: 'subscribing',
    startedAt: Date.now(),
  };
  activeJobs.set(jobId, state);
  notify(state);
}

export function feedJobEvent(jobId: string, event: {
  status: JobStatus;
  reasonCode?: string;
  reasonDetail?: string;
  traceId?: string;
  progress?: number;
}): void {
  const current = activeJobs.get(jobId);
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
      terminalAt: Date.now(),
    };
    activeJobs.set(jobId, terminalState);

    // Abort any active polling recovery
    const ac = recoveryAbortControllers.get(jobId);
    if (ac) {
      ac.abort();
      recoveryAbortControllers.delete(jobId);
    }

    notify(terminalState);
    return;
  }

  const updated: ScenarioJobState = {
    ...current,
    jobStatus: event.status,
    progress: event.progress ?? current.progress,
    reasonCode: event.reasonCode ?? current.reasonCode,
    traceId: event.traceId ?? current.traceId,
  };
  activeJobs.set(jobId, updated);
  notify(updated);
}

export function startPollingRecovery(jobId: string, deps: JobControllerDeps, options?: { pollIntervalMs?: number }): AbortController {
  const current = activeJobs.get(jobId);
  if (!current) {
    startJobTracking(jobId);
  } else if (current.phase === 'terminal' || current.phase === 'recovery_timeout') {
    const ac = new AbortController();
    ac.abort();
    return ac;
  }

  const existing = recoveryAbortControllers.get(jobId);
  if (existing) {
    existing.abort();
    recoveryAbortControllers.delete(jobId);
  }

  const ac = new AbortController();
  recoveryAbortControllers.set(jobId, ac);

  const recoveryState: ScenarioJobState = {
    ...(activeJobs.get(jobId) || emptyJobState(jobId)),
    phase: 'recovering',
    pollRetryCount: 0,
  };
  activeJobs.set(jobId, recoveryState);
  notify(recoveryState);

  logRendererEvent({
    level: 'info',
    area: 'scenario-job-controller',
    message: 'scenario-job:recovery-start',
    details: { jobId },
  });

  void (async () => {
    try {
      for (let i = 0; i < JOB_POLL_MAX_RETRIES; i++) {
        await delay(options?.pollIntervalMs ?? JOB_POLL_INTERVAL_MS, ac.signal);

        const latest = activeJobs.get(jobId);
        if (!latest || latest.phase === 'terminal' || latest.phase === 'recovery_timeout') {
          return;
        }

        const result = await deps.pollJob(jobId);

        const afterPoll = activeJobs.get(jobId);
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
            terminalAt: Date.now(),
          };

          if (result.status === 'COMPLETED') {
            finalState = { ...finalState, phase: 'fetching_artifacts' };
            activeJobs.set(jobId, finalState);
            notify(finalState);

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

          activeJobs.set(jobId, finalState);
          recoveryAbortControllers.delete(jobId);
          notify(finalState);

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
        activeJobs.set(jobId, pollingState);
        notify(pollingState);
      }

      // Max retries exhausted
      const timeoutCurrent = activeJobs.get(jobId);
      if (timeoutCurrent && timeoutCurrent.phase !== 'terminal') {
        const timeoutState: ScenarioJobState = {
          ...timeoutCurrent,
          phase: 'recovery_timeout',
          pollRetryCount: JOB_POLL_MAX_RETRIES,
        };
        activeJobs.set(jobId, timeoutState);
        recoveryAbortControllers.delete(jobId);
        notify(timeoutState);

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
      const current = activeJobs.get(jobId);
      if (current && current.phase !== 'terminal') {
        const errorState: ScenarioJobState = {
          ...current,
          phase: 'recovery_timeout',
          errorMessage: error instanceof Error ? error.message : 'Recovery failed',
        };
        activeJobs.set(jobId, errorState);
        recoveryAbortControllers.delete(jobId);
        notify(errorState);
      }
    }
  })();

  return ac;
}

export async function requestCancel(jobId: string, deps: JobControllerDeps): Promise<void> {
  const current = activeJobs.get(jobId);
  if (!current || current.phase === 'terminal' || current.phase === 'recovery_timeout') {
    return;
  }

  const cancellingState: ScenarioJobState = {
    ...current,
    phase: 'cancelling',
    cancelRequested: true,
  };
  activeJobs.set(jobId, cancellingState);
  notify(cancellingState);

  logRendererEvent({
    level: 'info',
    area: 'scenario-job-controller',
    message: 'scenario-job:cancel-requested',
    details: { jobId },
  });

  try {
    const result = await deps.cancelJob(jobId);
    if (isTerminalStatus(result.status)) {
      feedJobEvent(jobId, { status: result.status, reasonCode: result.reasonCode });
      return;
    }
    startPollingRecovery(jobId, deps);
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
          feedJobEvent(jobId, {
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

    startPollingRecovery(jobId, deps);
  }
}

export function clearJobTracking(jobId: string): void {
  activeJobs.delete(jobId);
  const ac = recoveryAbortControllers.get(jobId);
  if (ac) {
    ac.abort();
    recoveryAbortControllers.delete(jobId);
  }
}
