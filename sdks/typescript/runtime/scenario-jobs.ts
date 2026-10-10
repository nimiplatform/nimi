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
  type VisionLocateResult,
  type VisionLocateScenarioSpec,
} from '../core-generated/runtime-typed-client';
import { localVisionLocateFromRuntime, localLocateGeometry, localInterruptionFromRuntime } from '../core/app/local-app-runtime-platform-vision.js';
import { asNimiError, createNimiError, ReasonCode, type JsonObject } from '../types';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';

const NIMI_RUNTIME_SCENARIO_JOB_STATUS_DETAIL_KEY = 'scenarioJobStatus';
export const NIMI_RUNTIME_SCENARIO_JOB_STREAM_INTERRUPTED_REASON = 'SDK_RUNTIME_SCENARIO_JOB_STREAM_INTERRUPTED';
/** Default Get cadence for every implementation; events are only hints. */
export const NIMI_RUNTIME_SCENARIO_JOB_GET_INTERVAL_MS = 1_000;
export type NimiRuntimeScenarioJobObservation = Awaited<ReturnType<NimiScenarioJobClient['getScenarioJob']>>;

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
  readonly response: NimiRuntimeScenarioJobObservation;
  readonly job: NimiRuntimeScenarioJob;
  readonly artifacts: readonly NimiRuntimeScenarioArtifact[];
  readonly traceId?: string;
  readonly output?: NimiRuntimeScenarioOutput;
  readonly asset?: VoiceAsset | NimiProtectedLocalVoiceAsset;
  readonly voiceReference?: VoiceReference;
  readonly visionLocate?: VisionLocateResult;
}

export interface NimiRuntimeScenarioJobRunnerInput {
  readonly ai: NimiScenarioJobClient;
  readonly request: NimiRuntimeScenarioJobSubmitRequest;
  readonly callOptions?: RuntimeTypedCallOptions;
  /** Explicit run cancellation: abort sends the common Cancel operation. */
  readonly signal?: AbortSignal;
  /** Stops observation only; admitted work is not canceled. */
  readonly observationSignal?: AbortSignal;
  readonly getIntervalMs?: number;
  readonly onObservation?: (response: NimiRuntimeScenarioJobObservation) => void;
  readonly abortReason?: string;
  readonly onJobUpdate?: (job: NimiRuntimeScenarioJob) => void;
}

export type NimiRuntimeScenarioJobObservationInput = Omit<NimiRuntimeScenarioJobRunnerInput, 'request' | 'observationSignal' | 'signal'> & {
  /** Ends this observation only, without canceling the Job. */
  readonly signal?: AbortSignal;
  /** Optional explicit user Cancel action, separate from observer disposal. */
  readonly cancelSignal?: AbortSignal;
  readonly jobId: string;
  readonly scenarioType: ScenarioType;
  readonly expectedVision?: Pick<VisionLocateScenarioSpec, 'imageArtifactId' | 'geometry'>;
};

type ScenarioJobObservationContext = Omit<NimiRuntimeScenarioJobObservationInput, 'jobId'> & { readonly cancelKey?: string; readonly cancelSignal?: AbortSignal; readonly jobId?: string };

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
  scenarioGetInterval(input.getIntervalMs);
  throwIfAborted(input.signal);
  throwIfAborted(input.observationSignal);

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

  const spec = input.request.spec?.spec;
  return observeSubmittedScenarioJob({ ...input, signal: input.observationSignal, cancelSignal: input.signal, scenarioType: input.request.scenarioType, cancelKey: input.request.idempotencyKey,
    ...(spec?.oneofKind === 'visionLocate' ? { expectedVision: spec.visionLocate } : {}) }, submitted!);
}

/** Observe an existing author action without submitting or replaying it.
 * The expected scenario and optional Locate geometry verify the observed result.
 */
export async function observeNimiRuntimeScenarioJob(
  input: NimiRuntimeScenarioJobObservationInput,
): Promise<NimiRuntimeScenarioJobResult> {
  scenarioGetInterval(input.getIntervalMs);
  if (!input.jobId || input.jobId !== input.jobId.trim()) throw runtimeScenarioJobResponseError('An existing Job identifier is required');
  return observeSubmittedScenarioJob({ ...input, jobId: input.jobId });
}

