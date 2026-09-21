import {
  ExecutionMode,
  MusicScoreFormat, MusicScoreConditioning, MusicGenerationTermination, MusicScoreOrigin,
  validateNimiLocalAppMusicGenerateSpec, validateNimiLocalAppMusicGeneration,
  type NimiLocalAppMusicGenerateSpec, type NimiLocalAppMusicGeneration,
  ReasonCode,
  ScenarioJobStatus,
  ScenarioType,
  asNimiError,
  buildNimiRuntimeScenarioJobIdentity,
  createNimiError,
  runNimiRuntimeScenarioJob,
  type NimiError,
  type NimiProtectedLocalScenarioJobClient,
  type RuntimeTypedCallOptions,
  type ScenarioJob,
  type SubmitScenarioJobRequest,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  runtimeScenarioJobNonSuccessReasonFromError,
  type RuntimeScenarioJobNonSuccessReason,
} from './runtime-diagnostics.js';

export type RuntimeMusicGenerateArtifact = {
  readonly artifactId: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationMs: number;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly frameCount?: number;
};

export type RuntimeMusicGenerateResult =
  | {
      readonly ok: true;
      readonly capabilityId: 'music.generate';
      readonly message: string;
      readonly output: {
        readonly kind: 'music-artifacts';
        readonly jobId: string;
        readonly jobStatus: string;
        readonly artifactCount: number;
        readonly generation: NimiLocalAppMusicGeneration;
        readonly firstArtifact: RuntimeMusicGenerateArtifact;
        readonly artifacts: readonly RuntimeMusicGenerateArtifact[];
      };
      readonly trace?: { readonly traceId?: string; readonly modelResolved?: string };
    }
  | { readonly ok: false; readonly capabilityId: 'music.generate'; readonly reason: RuntimeScenarioJobNonSuccessReason | 'input-invalid'; readonly message: string; readonly error: NimiError };

export type RuntimeMusicGenerateInput = Omit<NimiLocalAppMusicGenerateSpec, 'type'> & {
  readonly runtime: { readonly ai: NimiProtectedLocalScenarioJobClient };
  readonly appId: string;
  readonly subjectUserId?: string;
  readonly scenarioId: string;
  readonly surfaceId: string;
  readonly timeoutMs?: number;
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly signal?: AbortSignal;
  readonly abortReason?: string;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
};

