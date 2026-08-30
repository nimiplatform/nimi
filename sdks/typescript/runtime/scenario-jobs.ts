import {
  ReasonCode as RuntimeGeneratedReasonCode,
  ScenarioJobStatus,
  ScenarioJobEventType,
  ScenarioType,
  type CancelScenarioJobRequest,
  type CancelScenarioJobResponse,
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
  VoiceAssetPersistence,
  VoiceAssetStatus,
  VoiceCreationSource,
  VoiceReferenceKind,
  type VoiceAsset,
  type VoiceReference,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode, type JsonObject } from '../types';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';

const NIMI_RUNTIME_SCENARIO_JOB_STATUS_DETAIL_KEY = 'scenarioJobStatus';
export const NIMI_RUNTIME_SCENARIO_JOB_STREAM_INTERRUPTED_REASON = 'SDK_RUNTIME_SCENARIO_JOB_STREAM_INTERRUPTED';
const NIMI_RUNTIME_SCENARIO_JOB_CANCEL_CONVERGENCE_TIMEOUT_MS = 30_000;

export type NimiRuntimeScenarioJobErrorTerminalStatus =
  | ScenarioJobStatus.FAILED
  | ScenarioJobStatus.CANCELED
  | ScenarioJobStatus.TIMEOUT;

export type NimiRuntimeScenarioJob = ScenarioJob;
export type NimiRuntimeScenarioArtifact = ScenarioArtifact;
export type NimiRuntimeScenarioOutput = ScenarioOutput;
export type NimiRuntimeScenarioJobSubmitRequest = SubmitScenarioJobRequest;

export type NimiProtectedLocalVoiceAsset = Pick<
  VoiceAsset,
  'voiceAssetId' | 'status' | 'creationSource' | 'createdAt' | 'updatedAt' | 'expiresAt'
>;

type NimiProtectedLocalGetScenarioJobResponse = Omit<GetScenarioJobResponse, 'asset'> & {
  readonly asset?: NimiProtectedLocalVoiceAsset;
};

