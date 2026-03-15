import { type JobControllerDeps, type JobPollResult, type JobStatus, feedJobEvent, getJobState, startJobTracking } from '../../features/turns/scenario-job-controller';

type RuntimeScenarioJobHelperInput = {
  getRuntimeClient: () => {
    media: {
      jobs: {
        cancel: (input: { jobId: string; reason?: string }) => Promise<unknown>;
        get: (jobId: string) => Promise<unknown>;
        getArtifacts: (jobId: string) => Promise<{ artifacts?: unknown[] }>;
      };
    };
  };
};

export function normalizeScenarioJobStatus(value: unknown): JobStatus | null {
  const numeric = Number(value);
  if (numeric === 1) return 'SUBMITTED';
  if (numeric === 2) return 'QUEUED';
  if (numeric === 3) return 'RUNNING';
  if (numeric === 4) return 'COMPLETED';
  if (numeric === 5) return 'FAILED';
  if (numeric === 6) return 'CANCELED';
  if (numeric === 7) return 'TIMEOUT';
  const normalized = String(value || '').trim().toUpperCase();
  if (
    normalized === 'SUBMITTED'
    || normalized === 'QUEUED'
    || normalized === 'RUNNING'
    || normalized === 'COMPLETED'
    || normalized === 'FAILED'
    || normalized === 'CANCELED'
    || normalized === 'TIMEOUT'
  ) {
    return normalized;
  }
  return null;
}

export function toControllerJobSnapshot(value: unknown): JobPollResult | null {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const status = normalizeScenarioJobStatus(record.status);
  if (!status) {
    return null;
  }
  const progress = Number(record.progress);
  return {
    status,
    ...(String(record.reasonCode || '').trim() ? { reasonCode: String(record.reasonCode || '').trim() } : {}),
    ...(String(record.reasonDetail || '').trim() ? { reasonDetail: String(record.reasonDetail || '').trim() } : {}),
    ...(String(record.traceId || '').trim() ? { traceId: String(record.traceId || '').trim() } : {}),
    ...(Number.isFinite(progress) ? { progress } : {}),
  };
}

export function feedControllerJobSnapshot(jobId: string, value: unknown): void {
  const snapshot = toControllerJobSnapshot(value);
  if (!snapshot) {
    return;
  }
  if (getJobState(jobId).phase === 'idle') {
    startJobTracking(jobId);
  }
  feedJobEvent(jobId, snapshot);
}

export function createScenarioJobControllerDeps(
  runtime: RuntimeScenarioJobHelperInput,
  inputValue?: {
    cancelReason?: string;
    captureCancelResponse?: (value: unknown) => void;
    capturePolledJob?: (value: unknown) => void;
  },
): JobControllerDeps {
  return {
    pollJob: async (jobId: string) => {
      const job = await runtime.getRuntimeClient().media.jobs.get(jobId);
      inputValue?.capturePolledJob?.(job);
      const snapshot = toControllerJobSnapshot(job);
      if (!snapshot) {
        throw new Error('DESKTOP_SCENARIO_JOB_STATUS_REQUIRED');
      }
      return snapshot;
    },
    cancelJob: async (jobId: string) => {
      const job = await runtime.getRuntimeClient().media.jobs.cancel({
        jobId,
        reason: inputValue?.cancelReason,
      });
      inputValue?.captureCancelResponse?.(job);
      const snapshot = toControllerJobSnapshot(job);
      if (!snapshot) {
        throw new Error('DESKTOP_SCENARIO_JOB_STATUS_REQUIRED');
      }
      return {
        status: snapshot.status,
        ...(snapshot.reasonCode ? { reasonCode: snapshot.reasonCode } : {}),
      };
    },
    fetchArtifacts: async (jobId: string) => {
      const artifactsResponse = await runtime.getRuntimeClient().media.jobs.getArtifacts(jobId);
      if (!Array.isArray(artifactsResponse.artifacts)) {
        return [];
      }
      return artifactsResponse.artifacts.map((artifact) => ({
        ...(artifact as Record<string, unknown>),
      }));
    },
  };
}
