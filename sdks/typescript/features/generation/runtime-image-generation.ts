import {
  type RuntimeTypedCallOptions,
  type ScenarioArtifact,
  type ScenarioExtension,
  type ScenarioJob,
  type ScenarioOutput,
} from '../../core-generated/runtime-typed-client';
import { runNimiRuntimeScenarioJob, type NimiScenarioJobClient } from '../../runtime/scenario-jobs';
import { createNimiError, ReasonCode } from '../../types';
import { buildNimiRuntimeGenerationSubmitRequest, type NimiRuntimeGenerationHeadInput } from './runtime-generation-build';
import { createNimiImageGenerationScenario } from './runtime-scenarios';

type NimiRuntimeImageScenarioRuntime = NimiScenarioJobClient | { readonly ai: NimiScenarioJobClient };

export interface NimiRuntimeImageGenerationInput {
  readonly runtime: NimiRuntimeImageScenarioRuntime;
  readonly head: NimiRuntimeGenerationHeadInput;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly count?: number;
  readonly size?: string;
  readonly aspectRatio?: string;
  readonly quality?: string;
  readonly style?: string;
  readonly seed?: string | number | bigint;
  readonly referenceImages?: readonly string[];
  readonly mask?: string;
  readonly responseFormat?: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: readonly ScenarioExtension[];
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
}

export interface NimiRuntimeImageGenerationOutput {
  readonly artifacts: readonly ScenarioArtifact[];
}

export interface NimiRuntimeImageGenerationResult extends NimiRuntimeImageGenerationOutput {
  readonly job: ScenarioJob;
  readonly traceId?: string;
  readonly output?: ScenarioOutput;
}

export async function runNimiRuntimeImageGeneration(
  input: NimiRuntimeImageGenerationInput,
): Promise<NimiRuntimeImageGenerationResult> {
  const ai = getRuntimeImageScenarioClient(input.runtime);
  const result = await runNimiRuntimeScenarioJob({
    ai,
    request: buildNimiRuntimeGenerationSubmitRequest(input.head, {
      scenario: createNimiImageGenerationScenario({
        kind: 'image',
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        count: input.count,
        size: input.size,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        style: input.style,
        seed: input.seed,
        referenceImages: input.referenceImages,
        mask: input.mask,
        responseFormat: input.responseFormat,
      }),
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      labels: input.labels,
      extensions: input.extensions,
    }),
    callOptions: input.callOptions,
    signal: input.signal,
    abortReason: input.abortReason,
    onJobUpdate: input.onJobUpdate,
  });
  const generated = extractNimiRuntimeImageGenerationOutput(result.output);
  const jobArtifacts = result.artifacts.filter(isRuntimeImageArtifact);
  return {
    artifacts: jobArtifacts.length > 0 ? jobArtifacts : generated.artifacts,
    job: result.job,
    traceId: result.traceId || result.job.traceId || undefined,
    output: result.output,
  };
}

export function extractNimiRuntimeImageGenerationOutput(
  output: ScenarioOutput | undefined,
): NimiRuntimeImageGenerationOutput {
  const variant = output?.output;
  if (variant?.oneofKind !== 'imageGenerate') {
    throw generationError(
      'SDK_RUNTIME_RESPONSE_DECODE_FAILED',
      'Runtime image generation output is missing typed imageGenerate result',
      'check_runtime_image_generation_output',
    );
  }
  const artifacts = Array.isArray(variant.imageGenerate.artifacts)
    ? variant.imageGenerate.artifacts.filter(isRuntimeImageArtifact)
    : [];
  if (artifacts.length === 0) {
    throw createNimiError({
      message: 'Runtime image generation returned no image artifact',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_image_generation',
      source: 'runtime',
    });
  }
  return {
    artifacts,
  };
}

function getRuntimeImageScenarioClient(runtime: NimiRuntimeImageScenarioRuntime): NimiScenarioJobClient {
  if ('ai' in runtime) {
    return runtime.ai;
  }
  return runtime;
}

function isRuntimeImageArtifact(artifact: ScenarioArtifact): boolean {
  return normalizeText(artifact.mimeType).startsWith('image/')
    && (
      normalizeText(artifact.artifactId).length > 0
      || normalizeText(artifact.uri).length > 0
      || artifact.bytes.length > 0
    );
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function generationError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
