import {
  runRuntimeAiScenarioJob,
  type RuntimeAiSubmitScenarioJobRequestInput,
} from '../runtime/browser.js';
import { asNimiError } from '../core/errors.js';
import type {
  Value as ProtoValue,
} from '../runtime/generated/google/protobuf/struct.js';
import { ReasonCode, type AiRoutePolicy } from '../types/index.js';
import {
  type NimiArtifact,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import { asRecord, normalizeText } from '../internal/utils.js';
import {
  concatChunks,
  fromRouteDecision,
  toCallOptions,
} from './helpers-shared.js';
import {
  ExecutionMode,
  type ScenarioArtifact,
  type ScenarioOutput,
} from '../runtime/generated/runtime/v1/ai.js';

type ScenarioJobExecution = {
  artifacts: NimiArtifact[];
  traceId: string;
  routeDecision?: AiRoutePolicy;
  modelResolved: string;
  output?: ScenarioOutput;
};

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
  const execution = await runRuntimeAiScenarioJob({
    ai: runtime.ai,
    request: submitRequest,
    callOptions: toCallOptions(defaults, {
      timeoutMs,
      metadata: undefined,
    }),
    signal,
    timeoutMs,
  });
  const traceId = normalizeText(execution.traceId) || normalizeText(execution.job.traceId);
  const routeDecision = fromRouteDecision(execution.job.routeDecision);
  const modelResolved = normalizeText(execution.job.modelResolved) || normalizeText(request.head?.modelId);

  return {
    artifacts: execution.artifacts.map((item: ScenarioArtifact) => {
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
    output: execution.output,
  };
}

export async function collectArtifacts(stream: AsyncIterable<unknown>): Promise<NimiArtifact[]> {
  const order: string[] = [];
  const states = new Map<string, {
    artifactId: string;
    mimeType: string;
    chunks: Uint8Array[];
    traceId: string;
    routeDecision?: AiRoutePolicy;
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

    const routeDecision = fromRouteDecision(chunk.routeDecision);
    if (routeDecision) {
      state.routeDecision = routeDecision;
    }

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
