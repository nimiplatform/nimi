import {
  asNimiError,
  createNimiError,
  type RuntimeCallOptions,
  type RuntimeAiSubmitScenarioJobRequestInput,
} from '../runtime/index.js';
import type {
  Value as ProtoValue,
} from '../runtime/generated/google/protobuf/struct.js';
import { ReasonCode, type AiRoutePolicy } from '../types/index.js';
import {
  ROUTE_POLICY_CLOUD,
  type NimiArtifact,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import { asRecord, normalizeText } from '../internal/utils.js';
import {
  ExecutionMode,
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

function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

function fromRouteDecision(value: unknown): AiRoutePolicy {
  return Number(value) === ROUTE_POLICY_CLOUD ? 'cloud' : 'local';
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toCallOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
  },
): RuntimeCallOptions {
  const timeoutMs = typeof input.timeoutMs === 'number'
    ? input.timeoutMs
    : defaults.timeoutMs;
  const metadata = {
    ...(defaults.metadata || {}),
    ...(input.metadata || {}),
  };

  return {
    timeoutMs,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
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
    submitRequest as never,
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
  const cancelRemoteJob = async (reason: string) => {
    if (cancelIssued) {
      return;
    }
    cancelIssued = true;
    try {
      await runtime.ai.cancelScenarioJob(
        {
          jobId,
          reason,
        } as never,
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
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_scenario_job_request',
        source: 'sdk',
      });
    }

    const jobResponse = await runtime.ai.getScenarioJob(
      { jobId } as never,
      toCallOptions(defaults, { timeoutMs }),
    );
    const job = jobResponse.job;
    const status = Number(job?.status || 0);
    if (status === ScenarioJobStatus.COMPLETED) {
      const artifactsResponse = await runtime.ai.getScenarioArtifacts(
        { jobId } as never,
        toCallOptions(defaults, { timeoutMs }),
      );
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
      const reasonCode = normalizeText(job?.reasonCode) || ReasonCode.AI_PROVIDER_UNAVAILABLE;
      throw createNimiError({
        message: normalizeText(job?.reasonDetail) || `scenario job failed: ${reasonCode}`,
        reasonCode,
        actionHint: 'retry_scenario_job_request',
        source: 'runtime',
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
    await sleep(250);
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

export function toEmbeddingVectorsFromScenarioOutput(output: unknown): number[][] {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  if (variant?.oneofKind !== 'textEmbed') {
    return [];
  }
  return variant.textEmbed.vectors.map((row) => row.values
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item)));
}

export function toSpeechTranscriptionFromScenarioOutput(output: unknown): {
  text: string;
  artifacts: ScenarioArtifact[];
} {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
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

export function toSpeechSynthesisArtifactsFromScenarioOutput(output: unknown): ScenarioArtifact[] {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
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
  return Array.isArray(values)
    ? values as ProtoValue[]
    : [];
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
