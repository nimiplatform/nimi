import { createNimiLocalAppRuntimeScenarioJobClient, type NimiLocalAppScenarioJobGetResult, type NimiLocalAppClient, type NimiLocalAppScenarioJob } from '@nimiplatform/sdk/app';
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

import { observeNimiRuntimeScenarioJob, getNimiRuntimeScenarioJobTerminalStatusFromError, type NimiRuntimeScenarioJobObservation } from '@nimiplatform/sdk/runtime';
import type { ScenarioType } from '@nimiplatform/sdk/runtime/generated';

export type LabScenarioJobOutcome =
  | { readonly kind: 'completed'; readonly job: NimiLocalAppScenarioJob; readonly response: NimiLocalAppScenarioJobGetResult }
  // terminal is true only when the owner reported a terminal Job state.
  | { readonly kind: 'non-success'; readonly result: StudioNonSuccess; readonly terminal: boolean };

const TERMINAL_STATES = new Set<NimiLocalAppScenarioJob['status']>(['completed', 'failed', 'canceled', 'timeout']);

export function isLabScenarioJobTerminal(job: NimiLocalAppScenarioJob): boolean {
  return TERMINAL_STATES.has(job.status);
}

/** The view signal detaches; cancelSignal represents an explicit user Cancel. */
export async function observeLabScenarioJob(input: {
  readonly ai: Pick<NimiLocalAppClient['ai'], 'scenarioJobs' | 'artifacts'>;
  readonly jobId: string;
  readonly scenarioType: ScenarioType;
  readonly capability: StudioRuntimeCapabilityDescriptor;
  readonly nonSuccess: StudioCapabilityNonSuccessFactory;
  readonly cancelReason: string;
  readonly signal?: AbortSignal;
  readonly cancelSignal?: AbortSignal;
  readonly getIntervalMs?: number;
  readonly onObservation?: (response: NimiRuntimeScenarioJobObservation) => void;
  readonly onJob?: (job: NimiLocalAppScenarioJob) => void;
}): Promise<LabScenarioJobOutcome> {
  let full: NimiLocalAppScenarioJobGetResult | undefined;
  const ai = createNimiLocalAppRuntimeScenarioJobClient({ ...input.ai, scenarioJobs: {
    ...input.ai.scenarioJobs,
    async get(jobId) {
      const response = await input.ai.scenarioJobs.get(jobId);
      full = response;
      return response;
    },
  } });
  try {
    await observeNimiRuntimeScenarioJob({ ai, jobId: input.jobId, scenarioType: input.scenarioType,
      signal: input.signal, cancelSignal: input.cancelSignal, abortReason: input.cancelReason,
      getIntervalMs: input.getIntervalMs,
      onObservation: response => {
        input.onObservation?.(response);
        if (full) input.onJob?.(full.job);
      },
    });
    if (!full || full.job.jobId !== input.jobId || full.job.status !== 'completed') throw new Error('Completed Job result is missing');
    return { kind: 'completed', job: full.job, response: full };
  } catch (error) {
    return {
      kind: 'non-success',
      terminal: getNimiRuntimeScenarioJobTerminalStatusFromError(error) !== null,
      result: {
        ...input.nonSuccess(input.capability,
          studioNonSuccessReason(runtimeScenarioJobNonSuccessReasonFromError(error)),
          studioRuntimeErrorMessage(error), studioNonSuccessDiagnostics(error)),
        jobId: input.jobId,
      },
    };
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
