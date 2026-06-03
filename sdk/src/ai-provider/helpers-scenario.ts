import {
  ExecutionMode,
  runRuntimeAiScenarioJob,
  type ProtoValue,
  type RuntimeAiSubmitScenarioJobRequestInput,
  type ScenarioArtifact,
  type ScenarioOutput,
} from '../runtime/browser.js';
import { asNimiError, createNimiError } from '../core/errors.js';
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

type ScenarioJobExecution = {
  artifacts: NimiArtifact[];
  traceId: string;
  routeDecision?: AiRoutePolicy;
  modelResolved: string;
  output?: ScenarioOutput;
};

type ArtifactOutputKind = 'imageGenerate' | 'videoGenerate' | 'speechSynthesize';

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
  const modelResolved = normalizeText(execution.job.modelResolved);

  return {
    artifacts: execution.artifacts.map((item: ScenarioArtifact, index: number) => toNimiArtifact(
      item,
      {
        index,
        traceId,
        routeDecision,
        modelResolved,
      },
    )),
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
    const artifactId = normalizeText(chunk.artifactId);
    if (!artifactId) {
      throw missingArtifactMetadataError('stream artifact chunk is missing artifactId');
    }
    const state = states.get(artifactId) || {
      artifactId,
      mimeType: normalizeText(chunk.mimeType),
      chunks: [],
      traceId: normalizeText(chunk.traceId),
      modelResolved: normalizeText(chunk.modelResolved),
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

  return order.map((artifactId, index) => {
    const state = states.get(artifactId);
    if (!state || !state.artifactId || !state.mimeType || !state.traceId || !state.modelResolved) {
      throw missingArtifactMetadataError(`stream artifact ${index} is missing stable metadata`);
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

export function selectArtifactsFromScenarioOutput(
  execution: ScenarioJobExecution,
  kind: ArtifactOutputKind,
): NimiArtifact[] {
  const typedArtifacts = readTypedOutputArtifacts(execution.output, kind);
  const hydratedByArtifactId = new Map<string, NimiArtifact>();
  for (const artifact of execution.artifacts) {
    hydratedByArtifactId.set(artifact.artifactId, artifact);
  }

  return typedArtifacts.map((artifact, index) => {
    const artifactId = normalizeText(artifact.artifactId);
    if (!artifactId) {
      throw missingArtifactMetadataError(`runtime ${kind} artifact ${index} is missing artifactId`);
    }
    const hydrated = hydratedByArtifactId.get(artifactId);
    const mimeType = normalizeText(hydrated?.mimeType) || normalizeText(artifact.mimeType);
    if (!mimeType) {
      throw missingArtifactMetadataError(`runtime ${kind} artifact ${index} is missing mimeType`);
    }
    const traceId = normalizeText(hydrated?.traceId) || normalizeText(execution.traceId);
    if (!traceId) {
      throw missingArtifactMetadataError(`runtime ${kind} artifact ${index} is missing traceId`);
    }
    const modelResolved = normalizeText(hydrated?.modelResolved) || normalizeText(execution.modelResolved);
    if (!modelResolved) {
      throw missingArtifactMetadataError(`runtime ${kind} artifact ${index} is missing modelResolved`);
    }
    const bytes = hydrated?.bytes ?? (
      artifact.bytes instanceof Uint8Array
        ? artifact.bytes
        : new Uint8Array(0)
    );
    return {
      artifactId,
      mimeType,
      bytes,
      traceId,
      routeDecision: hydrated?.routeDecision ?? execution.routeDecision,
      modelResolved,
    };
  });
}

function readTypedOutputArtifacts(
  output: ScenarioOutput | undefined,
  kind: ArtifactOutputKind,
): ScenarioArtifact[] {
  const variant = output?.output;
  if (variant?.oneofKind !== kind) {
    throw createNimiError({
      message: `runtime media output missing typed ${kind} result`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }
  const artifacts = (() => {
    switch (variant.oneofKind) {
      case 'imageGenerate':
        return variant.imageGenerate.artifacts;
      case 'videoGenerate':
        return variant.videoGenerate.artifacts;
      case 'speechSynthesize':
        return variant.speechSynthesize.artifacts;
    }
  })();
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw createNimiError({
      message: `runtime media output missing artifacts for typed ${kind} result`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_media_contract',
      source: 'runtime',
    });
  }
  return artifacts;
}

function toNimiArtifact(
  artifact: ScenarioArtifact,
  context: {
    index: number;
    traceId: string;
    routeDecision?: AiRoutePolicy;
    modelResolved: string;
  },
): NimiArtifact {
  const artifactId = normalizeText(artifact.artifactId);
  const mimeType = normalizeText(artifact.mimeType);
  const traceId = normalizeText(context.traceId);
  const modelResolved = normalizeText(context.modelResolved);
  if (!artifactId || !mimeType || !traceId || !modelResolved) {
    throw missingArtifactMetadataError(`runtime scenario artifact ${context.index} is missing stable metadata`);
  }
  const bytes = artifact.bytes instanceof Uint8Array
    ? artifact.bytes
    : new Uint8Array(0);
  return {
    artifactId,
    mimeType,
    bytes,
    traceId,
    routeDecision: context.routeDecision,
    modelResolved,
  };
}

function missingArtifactMetadataError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_media_contract',
    source: 'runtime',
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