async function observeSubmittedScenarioJob(
  input: ScenarioJobObservationContext,
  submitted?: ScenarioJob,
): Promise<NimiRuntimeScenarioJobResult> {
  const jobId = submitted?.jobId ?? input.jobId!;
  const interval = scenarioGetInterval(input.getIntervalMs);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, ...[input.signal, input.callOptions?.signal].filter((value): value is AbortSignal => Boolean(value))]);
  const options = { ...input.callOptions, signal };
  let active = true;
  let lastJob = submitted;
  let terminalResponse: NimiRuntimeScenarioJobObservation | undefined;
  let nextGetAt = 0;
  let terminalHint = submitted ? isNimiRuntimeScenarioJobTerminalStatus(submitted.status) : false;
  let terminalStatus = terminalHint ? submitted!.status : undefined;
  let cancelSent = false;
  let cancellation: Promise<void> | undefined;
  let cancelFailure: unknown;
  let wake: (() => void) | undefined;
  let iterator: AsyncIterator<ScenarioJobEvent> | undefined;
  type EventOutcome = { kind: 'event'; result: IteratorResult<ScenarioJobEvent> } | { kind: 'stream-ended' };
  let eventReady: EventOutcome | undefined;
  const readNext = () => {
    void Promise.resolve().then(() => iterator!.next()).then(
      result => { if (active) { eventReady = { kind: 'event', result }; wake?.(); } },
      () => { if (active) { eventReady = { kind: 'stream-ended' }; wake?.(); } },
    );
  };
  const validateJob = (job: ScenarioJob | undefined) => {
    if (!job || job.jobId !== jobId || job.scenarioType !== input.scenarioType) {
      throw runtimeScenarioJobResponseError('Observed Job does not match the original identity and scenario');
    }
    if (![ScenarioJobStatus.SUBMITTED, ScenarioJobStatus.QUEUED, ScenarioJobStatus.RUNNING,
      ScenarioJobStatus.COMPLETED, ScenarioJobStatus.FAILED, ScenarioJobStatus.CANCELED, ScenarioJobStatus.TIMEOUT].includes(job.status)) {
      throw runtimeScenarioJobResponseError('Observed Job has an unknown status');
    }
    return job;
  };
  const requestCancel = () => {
    if (!active || cancelSent) return;
    cancelSent = true;
    // An explicit control call outlives this observer's disposal, with only
    // its caller-supplied technical call constraints. Never retry it here.
    cancellation = Promise.resolve().then(() => input.ai.cancelScenarioJob({ jobId, reason: input.abortReason || 'caller_requested_cancel' },
      withNimiRuntimeIdempotencyMetadata(input.callOptions, `cancel:${input.cancelKey ?? jobId}:${jobId}`)))
      .then(response => {
        validateJob(response.job);
        if (!active) return;
        terminalHint = isNimiRuntimeScenarioJobTerminalStatus(response.job!.status);
        if (terminalHint) terminalStatus = response.job!.status;
        nextGetAt = 0;
        wake?.();
      }).catch(error => {
        cancelFailure = error;
        if (active) lifetime.abort();
      });
  };
  const disposeObservation = () => {
    if (!active) return;
    active = false;
    input.cancelSignal?.removeEventListener('abort', requestCancel);
    lifetime.abort();
    void iterator?.return?.().catch(() => undefined);
  };
  try {
    if (submitted) validateJob(submitted);
    input.cancelSignal?.addEventListener('abort', requestCancel, { once: true });
    if (input.cancelSignal?.aborted) requestCancel();
    throwIfAborted(signal);
    if (submitted) input.onJobUpdate?.(submitted);
    let subscriptionStarted = false;
    const subscribe = () => {
      if (subscriptionStarted) return;
      subscriptionStarted = true;
      try {
        iterator = input.ai.subscribeScenarioJobEvents({ jobId }, options)[Symbol.asyncIterator]();
        readNext();
      } catch { /* Get remains authoritative when subscriptions are unavailable. */ }
    };
    if (submitted && !terminalHint) subscribe();
    while (!terminalResponse?.job || !isNimiRuntimeScenarioJobTerminalStatus(terminalResponse.job.status)) {
      throwIfAborted(signal);
      if (terminalHint || Date.now() >= nextGetAt) {
        const expectedTerminal = terminalStatus;
        const response = await observationCall(input.ai.getScenarioJob({ jobId }, options), signal, jobId);
        const job = validateJob(response.job);
        if (expectedTerminal !== undefined && job.status !== expectedTerminal) {
          throw runtimeScenarioJobResponseError('Terminal Get disagrees with the observed terminal state');
        }
        // A backlog event may be stale; only a full Get can finalize a result.
        lastJob = job;
        terminalResponse = response;
        input.onObservation?.(response);
        throwIfAborted(signal);
        input.onJobUpdate?.(job);
        terminalHint = terminalStatus !== undefined && !isNimiRuntimeScenarioJobTerminalStatus(job.status);
        nextGetAt = Date.now() + interval;
        if (isNimiRuntimeScenarioJobTerminalStatus(job.status)) break;
        subscribe();
      }
      const outcome = await new Promise<EventOutcome | { kind: 'wake' }>((resolve, reject) => {
        let settled = false;
        const finish = (value?: EventOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          wake = undefined;
          resolve(value ?? { kind: 'wake' });
        };
        const abort = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          wake = undefined;
          reject(abortedNimiRuntimeScenarioJobError(jobId));
        };
        const timer = setTimeout(finish, Math.max(0, nextGetAt - Date.now()));
        wake = () => finish(eventReady);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        if (eventReady) finish(eventReady);
      });
      if (outcome.kind === 'stream-ended' || (outcome.kind === 'event' && outcome.result.done)) {
        eventReady = undefined;
      } else if (outcome.kind === 'event') {
        eventReady = undefined;
        const event = outcome.result.value;
        const job = validateJob(event.job);
        if (!scenarioJobEventMatchesStatus(event.eventType, job.status)) throw runtimeScenarioJobResponseError('Job event status is inconsistent');
        if (isNimiRuntimeScenarioJobTerminalStatus(job.status)) {
          terminalHint = true;
          terminalStatus = job.status;
        } else if ((!lastJob || scenarioJobEventIsNewer(job, lastJob))) {
          lastJob = job;
          input.onJobUpdate?.(job);
        }
        readNext();
      }
    }
    throwIfAborted(signal);
    const job = validateJob(terminalResponse.job);
    ensureCompletedNimiRuntimeScenarioJob(job);
    validateScenarioJobTerminalResult(job, terminalResponse.asset, terminalResponse.voiceReference, input.ai.terminalVoiceAssetProjection ?? 'runtime-full');
    if (job.scenarioType === ScenarioType.VISION_LOCATE) {
      const spec = input.expectedVision;
      if (!terminalResponse.visionLocate || !spec || job.artifacts.length !== 0) throw runtimeScenarioJobResponseError('Locate Job omitted its typed result');
      const result = localVisionLocateFromRuntime(terminalResponse.visionLocate);
      if (result.imageArtifactId !== spec.imageArtifactId || result.locations.some(location => location.type !== localLocateGeometry(spec.geometry))) throw runtimeScenarioJobResponseError('Locate result does not match the submitted image and geometry');
    } else if (terminalResponse.visionLocate) throw runtimeScenarioJobResponseError('Non-Locate Job returned a Locate result');
    const artifacts = job.scenarioType === ScenarioType.VOICE_CREATE || job.scenarioType === ScenarioType.VISION_LOCATE
      ? { artifacts: job.artifacts, traceId: job.traceId, output: undefined }
      : await observationCall(input.ai.getScenarioArtifacts({ jobId }, options), signal, jobId);
    await cancellation;
    if (cancelFailure) throw cancelFailure;
    throwIfAborted(signal);
    return { response: terminalResponse, job, artifacts: artifacts.artifacts, traceId: normalizeText(artifacts.traceId) || undefined, output: artifacts.output,
      ...(terminalResponse.asset ? { asset: terminalResponse.asset } : {}),
      ...(terminalResponse.voiceReference ? { voiceReference: terminalResponse.voiceReference } : {}),
      ...(terminalResponse.visionLocate ? { visionLocate: terminalResponse.visionLocate } : {}),
    };
  } catch (cause) {
    // Release observation immediately, but settle the one explicit Cancel that
    // was already requested so a refusal is not hidden by a view abort.
    disposeObservation();
    await cancellation;
    const error = asNimiError(cancelFailure ?? cause);
    throw createNimiError({ ...error, message: error.message, details: { ...error.details, jobId } });
  } finally {
    disposeObservation();
  }
}

