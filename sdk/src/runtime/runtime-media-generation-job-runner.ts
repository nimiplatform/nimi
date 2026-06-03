import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import { Struct as ProtoStruct } from './generated/google/protobuf/struct.js';
import {
  ScenarioJobStatus,
  type ScenarioArtifact,
  type ScenarioJob,
  type ScenarioOutput,
} from './generated/runtime/v1/ai.js';
import { normalizeRuntimeReasonCode } from './reason-code-messages.js';
import type {
  RuntimeAiModule,
  RuntimeAiSubmitScenarioJobRequestInput,
} from './types-runtime-modules.js';
import type { RuntimeCallOptions } from './types.js';
import type { RuntimeMediaModule, ScenarioJobSubmitInput } from './types.js';
import {
  normalizeText,
  sleep,
} from './runtime-value-utils.js';

export type RuntimeMediaGenerationJobsModule = Pick<
  RuntimeMediaModule['jobs'],
  'submit' | 'subscribe' | 'get' | 'cancel' | 'getArtifacts'
>;

export type RuntimeMediaGenerationSubmitRequest = ScenarioJobSubmitInput;
export type RuntimeScenarioJob = ScenarioJob;
export type RuntimeScenarioArtifact = ScenarioArtifact;
export type RuntimeMediaGenerationJob = RuntimeScenarioJob;
export type RuntimeMediaScenarioArtifact = RuntimeScenarioArtifact;

export type RuntimeMediaGenerationJobResult = {
  job: RuntimeMediaGenerationJob;
  artifacts: RuntimeMediaScenarioArtifact[];
  traceId?: string;
  output?: ScenarioOutput;
};

export type RuntimeMediaGenerationJobRunnerInput = {
  jobs: RuntimeMediaGenerationJobsModule;
  request: RuntimeMediaGenerationSubmitRequest;
  signal?: AbortSignal;
  abortReason?: string;
  onJobUpdate?: (job: RuntimeMediaGenerationJob) => void;
};

export type RuntimeAiScenarioJobsModule = Pick<
  RuntimeAiModule,
  'submitScenarioJob' | 'getScenarioJob' | 'cancelScenarioJob' | 'getScenarioArtifacts'
>;

export type RuntimeAiScenarioJobResult = {
  job: RuntimeScenarioJob;
  artifacts: RuntimeScenarioArtifact[];
  traceId?: string;
  output?: ScenarioOutput;
};

export type RuntimeAiScenarioJobRunnerInput = {
  ai: RuntimeAiScenarioJobsModule;
  request: RuntimeAiSubmitScenarioJobRequestInput;
  callOptions?: RuntimeCallOptions;
  signal?: AbortSignal;
  abortReason?: string;
  timeoutMs?: number;
  pollDelayMs?: (attempt: number) => number;
  onJobUpdate?: (job: RuntimeScenarioJob) => void;
};

export function isRuntimeMediaScenarioJobTerminalStatus(status: ScenarioJobStatus): boolean {
  return status === ScenarioJobStatus.COMPLETED
    || status === ScenarioJobStatus.FAILED
    || status === ScenarioJobStatus.CANCELED
    || status === ScenarioJobStatus.TIMEOUT;
}

