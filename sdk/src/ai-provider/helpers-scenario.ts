import {
  asNimiError,
  createNimiError,
  type RuntimeAiSubmitScenarioJobRequestInput,
} from '../runtime/browser.js';
import type {
  Value as ProtoValue,
} from '../runtime/generated/google/protobuf/struct.js';
import { Struct as ProtoStruct } from '../runtime/generated/google/protobuf/struct.js';
import { ReasonCode, type AiRoutePolicy } from '../types/index.js';
import {
  type NimiArtifact,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import { asRecord, normalizeText } from '../internal/utils.js';
import {
  concatChunks,
  ensureText,
  fromRouteDecision,
  toCallOptions,
} from './helpers-shared.js';
import { ReasonCode as RuntimeReasonCode } from '../runtime/generated/runtime/v1/common.js';
import {
  type CancelScenarioJobRequest,
  ExecutionMode,
  type GetScenarioArtifactsRequest,
  type GetScenarioJobRequest,
  type ScenarioJob,
  ScenarioJobStatus,
  type ScenarioArtifact,
  type ScenarioOutput,
} from '../runtime/generated/runtime/v1/ai.js';

type ScenarioJobExecution = {
  artifacts: NimiArtifact[];
  traceId: string;
  routeDecision: AiRoutePolicy;
  modelResolved: string;
  output?: ScenarioOutput;
};

function ensureScenarioJobReasonCode(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const enumName = (RuntimeReasonCode as unknown as Record<number, string>)[numeric];
    if (enumName && enumName !== 'REASON_CODE_UNSPECIFIED') {
      return String(enumName).trim();
    }
  }
  const reasonCode = normalizeText(value);
  if (reasonCode) {
    return reasonCode;
  }
  throw createNimiError({
    message: 'scenario job response missing reasonCode',
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'regenerate_runtime_proto_and_sdk',
    source: 'runtime',
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextPollDelayMs(attempt: number): number {
  return Math.min(2_000, 250 * Math.max(1, attempt));
}

function scenarioJobReasonDetails(job: ScenarioJob | null | undefined): Record<string, unknown> | undefined {
  const metadata = job?.reasonMetadata;
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const json = ProtoStruct.toJson(metadata as Parameters<typeof ProtoStruct.toJson>[0]);
  return json && typeof json === 'object' && !Array.isArray(json)
    ? json as Record<string, unknown>
    : undefined;
}

export async function executeScenarioJob(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  request: RuntimeAiSubmitScenarioJobRequestInput,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ScenarioJobExecution> {
  const submitRequest = {
    ...request,
    executionMode: Number(request.executionMode || ExecutionMode.ASYNC_JOB),
    extensions: Array.isArray(request.extensions) ? request.extensions : [],
  };
  const submitResponse = await runtime.ai.submitScenarioJob(
    submitRequest,
    toCallOptions(defaults, {
      timeoutMs,
      metadata: undefined,
    }),
  );
  const initialJob = submitResponse.job;
  const jobId = ensureText(initialJob?.jobId, 'jobId');
  const startedAt = Date.now();
  const maxWaitMs = timeoutMs > 0 ? timeoutMs : 120000;
  let cancelIssued = false;
  let pollAttempt = 0;
  const cancelRemoteJob = async (reason: string) => {
    if (cancelIssued) {
      return;
    }
    cancelIssued = true;
    try {
      const cancelRequest: CancelScenarioJobRequest = {
        jobId,
        reason,
      };
      await runtime.ai.cancelScenarioJob(
        cancelRequest,
        toCallOptions(defaults, { timeoutMs }),
      );
    } catch {
      // ignore cancel errors and preserve original failure reason
    }
  };

  while (true) {
    if (signal?.aborted) {
      await cancelRemoteJob('aborted_by_abort_signal');
      throw createNimiError({
        message: 'scenario job aborted',
        reasonCode: ReasonCode.OPERATION_ABORTED,
        actionHint: 'retry_scenario_job_request',
        source: 'sdk',
      });
    }

    const jobRequest: GetScenarioJobRequest = { jobId };
    const jobResponse = await runtime.ai.getScenarioJob(jobRequest, toCallOptions(defaults, { timeoutMs }));
    const job = jobResponse.job;
    const status = Number(job?.status || 0);
    if (status === ScenarioJobStatus.COMPLETED) {
      const artifactsRequest: GetScenarioArtifactsRequest = { jobId };
      const artifactsResponse = await runtime.ai.getScenarioArtifacts(artifactsRequest, toCallOptions(defaults, { timeoutMs }));
      const artifacts = Array.isArray(artifactsResponse.artifacts)
        ? artifactsResponse.artifacts
        : [];
      const traceId = normalizeText(artifactsResponse.traceId) || normalizeText(job?.traceId);
      const routeDecision = fromRouteDecision(job?.routeDecision);
      const modelResolved = normalizeText(job?.modelResolved) || normalizeText(request.head?.modelId);

      return {
        artifacts: artifacts.map((item: ScenarioArtifact) => {
          const bytes = item.bytes instanceof Uint8Array
            ? item.bytes
            : new Uint8Array(0);
          return {
            artifactId: normalizeText(item.artifactId),
            mimeType: normalizeText(item.mimeType),
            bytes,
            traceId,
            routeDecision,
            modelResolved,
          };
        }),
        traceId,
        routeDecision,
        modelResolved,
        output: artifactsResponse.output,
      };
    }
    if (
      status === ScenarioJobStatus.FAILED
      || status === ScenarioJobStatus.CANCELED
      || status === ScenarioJobStatus.TIMEOUT
    ) {
      const reasonCode = ensureScenarioJobReasonCode(job?.reasonCode);
      throw createNimiError({
        message: normalizeText(job?.reasonDetail) || `scenario job failed: ${reasonCode}`,
        reasonCode,
        actionHint: 'retry_scenario_job_request',
        traceId: normalizeText(job?.traceId),
        source: 'runtime',
        details: scenarioJobReasonDetails(job),
      });
    }
    if ((Date.now() - startedAt) > maxWaitMs) {
      await cancelRemoteJob('aborted_by_sdk_timeout');
      throw createNimiError({
        message: 'scenario job timeout',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
      });
    }
    pollAttempt += 1;
    await sleep(nextPollDelayMs(pollAttempt));
  }
}

export async function collectArtifacts(stream: AsyncIterable<unknown>): Promise<NimiArtifact[]> {
  const order: string[] = [];
  const states = new Map<string, {
    artifactId: string;
    mimeType: string;
    chunks: Uint8Array[];
    traceId: string;
    routeDecision: AiRoutePolicy;
    modelResolved: string;
  }>();

  for await (const item of stream) {
    const chunk = asRecord(item);
    const artifactId = normalizeText(chunk.artifactId) || `artifact-${order.length + 1}`;
    const state = states.get(artifactId) || {
      artifactId,
      mimeType: '',
      chunks: [],
      traceId: '',
      routeDecision: 'local' as const,
      modelResolved: '',
    };

    if (!states.has(artifactId)) {
      states.set(artifactId, state);
      order.push(artifactId);
    }

    const mimeType = normalizeText(chunk.mimeType);
    if (mimeType) {
      state.mimeType = mimeType;
    }

    const traceId = normalizeText(chunk.traceId);
    if (traceId) {
      state.traceId = traceId;
    }

    const modelResolved = normalizeText(chunk.modelResolved);
    if (modelResolved) {
      state.modelResolved = modelResolved;
    }

    state.routeDecision = fromRouteDecision(chunk.routeDecision);

    const bytes = chunk.chunk;
    if (bytes instanceof Uint8Array) {
      state.chunks.push(bytes);
    } else if (bytes instanceof ArrayBuffer) {
      state.chunks.push(new Uint8Array(bytes));
    } else if (Array.isArray(bytes)) {
      state.chunks.push(Uint8Array.from(bytes.map((value) => Number(value) || 0)));
    }
  }

  return order.map((artifactId) => {
    const state = states.get(artifactId);
    if (!state) {
      return {
        artifactId,
        mimeType: '',
        bytes: new Uint8Array(0),
        traceId: '',
        routeDecision: 'local' as const,
        modelResolved: '',
      };
    }
    return {
      artifactId: state.artifactId,
      mimeType: state.mimeType,
      bytes: concatChunks(state.chunks),
      traceId: state.traceId,
      routeDecision: state.routeDecision,
      modelResolved: state.modelResolved,
    };
  });
}

export function toEmbeddingVectors(vectors: unknown): number[][] {
  const list = Array.isArray(vectors) ? vectors : [];
  return list.map((entry) => {
    const values = readLooseListValues(entry);
    return values
      .map((value) => readNumberValue(value))
      .filter((value): value is number => typeof value === 'number');
  });
}

export function toEmbeddingVectorsFromScenarioOutput(output: ScenarioOutput | undefined): number[][] {
  const variant = output?.output;
  if (variant?.oneofKind !== 'textEmbed') {
    return [];
  }
  return variant.textEmbed.vectors.map((row) => row.values
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item)));
}

export function toSpeechTranscriptionFromScenarioOutput(output: ScenarioOutput | undefined): {
  text: string;
  artifacts: ScenarioArtifact[];
} {
  const variant = output?.output;
  if (variant?.oneofKind !== 'speechTranscribe') {
    return {
      text: '',
      artifacts: [],
    };
  }
  return {
    text: normalizeText(variant.speechTranscribe.text),
    artifacts: Array.isArray(variant.speechTranscribe.artifacts)
      ? variant.speechTranscribe.artifacts
      : [],
  };
}

export function toSpeechSynthesisArtifactsFromScenarioOutput(output: ScenarioOutput | undefined): ScenarioArtifact[] {
  const variant = output?.output;
  if (variant?.oneofKind !== 'speechSynthesize') {
    return [];
  }
  return Array.isArray(variant.speechSynthesize.artifacts)
    ? variant.speechSynthesize.artifacts
    : [];
}

function readLooseListValues(value: unknown): ProtoValue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const values = (value as { values?: unknown }).values;
  return Array.isArray(values) ? values.filter(isProtoNumberValue) : [];
}

function isProtoNumberValue(value: unknown): value is ProtoValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const kind = asRecord((value as { kind?: unknown }).kind);
  return kind.oneofKind === 'numberValue';
}

function readNumberValue(value: ProtoValue | undefined): number | undefined {
  if (value?.kind.oneofKind !== 'numberValue') {
    return undefined;
  }
  const parsed = Number(value.kind.numberValue);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeProviderError(error: unknown) {
  return asNimiError(error, {
    reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
    actionHint: 'check_runtime_and_route_policy',
    source: 'runtime',
  });
}