// Executes the sole App-facing Music path. The required client is the SDK App
// protected Local App Scenario Job adapter, never an unprotected Runtime client.
export async function runRuntimeMusicGenerate(input: RuntimeMusicGenerateInput): Promise<RuntimeMusicGenerateResult> {
  try {
    const spec = validateNimiLocalAppMusicGenerateSpec({
      type: 'music-generate', prompt: input.prompt, lyrics: input.lyrics,
      ...(input.durationSeconds !== undefined ? { durationSeconds: input.durationSeconds } : {}),
      ...(input.instrumental !== undefined ? { instrumental: input.instrumental } : {}),
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.score !== undefined ? { score: input.score } : {}),
      ...(input.scoreConditioning !== undefined ? { scoreConditioning: input.scoreConditioning } : {}),
      ...(input.returnGeneratedScore !== undefined ? { returnGeneratedScore: input.returnGeneratedScore } : {}),
      ...(input.audioReference !== undefined ? { audioReference: input.audioReference } : {}),
    });
    const identity = buildNimiRuntimeScenarioJobIdentity({ appId: input.appId, capabilityId: 'music.generate', scenarioId: input.scenarioId });
    const request: SubmitScenarioJobRequest = {
      head: { appId: requireMusicText(input.appId, 'appId'), subjectUserId: normalizeText(input.subjectUserId), timeoutMs: input.timeoutMs ?? 0 },
      scenarioType: ScenarioType.MUSIC_GENERATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'musicGenerate', musicGenerate: {
        prompt: spec.prompt, lyrics: spec.lyrics, negativePrompt: '', style: '', title: '', durationSeconds: spec.durationSeconds ?? 0,
        instrumental: spec.instrumental ?? false, seed: spec.seed, returnGeneratedScore: spec.returnGeneratedScore ?? false,
        scoreConditioning: spec.scoreConditioning === 'melody-only' ? MusicScoreConditioning.MELODY_ONLY : spec.scoreConditioning === 'melody-and-harmony' ? MusicScoreConditioning.MELODY_AND_HARMONY : MusicScoreConditioning.UNSPECIFIED,
        score: spec.score ? { artifactId: spec.score.artifactId, format: spec.score.format === 'abc' ? MusicScoreFormat.ABC : MusicScoreFormat.MIDI } : undefined,
        audioReference: spec.audioReference ? { artifactId: spec.audioReference.artifactId, range: spec.audioReference.range ? { startFrame: String(spec.audioReference.range.startFrame), endFrame: String(spec.audioReference.range.endFrame) } : undefined } : undefined,
      } } },
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      labels: { scenarioId: input.scenarioId, surfaceId: input.surfaceId },
      extensions: [],
    };
    const result = await runNimiRuntimeScenarioJob({ ai: input.runtime.ai, request, callOptions: input.callOptions, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate });
    const value = result.job.musicGeneration;
    if (!value) throw new Error('Runtime music.generate returned no typed generation result');
    const artifacts = result.artifacts.map((artifact) => ({ artifactId: artifact.artifactId, mimeType: artifact.mimeType,
      sizeBytes: Number(artifact.sizeBytes), durationMs: Number(artifact.durationMs), sampleRateHz: artifact.sampleRateHz,
      channels: artifact.channels, ...(Number(artifact.frameCount) > 0 ? { frameCount: Number(artifact.frameCount) } : {}) }));
    const generation = validateNimiLocalAppMusicGeneration({
      mixArtifactId: value.mixArtifactId,
      termination: ({ [MusicGenerationTermination.UNKNOWN]: 'unknown', [MusicGenerationTermination.MODEL_END]: 'model-end', [MusicGenerationTermination.BUDGET_LIMIT]: 'budget-limit' } as Record<number, string>)[value.termination],
      ...(value.actualSeed !== undefined ? { actualSeed: value.actualSeed } : {}),
      audioInfo: value.audioInfo ? { ...value.audioInfo, frameCount: Number(value.audioInfo.frameCount), durationMs: Number(value.audioInfo.durationMs) } : undefined,
      ...(value.generatedScore ? { generatedScore: { artifactId: value.generatedScore.artifactId, truncated: value.generatedScore.truncated,
        format: value.generatedScore.format === MusicScoreFormat.ABC ? 'abc' : undefined,
        origin: value.generatedScore.origin === MusicScoreOrigin.GENERATED_PLAN ? 'generated-plan' : undefined } } : {}),
    }, artifacts);
    const projected = artifacts.find((artifact) => artifact.artifactId === generation.mixArtifactId)!;
    return {
      ok: true,
      capabilityId: 'music.generate',
      message: `Runtime music.generate completed with ${artifacts.length} artifacts.`,
      output: { kind: 'music-artifacts', jobId: result.job.jobId, jobStatus: musicJobStatusName(result.job.status), artifactCount: artifacts.length, generation, firstArtifact: projected, artifacts },
      trace: { ...(result.traceId ? { traceId: result.traceId } : {}), ...(result.job.modelResolved ? { modelResolved: result.job.modelResolved } : {}) },
    };
  } catch (cause) {
    const error = asNimiError(cause, { reasonCode: ReasonCode.RUNTIME_CALL_FAILED, actionHint: 'inspect_runtime_music_execution', source: 'runtime' });
    const reasonCode = normalizeText(error.reasonCode) || normalizeText(error.code);
    return { ok: false, capabilityId: 'music.generate', reason: reasonCode === ReasonCode.SDK_AI_INPUT_INVALID || reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID' || reasonCode.startsWith('SDK_GENERATION_') ? 'input-invalid' : runtimeScenarioJobNonSuccessReasonFromError(error), message: error.message, error };
  }
}

function requireMusicText(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text || new TextEncoder().encode(text).byteLength > 32 * 1024) {
    throw createNimiError({
      message: `music ${field} is invalid`,
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: `provide_music_${field}`,
      source: 'sdk',
    });
  }
  return text;
}

function musicJobStatusName(status: ScenarioJobStatus): string {
  return ScenarioJobStatus[status] || String(status);
}

function normalizeText(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