export async function runRuntimeMediaGenerationJob(
  input: RuntimeMediaGenerationJobRunnerInput,
): Promise<RuntimeMediaGenerationJobResult> {
  throwIfAborted(input.signal);

  const submitted = await input.jobs.submit(input.request);
  const jobId = normalizeText(submitted.jobId);
  if (!jobId) {
    throw createNimiError({
      message: 'Runtime media generation job submit returned an empty jobId',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }

  input.onJobUpdate?.(submitted);
  let terminalJob = submitted;

  try {
    const events = await input.jobs.subscribe(jobId);
    const iterator = events[Symbol.asyncIterator]();
    while (true) {
      const next = await nextWithAbort(iterator, input.signal, async () => {
        await cancelRuntimeMediaGenerationJob(input.jobs, jobId, input.abortReason || 'aborted_by_abort_signal');
      });
      if (next.done) {
        break;
      }
      if (!next.value.job) {
        continue;
      }
      terminalJob = next.value.job;
      input.onJobUpdate?.(terminalJob);
      if (isRuntimeMediaScenarioJobTerminalStatus(terminalJob.status)) {
        break;
      }
    }
  } catch (error) {
    if (input.signal?.aborted) {
      throw abortedRuntimeMediaGenerationJobError();
    }
    throw error;
  }

  throwIfAborted(input.signal);

  if (!isRuntimeMediaScenarioJobTerminalStatus(terminalJob.status)) {
    terminalJob = await input.jobs.get(jobId);
    input.onJobUpdate?.(terminalJob);
  }

  ensureCompletedRuntimeMediaGenerationJob(terminalJob);

  const artifacts = await input.jobs.getArtifacts(jobId);
  return {
    job: terminalJob,
    artifacts: artifacts.artifacts || [],
    traceId: normalizeText(artifacts.traceId) || undefined,
    output: artifacts.output,
  };
}

export async function runRuntimeAiScenarioJob(
  input: RuntimeAiScenarioJobRunnerInput,
): Promise<RuntimeAiScenarioJobResult> {
  const submitResponse = await input.ai.submitScenarioJob(input.request, input.callOptions);
  const submitted = submitResponse.job;
  const jobId = normalizeText(submitted?.jobId);
  if (!jobId) {
    throw createNimiError({
      message: 'Runtime AI scenario job submit returned an empty jobId',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }

  if (submitted) {
    input.onJobUpdate?.(submitted);
  }

  const startedAt = Date.now();
  const timeoutMs = Number(input.timeoutMs ?? input.callOptions?.timeoutMs ?? 120_000) || 120_000;
  let pollAttempt = 0;
  let cancelIssued = false;
  const cancel = async (reason: string): Promise<void> => {
    if (cancelIssued) {
      return;
    }
    cancelIssued = true;
    try {
      await input.ai.cancelScenarioJob({ jobId, reason }, input.callOptions);
    } catch {
      // Preserve the original abort/error path; Runtime remains job authority.
    }
  };

  while (true) {
    if (input.signal?.aborted) {
      await cancel(input.abortReason || 'aborted_by_abort_signal');
      throw abortedRuntimeMediaGenerationJobError();
    }

    const response = await input.ai.getScenarioJob({ jobId }, input.callOptions);
    const job = response.job;
    if (job) {
      input.onJobUpdate?.(job);
    }
    const status = Number(job?.status || 0);
    if (job && status === ScenarioJobStatus.COMPLETED) {
      const artifacts = await input.ai.getScenarioArtifacts({ jobId }, input.callOptions);
      return {
        job,
        artifacts: artifacts.artifacts || [],
        traceId: normalizeText(artifacts.traceId) || normalizeText(job.traceId) || undefined,
        output: artifacts.output,
      };
    }

    if (
      status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      throw scenarioJobTerminalFailureError(job);
    }

    if ((Date.now() - startedAt) > timeoutMs) {
      await cancel('aborted_by_sdk_timeout');
      throw createNimiError({
        message: 'scenario job timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
      });
    }

    pollAttempt += 1;
    await sleep(input.pollDelayMs?.(pollAttempt) ?? nextRuntimeAiScenarioJobPollDelayMs(pollAttempt));
  }
}

function ensureCompletedRuntimeMediaGenerationJob(job: RuntimeMediaGenerationJob): void {
  if (job.status === ScenarioJobStatus.COMPLETED) {
    return;
  }

  const reasonCode = normalizeRuntimeReasonCode(job.reasonCode) || (
    job.status === ScenarioJobStatus.TIMEOUT
      ? ReasonCode.AI_PROVIDER_TIMEOUT
      : ReasonCode.AI_PROVIDER_UNAVAILABLE
  );
  throw createNimiError({
    message: normalizeText(job.reasonDetail) || `Runtime media generation job did not complete: ${reasonCode}`,
    reasonCode,
    actionHint: 'retry_scenario_job_request',
    traceId: normalizeText(job.traceId) || undefined,
    source: 'runtime',
  });
}

function scenarioJobTerminalFailureError(job: ScenarioJob | undefined): Error {
  const reasonCode = normalizeRuntimeReasonCode(job?.reasonCode);
  if (!reasonCode) {
    return createNimiError({
      message: 'scenario job response missing reasonCode',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }

  return createNimiError({
    message: normalizeText(job?.reasonDetail) || `scenario job failed: ${reasonCode}`,
    reasonCode,
    actionHint: 'retry_scenario_job_request',
    traceId: normalizeText(job?.traceId) || undefined,
    source: 'runtime',
    details: scenarioJobReasonDetails(job),
  });
}

function scenarioJobReasonDetails(job: ScenarioJob | undefined): Record<string, unknown> | undefined {
  const metadata = job?.reasonMetadata;
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const json = ProtoStruct.toJson(metadata as Parameters<typeof ProtoStruct.toJson>[0]);
  return json && typeof json === 'object' && !Array.isArray(json)
    ? json as Record<string, unknown>
    : undefined;
}

function nextRuntimeAiScenarioJobPollDelayMs(attempt: number): number {
  return Math.min(2_000, 250 * Math.max(1, attempt));
}

async function cancelRuntimeMediaGenerationJob(
  jobs: RuntimeMediaGenerationJobsModule,
  jobId: string,
  reason: string,
): Promise<void> {
  try {
    await jobs.cancel({ jobId, reason });
  } catch {
    // Preserve the original abort/error path; Runtime remains job authority.
  }
}

async function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<IteratorResult<T>> {
  if (!signal) {
    return iterator.next();
  }
  if (signal.aborted) {
    await onAbort();
    throw abortedRuntimeMediaGenerationJobError();
  }

  let settled = false;
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      void onAbort().finally(() => {
        reject(abortedRuntimeMediaGenerationJobError());
      });
    };

    signal.addEventListener('abort', abort, { once: true });
    void iterator.next().then((value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }, (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortedRuntimeMediaGenerationJobError();
  }
}

function abortedRuntimeMediaGenerationJobError(): Error {
  return createNimiError({
    message: 'Runtime media generation job aborted',
    reasonCode: ReasonCode.OPERATION_ABORTED,
    actionHint: 'retry_scenario_job_request',
    source: 'sdk',
  });
}
