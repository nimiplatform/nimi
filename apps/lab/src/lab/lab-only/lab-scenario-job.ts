import type { NimiLocalAppClient, NimiLocalAppScenarioJob } from '@nimiplatform/sdk/app';
import { runtimeScenarioJobNonSuccessReasonFromError } from '@nimiplatform/kit/features/generation/runtime';
import {
  studioNonSuccessDiagnostics,
  studioNonSuccessReason,
  studioRuntimeErrorMessage,
  type StudioCapabilityNonSuccessFactory,
} from '../../ai-studio-core/runtime.js';
import type {
  StudioNonSuccess,
  StudioNonSuccessReason,
  StudioRuntimeCapabilityDescriptor,
} from '../../ai-studio-core/runtime-types.js';
import { t } from '../../shell/i18n/index.js';

type ScenarioJobs = Pick<NimiLocalAppClient['ai']['scenarioJobs'], 'get' | 'subscribe' | 'cancel'>;

export type LabScenarioJobOutcome =
  | { readonly kind: 'completed'; readonly job: NimiLocalAppScenarioJob }
  // terminal is true only when the owner reported a terminal Job state.
  | { readonly kind: 'non-success'; readonly result: StudioNonSuccess; readonly terminal: boolean };

const TERMINAL_STATES = new Set<NimiLocalAppScenarioJob['status']>(['completed', 'failed', 'canceled', 'timeout']);

export function isLabScenarioJobTerminal(job: NimiLocalAppScenarioJob): boolean {
  return TERMINAL_STATES.has(job.status);
}

/**
 * Observes an already issued Job to its owner-reported terminal state. Every
 * non-success keeps the Job ID and the owner's reason. A Submit whose response
 * never arrived has no Job ID; callers let that error propagate instead of
 * retrying or inventing an identity, because these Lab test and World Tour
 * Job types do not accept a client submission ID for lookup.
 */
export async function observeLabScenarioJob(input: {
  readonly scenarioJobs: ScenarioJobs;
  readonly jobId: string;
  readonly capability: StudioRuntimeCapabilityDescriptor;
  readonly nonSuccess: StudioCapabilityNonSuccessFactory;
  readonly cancelReason: string;
  readonly signal?: AbortSignal;
  readonly onJob?: (job: NimiLocalAppScenarioJob) => void;
}): Promise<LabScenarioJobOutcome> {
  const { scenarioJobs, jobId } = input;
  let cancelRequested = false;
  const requestCancel = () => {
    if (cancelRequested) return;
    cancelRequested = true;
    void scenarioJobs.cancel(jobId, input.cancelReason).catch(() => undefined);
  };
  input.signal?.addEventListener('abort', requestCancel, { once: true });
  try {
    let job = (await scenarioJobs.get(jobId)).job;
    input.onJob?.(job);
    if (input.signal?.aborted) requestCancel();
    if (!isLabScenarioJobTerminal(job)) {
      const events = await scenarioJobs.subscribe(jobId);
      try {
        for await (const event of events) {
          job = event.job;
          input.onJob?.(job);
          if (isLabScenarioJobTerminal(job)) break;
        }
      } finally {
        await events.cancel().catch(() => undefined);
      }
      // An event stream that ends early is not a terminal answer; ask once more.
      if (!isLabScenarioJobTerminal(job)) {
        job = (await scenarioJobs.get(jobId)).job;
        input.onJob?.(job);
      }
    }
    if (!isLabScenarioJobTerminal(job)) {
      return { ...labJobNonSuccess(input, 'stream-interrupted', t('CapabilityTests.jobs.streamEnded', { jobId, status: job.status }), job), terminal: false };
    }
    if (job.status === 'completed') return { kind: 'completed', job };
    const reason: StudioNonSuccessReason = job.status === 'canceled'
      ? 'runtime-canceled'
      : job.status === 'timeout' ? 'runtime-timeout' : 'runtime-call-failed';
    return { ...labJobNonSuccess(input, reason, job.reasonDetail || job.reasonCode || t('CapabilityTests.jobs.ended', { jobId, status: job.status }), job), terminal: true };
  } catch (error) {
    const diagnostics = studioNonSuccessDiagnostics(error);
    return {
      kind: 'non-success',
      terminal: false,
      result: {
        ...input.nonSuccess(
          input.capability,
          studioNonSuccessReason(runtimeScenarioJobNonSuccessReasonFromError(error)),
          studioRuntimeErrorMessage(error),
          diagnostics,
        ),
        jobId,
      },
    };
  } finally {
    input.signal?.removeEventListener('abort', requestCancel);
  }
}

export function labJobNonSuccess(
  input: Pick<Parameters<typeof observeLabScenarioJob>[0], 'capability' | 'nonSuccess' | 'jobId'>,
  reason: StudioNonSuccessReason,
  message: string,
  job?: Pick<NimiLocalAppScenarioJob, 'reasonCode' | 'traceId'>,
): { readonly kind: 'non-success'; readonly result: StudioNonSuccess } {
  const diagnostics = job ? studioNonSuccessDiagnostics({
    reasonCode: job.reasonCode,
    traceId: job.traceId,
    source: 'runtime',
  }) : undefined;
  return {
    kind: 'non-success',
    result: { ...input.nonSuccess(input.capability, reason, message, diagnostics), jobId: input.jobId },
  };
}
