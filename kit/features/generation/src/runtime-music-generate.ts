import {
  ExecutionMode,
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
        readonly artifactCount: 1;
        readonly firstArtifact: RuntimeMusicGenerateArtifact;
        readonly artifacts: readonly [RuntimeMusicGenerateArtifact];
      };
      readonly trace?: { readonly traceId?: string; readonly modelResolved?: string };
    }
  | { readonly ok: false; readonly capabilityId: 'music.generate'; readonly reason: RuntimeScenarioJobNonSuccessReason | 'input-invalid'; readonly message: string; readonly error: NimiError };

export type RuntimeMusicGenerateInput = {
  readonly runtime: { readonly ai: NimiProtectedLocalScenarioJobClient };
  readonly appId: string;
  readonly subjectUserId?: string;
  readonly prompt: string;
  readonly lyrics: string;
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
    const prompt = requireMusicText(input.prompt, 'prompt');
    const lyrics = requireMusicText(input.lyrics, 'lyrics');
    const identity = buildNimiRuntimeScenarioJobIdentity({ appId: input.appId, capabilityId: 'music.generate', scenarioId: input.scenarioId });
    const request: SubmitScenarioJobRequest = {
      head: { appId: requireMusicText(input.appId, 'appId'), subjectUserId: normalizeText(input.subjectUserId), timeoutMs: input.timeoutMs ?? 0 },
      scenarioType: ScenarioType.MUSIC_GENERATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'musicGenerate', musicGenerate: { prompt, negativePrompt: '', lyrics, style: '', title: '', durationSeconds: 0, instrumental: false } } },
      requestId: identity.requestId,
      idempotencyKey: identity.idempotencyKey,
      labels: { scenarioId: input.scenarioId, surfaceId: input.surfaceId },
      extensions: [],
    };
    const result = await runNimiRuntimeScenarioJob({ ai: input.runtime.ai, request, callOptions: input.callOptions, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate });
    const artifact = result.artifacts.find((candidate) => normalizeText(candidate.mimeType).startsWith('audio/') && normalizeText(candidate.artifactId));
    if (!artifact) throw new Error('Runtime music.generate returned no audio artifact');
    const projected = { artifactId: artifact.artifactId, mimeType: artifact.mimeType, sizeBytes: Number(artifact.sizeBytes), durationMs: Number(artifact.durationMs), sampleRateHz: artifact.sampleRateHz, channels: artifact.channels };
    return {
      ok: true,
      capabilityId: 'music.generate',
      message: 'Runtime music.generate completed with 1 artifact.',
      output: { kind: 'music-artifacts', jobId: result.job.jobId, jobStatus: musicJobStatusName(result.job.status), artifactCount: 1, firstArtifact: projected, artifacts: [projected] },
      trace: { ...(result.traceId ? { traceId: result.traceId } : {}), ...(result.job.modelResolved ? { modelResolved: result.job.modelResolved } : {}) },
    };
  } catch (cause) {
    const error = asNimiError(cause, { reasonCode: ReasonCode.RUNTIME_CALL_FAILED, actionHint: 'inspect_runtime_music_execution', source: 'runtime' });
    const reasonCode = normalizeText(error.reasonCode) || normalizeText(error.code);
    return { ok: false, capabilityId: 'music.generate', reason: reasonCode === ReasonCode.SDK_AI_INPUT_INVALID || reasonCode.startsWith('SDK_GENERATION_') ? 'input-invalid' : runtimeScenarioJobNonSuccessReasonFromError(error), message: error.message, error };
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
