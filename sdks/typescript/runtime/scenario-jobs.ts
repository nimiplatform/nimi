import {
  ReasonCode as RuntimeGeneratedReasonCode,
  ScenarioJobStatus,
  ScenarioType,
  type CancelScenarioJobRequest,
  type GetScenarioArtifactsRequest,
  type GetScenarioArtifactsResponse,
  type GetScenarioJobRequest,
  type GetScenarioJobResponse,
  type ScenarioArtifact,
  type ScenarioJob,
  type ScenarioJobEvent,
  type ScenarioOutput,
  type SubmitScenarioJobRequest,
  type SubmitScenarioJobResponse,
  type RuntimeTypedCallOptions,
  type VoiceAsset,
  type VoiceReference,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';

export type NimiRuntimeScenarioJob = ScenarioJob;
export type NimiRuntimeScenarioArtifact = ScenarioArtifact;
export type NimiRuntimeScenarioOutput = ScenarioOutput;
export type NimiRuntimeScenarioJobSubmitRequest = SubmitScenarioJobRequest;

export interface NimiRuntimeScenarioJobClient {
  submitScenarioJob(
    request: SubmitScenarioJobRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<SubmitScenarioJobResponse>;
  getScenarioJob(
    request: GetScenarioJobRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetScenarioJobResponse>;
  cancelScenarioJob(
    request: CancelScenarioJobRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<unknown>;
  subscribeScenarioJobEvents(
    request: { readonly jobId: string },
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<ScenarioJobEvent>;
  getScenarioArtifacts(
    request: GetScenarioArtifactsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetScenarioArtifactsResponse>;
}

export interface NimiRuntimeScenarioJobResult {
  readonly job: NimiRuntimeScenarioJob;
  readonly artifacts: readonly NimiRuntimeScenarioArtifact[];
  readonly traceId?: string;
  readonly output?: NimiRuntimeScenarioOutput;
  readonly asset?: VoiceAsset;
  readonly voiceReference?: VoiceReference;
}

export interface NimiRuntimeScenarioJobRunnerInput {
  readonly ai: NimiRuntimeScenarioJobClient;
  readonly request: NimiRuntimeScenarioJobSubmitRequest;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly onJobUpdate?: (job: NimiRuntimeScenarioJob) => void;
}

export function withNimiRuntimeIdempotencyMetadata(
  options: RuntimeTypedCallOptions | undefined,
  idempotencyKey: string | undefined,
): RuntimeTypedCallOptions {
  const normalized = normalizeText(idempotencyKey);
  if (!normalized) {
    return options ?? {};
  }
  return {
    ...(options ?? {}),
    metadata: {
      ...(options?.metadata ?? {}),
      idempotencyKey: normalized,
      'x-nimi-idempotency-key': normalized,
    },
  };
}

export function isNimiRuntimeScenarioJobTerminalStatus(status: ScenarioJobStatus): boolean {
  return status === ScenarioJobStatus.COMPLETED
    || status === ScenarioJobStatus.FAILED
    || status === ScenarioJobStatus.CANCELED
    || status === ScenarioJobStatus.TIMEOUT;
}

export async function runNimiRuntimeScenarioJob(
  input: NimiRuntimeScenarioJobRunnerInput,
): Promise<NimiRuntimeScenarioJobResult> {
  throwIfAborted(input.signal);

  const submitResponse = await input.ai.submitScenarioJob(
    input.request,
    withNimiRuntimeIdempotencyMetadata(input.callOptions, input.request.idempotencyKey),
  );
  const submitted = submitResponse.job;
  const jobId = normalizeText(submitted?.jobId);
  if (!jobId) {
    throw createNimiError({
      message: 'Runtime Scenario job submit returned an empty jobId',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'sdk',
    });
  }

  let terminalJob = submitted;
  if (submitted) {
    input.onJobUpdate?.(submitted);
  }

  try {
    const events = input.ai.subscribeScenarioJobEvents({ jobId }, input.callOptions);
    const iterator = events[Symbol.asyncIterator]();
    while (true) {
      const next = await nextWithAbort(iterator, input.signal, async () => {
        await cancelNimiRuntimeScenarioJob(input, jobId);
      });
      if (next.done) {
        break;
      }
      const job = next.value.job;
      if (!job) {
        continue;
      }
      terminalJob = job;
      input.onJobUpdate?.(job);
      if (isNimiRuntimeScenarioJobTerminalStatus(job.status)) {
        break;
      }
    }
  } catch (error) {
    if (input.signal?.aborted) {
      throw abortedNimiRuntimeScenarioJobError();
    }
    throw error;
  }

  throwIfAborted(input.signal);

  if (terminalJob && isNimiRuntimeScenarioJobTerminalStatus(terminalJob.status)) {
    ensureCompletedNimiRuntimeScenarioJob(terminalJob);
  }
  const eventStatus = terminalJob?.status;
  const terminalResponse = await input.ai.getScenarioJob({ jobId }, input.callOptions);
  terminalJob = terminalResponse.job;
  if (terminalJob && terminalJob.status !== eventStatus) {
    input.onJobUpdate?.(terminalJob);
  }

  ensureCompletedNimiRuntimeScenarioJob(terminalJob);

  const artifacts = terminalJob.scenarioType === ScenarioType.VOICE_CREATE
    ? { artifacts: terminalJob.artifacts, traceId: terminalJob.traceId, output: undefined }
    : await input.ai.getScenarioArtifacts({ jobId }, input.callOptions);
  return {
    job: terminalJob,
    artifacts: artifacts.artifacts,
    traceId: normalizeText(artifacts.traceId) || undefined,
    output: artifacts.output,
    ...(terminalResponse.asset ? { asset: terminalResponse.asset } : {}),
    ...(terminalResponse.voiceReference ? { voiceReference: terminalResponse.voiceReference } : {}),
  };
}

async function cancelNimiRuntimeScenarioJob(
  input: NimiRuntimeScenarioJobRunnerInput,
  jobId: string,
): Promise<void> {
  try {
    await input.ai.cancelScenarioJob({
      jobId,
      reason: input.abortReason || 'aborted_by_abort_signal',
    }, withNimiRuntimeIdempotencyMetadata(input.callOptions, `cancel:${input.request.idempotencyKey}:${jobId}`));
  } catch {
    // Preserve the original abort/error path; Runtime remains job authority.
  }
}

function ensureCompletedNimiRuntimeScenarioJob(
  job: NimiRuntimeScenarioJob | undefined,
): asserts job is NimiRuntimeScenarioJob {
  if (!job) {
    throw createNimiError({
      message: 'Runtime Scenario job lookup returned no job',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'sdk',
    });
  }
  if (job.status !== ScenarioJobStatus.COMPLETED) {
    throw createNimiError({
      message: normalizeText(job.reasonDetail) || `Runtime Scenario job ended with status ${String(job.status)}`,
      reasonCode: runtimeReasonCodeName(job.reasonCode) || 'RUNTIME_SCENARIO_JOB_FAILED',
      actionHint: 'check_runtime_scenario_job',
      source: 'runtime',
    });
  }
}

function runtimeReasonCodeName(reasonCode: RuntimeGeneratedReasonCode): string {
  return RuntimeGeneratedReasonCode[reasonCode] || '';
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortedNimiRuntimeScenarioJobError();
  }
}

function abortedNimiRuntimeScenarioJobError(): Error {
  const error = new Error('Runtime Scenario job was aborted.');
  error.name = 'AbortError';
  return error;
}

function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<void>,
): Promise<IteratorResult<T>> {
  if (!signal) {
    return iterator.next();
  }
  if (signal.aborted) {
    return onAbort().then(() => Promise.reject(abortedNimiRuntimeScenarioJobError()));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      onAbort().then(
        () => reject(abortedNimiRuntimeScenarioJobError()),
        (error) => reject(error),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    iterator.next().then(
      (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