export interface NimiRuntimeScenarioJobClient {
  readonly terminalVoiceAssetProjection?: 'runtime-full';
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
  ): Promise<CancelScenarioJobResponse>;
  subscribeScenarioJobEvents(
    request: { readonly jobId: string },
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<ScenarioJobEvent>;
  getScenarioArtifacts(
    request: GetScenarioArtifactsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetScenarioArtifactsResponse>;
}

export interface NimiProtectedLocalScenarioJobClient extends Omit<
  NimiRuntimeScenarioJobClient,
  'terminalVoiceAssetProjection' | 'getScenarioJob'
> {
  readonly terminalVoiceAssetProjection: 'protected-local';
  getScenarioJob(
    request: GetScenarioJobRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiProtectedLocalGetScenarioJobResponse>;
}

export type NimiScenarioJobClient = NimiRuntimeScenarioJobClient | NimiProtectedLocalScenarioJobClient;

export interface NimiRuntimeScenarioJobResult {
  readonly job: NimiRuntimeScenarioJob;
  readonly artifacts: readonly NimiRuntimeScenarioArtifact[];
  readonly traceId?: string;
  readonly output?: NimiRuntimeScenarioOutput;
  readonly asset?: VoiceAsset | NimiProtectedLocalVoiceAsset;
  readonly voiceReference?: VoiceReference;
}

export interface NimiRuntimeScenarioJobRunnerInput {
  readonly ai: NimiScenarioJobClient;
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

// @nimi-authority: rule.nimi.sdks.client-core.r021
// @nimi-authority: rule.nimi.sdks.feature-clients.r002
export function getNimiRuntimeScenarioJobTerminalStatusFromError(
  error: unknown,
): NimiRuntimeScenarioJobErrorTerminalStatus | null {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return null;
  }
  const details = (error as { readonly details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }
  const status = (details as Record<string, unknown>)[NIMI_RUNTIME_SCENARIO_JOB_STATUS_DETAIL_KEY];
  if (status === 'FAILED') return ScenarioJobStatus.FAILED;
  if (status === 'CANCELED') return ScenarioJobStatus.CANCELED;
  if (status === 'TIMEOUT') return ScenarioJobStatus.TIMEOUT;
  return null;
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r002
// @nimi-authority: rule.nimi.sdks.feature-clients.r069
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
  let observedTerminalEvent = false;
  let recoveredTerminalResponse: Awaited<ReturnType<NimiScenarioJobClient['getScenarioJob']>> | undefined;
  let cancellationResponse: CancelScenarioJobResponse | undefined;
  let cancellationRecoveryResponse: Awaited<ReturnType<NimiScenarioJobClient['getScenarioJob']>> | undefined;
  let cancellationRequested = false;
  if (submitted) {
    input.onJobUpdate?.(submitted);
  }

  const consumeJobEventStream = async (): Promise<void> => {
    const events = input.ai.subscribeScenarioJobEvents({ jobId }, input.callOptions);
    const iterator = events[Symbol.asyncIterator]();
    while (true) {
      const next = cancellationRequested
        ? await iterator.next()
        : await nextWithAbort(iterator, input.signal, async () => {
            cancellationRequested = true;
            cancellationResponse = await cancelNimiRuntimeScenarioJob(input, jobId);
            if (cancellationResponse?.job
              && isNimiRuntimeScenarioJobTerminalStatus(cancellationResponse.job.status)) {
              return true;
            }
            const refreshed = await queryMatchingScenarioJob(input, jobId);
            cancellationRecoveryResponse = refreshed;
            if (refreshed?.job && isNimiRuntimeScenarioJobTerminalStatus(refreshed.job.status)) {
              return true;
            }
            return false;
          });
      if (next.done) {
        break;
      }
      const job = next.value.job;
      if (!job) {
        throw runtimeScenarioJobResponseError('Runtime Scenario job event omitted its Job projection');
      }
      if (normalizeText(job.jobId) !== jobId || job.scenarioType !== input.request.scenarioType
        || !scenarioJobEventMatchesStatus(next.value.eventType, job.status)) {
        throw runtimeScenarioJobResponseError('Runtime Scenario job event does not match the submitted Job');
      }
      terminalJob = job;
      input.onJobUpdate?.(job);
      if (isNimiRuntimeScenarioJobTerminalStatus(job.status)) {
        observedTerminalEvent = true;
        break;
      }
    }
  };

  try {
    await consumeJobEventStream();
    if (!observedTerminalEvent) {
      throwIfAborted(input.signal);
      const refreshed = await queryMatchingScenarioJob(input, jobId);
      if (refreshed?.job && isNimiRuntimeScenarioJobTerminalStatus(refreshed.job.status)) {
        terminalJob = refreshed.job;
        recoveredTerminalResponse = refreshed;
        observedTerminalEvent = true;
        input.onJobUpdate?.(refreshed.job);
      } else {
        // A protected Local App technical-session rotation may end the old
        // transport stream while the immutable Runtime Job keeps running.
        // Reattach once to that exact Job; Runtime backlog/terminal replay
        // remains the only source of Job state and no execution is retried.
        await consumeJobEventStream();
      }
    }
  } catch (error) {
    if (input.signal?.aborted) {
      const cancellationJob = cancellationRecoveryResponse?.job ?? cancellationResponse?.job;
      if (cancellationJob
        && (normalizeText(cancellationJob.jobId) !== jobId
          || cancellationJob.scenarioType !== input.request.scenarioType)) {
        throw runtimeScenarioJobResponseError('Runtime Scenario job cancellation result does not match the submitted Job');
      }
      const refreshed = cancellationRecoveryResponse
        ?? (cancellationJob && isNimiRuntimeScenarioJobTerminalStatus(cancellationJob.status)
          ? { job: cancellationJob }
          : await queryMatchingScenarioJob(input, jobId));
      if (refreshed?.job && isNimiRuntimeScenarioJobTerminalStatus(refreshed.job.status)) {
        terminalJob = refreshed.job;
        recoveredTerminalResponse = refreshed;
        observedTerminalEvent = true;
        input.onJobUpdate?.(refreshed.job);
        ensureCompletedNimiRuntimeScenarioJob(refreshed.job);
      } else {
        throw abortedNimiRuntimeScenarioJobError(jobId);
      }
    } else {
      throw error;
    }
  }

  if (!observedTerminalEvent) {
    throwIfAborted(input.signal);
  }
  if (!observedTerminalEvent || !terminalJob || !isNimiRuntimeScenarioJobTerminalStatus(terminalJob.status)) {
    const refreshed = await queryMatchingScenarioJob(input, jobId);
    if (!refreshed?.job || !isNimiRuntimeScenarioJobTerminalStatus(refreshed.job.status)) {
      throw runtimeScenarioJobStreamInterruptedError(jobId);
    }
    terminalJob = refreshed.job;
    recoveredTerminalResponse = refreshed;
    observedTerminalEvent = true;
    input.onJobUpdate?.(refreshed.job);
  }
  ensureCompletedNimiRuntimeScenarioJob(terminalJob);
  const eventStatus = terminalJob?.status;
  const terminalResponse = recoveredTerminalResponse
    ?? await input.ai.getScenarioJob({ jobId }, input.callOptions);
  terminalJob = terminalResponse.job;
  if (normalizeText(terminalJob?.jobId) !== jobId || terminalJob?.scenarioType !== input.request.scenarioType) {
    throw runtimeScenarioJobResponseError('Runtime Scenario job terminal result does not match the submitted Job');
  }
  if (terminalJob && terminalJob.status !== eventStatus) {
    input.onJobUpdate?.(terminalJob);
  }

  ensureCompletedNimiRuntimeScenarioJob(terminalJob);
  validateScenarioJobTerminalResult(
    terminalJob,
    terminalResponse.asset,
    terminalResponse.voiceReference,
    input.ai.terminalVoiceAssetProjection ?? 'runtime-full',
  );

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

function scenarioJobEventMatchesStatus(eventType: ScenarioJobEventType, status: ScenarioJobStatus): boolean {
  switch (eventType) {
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED: return status === ScenarioJobStatus.SUBMITTED;
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_QUEUED: return status === ScenarioJobStatus.QUEUED;
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING: return status === ScenarioJobStatus.RUNNING;
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED: return status === ScenarioJobStatus.COMPLETED;
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED: return status === ScenarioJobStatus.FAILED;
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED: return status === ScenarioJobStatus.CANCELED;
    case ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT: return status === ScenarioJobStatus.TIMEOUT;
    default: return false;
  }
}

function validateScenarioJobTerminalResult(
  job: NimiRuntimeScenarioJob,
  asset: VoiceAsset | NimiProtectedLocalVoiceAsset | undefined,
  voiceReference: VoiceReference | undefined,
  projection: 'runtime-full' | 'protected-local',
): void {
  const pairPresent = asset !== undefined && voiceReference !== undefined;
  if ((asset === undefined) !== (voiceReference === undefined)) {
    throw runtimeScenarioJobResponseError('Runtime Scenario job returned an incomplete VoiceAsset result');
  }
  const expectsVoiceResult = job.scenarioType === ScenarioType.VOICE_CREATE;
  if (pairPresent !== expectsVoiceResult) {
    throw runtimeScenarioJobResponseError('Runtime Scenario job returned an unexpected VoiceAsset result');
  }
  if (!pairPresent) return;
  if (!normalizeText(asset.voiceAssetId)
    || asset.status !== VoiceAssetStatus.ACTIVE
    || (asset.creationSource !== VoiceCreationSource.TEXT_DESCRIPTION
      && asset.creationSource !== VoiceCreationSource.REFERENCE_AUDIO)
    || voiceReference.kind !== VoiceReferenceKind.VOICE_ASSET
    || voiceReference.reference?.oneofKind !== 'voiceAssetId'
    || voiceReference.reference.voiceAssetId !== asset.voiceAssetId) {
    throw runtimeScenarioJobResponseError('Runtime Scenario job returned an invalid VoiceAsset result');
  }
  if (projection === 'protected-local') return;
  const fullAsset = asset as VoiceAsset;
  if (!normalizeText(fullAsset.providerVoiceRef)
    || !normalizeText(fullAsset.provider)
    || !normalizeText(fullAsset.appId)
    || !normalizeText(fullAsset.subjectUserId)
    || (fullAsset.persistence !== VoiceAssetPersistence.PROVIDER_PERSISTENT
      && fullAsset.persistence !== VoiceAssetPersistence.SESSION_EPHEMERAL)
    || normalizeText(job.head?.appId) !== normalizeText(fullAsset.appId)
    || normalizeText(job.head?.subjectUserId) !== normalizeText(fullAsset.subjectUserId)) {
    throw runtimeScenarioJobResponseError('Runtime Scenario job returned an incomplete or cross-owner VoiceAsset result');
  }
}

function runtimeScenarioJobResponseError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'regenerate_runtime_proto_and_sdk',
    source: 'sdk',
  });
}

async function queryMatchingScenarioJob(
  input: NimiRuntimeScenarioJobRunnerInput,
  jobId: string,
): Promise<Awaited<ReturnType<NimiScenarioJobClient['getScenarioJob']>> | undefined> {
  let response: Awaited<ReturnType<NimiScenarioJobClient['getScenarioJob']>>;
  try {
    response = await input.ai.getScenarioJob({ jobId }, input.callOptions);
  } catch {
    return undefined;
  }
  const job = response.job;
  if (normalizeText(job?.jobId) !== jobId || job?.scenarioType !== input.request.scenarioType) {
    throw runtimeScenarioJobResponseError('Runtime Scenario job recovery result does not match the submitted Job');
  }
  return response;
}

function runtimeScenarioJobStreamInterruptedError(jobId: string): Error {
  return createNimiError({
    message: 'The Runtime Scenario job event stream ended before a terminal state could be confirmed.',
    reasonCode: NIMI_RUNTIME_SCENARIO_JOB_STREAM_INTERRUPTED_REASON,
    actionHint: 'query_runtime_scenario_job',
    retryable: true,
    source: 'sdk',
    details: { jobId },
  });
}

async function cancelNimiRuntimeScenarioJob(
  input: NimiRuntimeScenarioJobRunnerInput,
  jobId: string,
): Promise<CancelScenarioJobResponse | undefined> {
  try {
    return await input.ai.cancelScenarioJob({
      jobId,
      reason: input.abortReason || 'aborted_by_abort_signal',
    }, withNimiRuntimeIdempotencyMetadata(input.callOptions, `cancel:${input.request.idempotencyKey}:${jobId}`));
  } catch {
    // Preserve the original abort/error path; Runtime remains job authority.
    return undefined;
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
    const reasonMetadata = safeScenarioJobReasonMetadata(job.reasonMetadata);
    const actionHint = normalizeText(reasonMetadata.action_hint) || 'check_runtime_scenario_job';
    const retryable = typeof reasonMetadata.retryable === 'boolean'
      ? reasonMetadata.retryable
      : false;
    throw createNimiError({
      message: normalizeText(job.reasonDetail) || `Runtime Scenario job ended with status ${String(job.status)}`,
      reasonCode: runtimeReasonCodeName(job.reasonCode) || 'RUNTIME_SCENARIO_JOB_FAILED',
      actionHint,
      traceId: normalizeText(job.traceId),
      retryable,
      source: 'runtime',
      details: {
        [NIMI_RUNTIME_SCENARIO_JOB_STATUS_DETAIL_KEY]: ScenarioJobStatus[job.status] || String(job.status),
        ...(Object.keys(reasonMetadata).length > 0 ? { reasonMetadata } : {}),
      },
    });
  }
}

function safeScenarioJobReasonMetadata(
  value: NimiRuntimeScenarioJob['reasonMetadata'],
): JsonObject {
  const raw = fromNimiRuntimeProtoStruct(value);
  const actionHint = safeScenarioJobReasonMetadataToken(raw.action_hint);
  const failureStage = safeScenarioJobReasonMetadataToken(raw.failure_stage);
  const retryable = typeof raw.retryable === 'boolean' ? raw.retryable : undefined;
  return {
    ...(actionHint ? { action_hint: actionHint } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(failureStage ? { failure_stage: failureStage } : {}),
  };
}

function safeScenarioJobReasonMetadataToken(value: unknown): string {
  const token = normalizeText(value);
  return token.length <= 120 && /^[A-Za-z0-9_.-]+$/u.test(token) ? token : '';
}

function runtimeReasonCodeName(reasonCode: RuntimeGeneratedReasonCode): string {
  return RuntimeGeneratedReasonCode[reasonCode] || '';
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortedNimiRuntimeScenarioJobError();
  }
}

function abortedNimiRuntimeScenarioJobError(jobId?: string): Error {
  return createNimiError({
    message: 'The caller requested cancellation, but the Runtime Scenario job terminal state is not confirmed yet.',
    reasonCode: ReasonCode.OPERATION_ABORTED,
    actionHint: 'query_runtime_scenario_job',
    retryable: false,
    source: 'sdk',
    ...(jobId ? { details: { jobId } } : {}),
  });
}

function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal | undefined,
  onAbort: () => Promise<boolean>,
): Promise<IteratorResult<T>> {
  if (!signal) {
    return iterator.next();
  }
  if (signal.aborted) {
    return onAbort().then((terminal) => terminal
      ? Promise.reject(abortedNimiRuntimeScenarioJobError())
      : iterator.next());
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let aborting = false;
    let cancellationComplete = false;
    let pendingResult: IteratorResult<T> | undefined;
    let pendingError: unknown;
    let hasPendingError = false;
    let convergenceTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      if (convergenceTimer !== undefined) {
        clearTimeout(convergenceTimer);
        convergenceTimer = undefined;
      }
    };
    const finishPending = () => {
      if (settled || !cancellationComplete) return;
      if (hasPendingError) {
        settled = true;
        cleanup();
        reject(pendingError);
      } else if (pendingResult) {
        settled = true;
        cleanup();
        resolve(pendingResult);
      }
    };
    const abort = () => {
      if (settled) return;
      aborting = true;
      cleanup();
      onAbort().then(
        (terminal) => {
          if (settled) return;
          if (terminal) {
            settled = true;
            reject(abortedNimiRuntimeScenarioJobError());
          } else {
            cancellationComplete = true;
            convergenceTimer = setTimeout(() => {
              if (settled) return;
              settled = true;
              cleanup();
              reject(abortedNimiRuntimeScenarioJobError());
            }, NIMI_RUNTIME_SCENARIO_JOB_CANCEL_CONVERGENCE_TIMEOUT_MS);
            finishPending();
          }
        },
        (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        },
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    iterator.next().then(
      (result) => {
        if (settled) return;
        if (aborting) {
          pendingResult = result;
          finishPending();
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      },
      (error) => {
        if (settled) return;
        if (aborting) {
          pendingError = error;
          hasPendingError = true;
          finishPending();
          return;
        }
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