function scenarioJobEventIsNewer(job: ScenarioJob, current: ScenarioJob): boolean {
  if (job.status < current.status) return false;
  if (!job.updatedAt || !current.updatedAt) return job.status > current.status;
  const time = (value: NonNullable<ScenarioJob['updatedAt']>) => BigInt(value.seconds) * 1_000_000_000n + BigInt(value.nanos);
  return time(job.updatedAt) > time(current.updatedAt);
}

function scenarioGetInterval(value?: number): number {
  const interval = value ?? NIMI_RUNTIME_SCENARIO_JOB_GET_INTERVAL_MS;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 2_147_483_647) {
    throw createNimiError({ message: 'getIntervalMs must be a positive timer interval', reasonCode: ReasonCode.SDK_AI_INPUT_INVALID, source: 'sdk' });
  }
  return interval;
}

function observationCall<T>(call: Promise<T>, signal: AbortSignal, jobId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortedNimiRuntimeScenarioJobError(jobId));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    call.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined);
  });
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
    const interruption = localInterruptionFromRuntime(job.interruption);
    if ((job.reasonCode === RuntimeGeneratedReasonCode.AI_EXECUTION_INTERRUPTED) !== Boolean(interruption) || (interruption && job.status !== ScenarioJobStatus.FAILED)) throw runtimeScenarioJobResponseError('Scenario Job interruption does not match its failure');
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
        jobId: job.jobId,
        [NIMI_RUNTIME_SCENARIO_JOB_STATUS_DETAIL_KEY]: ScenarioJobStatus[job.status] || String(job.status),
        ...(Object.keys(reasonMetadata).length > 0 ? { reasonMetadata } : {}),
        ...(interruption ? { interruption: { ...interruption } } : {}),
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
    message: 'Observation ended; the Runtime Job remains independently controlled.',
    reasonCode: ReasonCode.OPERATION_ABORTED,
    actionHint: 'query_runtime_scenario_job',
    retryable: false,
    source: 'sdk',
    ...(jobId ? { details: { jobId } } : {}),
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
