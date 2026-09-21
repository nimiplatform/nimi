import { ExecutionMode, ScenarioType, MusicTranscriptionFormat, MusicTranscriptionPart, MusicTranscriptionCompleteness, MusicScoreFormat, MusicScoreOrigin,
  validateNimiLocalAppMusicTranscribeSpec, validateNimiLocalAppMusicTranscription, buildNimiRuntimeScenarioJobIdentity, runNimiRuntimeScenarioJob, observeNimiRuntimeScenarioJob,
  asNimiError, ReasonCode, type NimiLocalAppMusicTranscribeSpec, type NimiLocalAppMusicTranscription, type NimiProtectedLocalScenarioJobClient,
  type NimiRuntimeScenarioJobResult, type ScenarioJob, type NimiError } from '@nimiplatform/kit/core/sdk-contract';
import { runtimeScenarioJobNonSuccessReasonFromError, type RuntimeScenarioJobNonSuccessReason } from './runtime-diagnostics.js';

export type RuntimeMusicTranscribeInput = Omit<NimiLocalAppMusicTranscribeSpec, 'type'> & {
  readonly runtime: { readonly ai: NimiProtectedLocalScenarioJobClient };
  readonly appId: string; readonly scenarioId: string; readonly surfaceId: string;
  readonly signal?: AbortSignal; readonly abortReason?: string; readonly timeoutMs?: number;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
};
export type RuntimeMusicTranscribeResult =
  | { readonly ok: true; readonly capabilityId: 'music.transcribe'; readonly message: string;
      readonly output: { readonly kind: 'music-transcription-artifacts'; readonly jobId: string; readonly jobStatus: string;
        readonly transcription: NimiLocalAppMusicTranscription; readonly artifactCount: number;
        readonly artifacts: readonly { artifactId: string; mimeType: string; sizeBytes: number; sha256: string }[] };
      readonly trace?: { readonly traceId?: string } }
  | { readonly ok: false; readonly capabilityId: 'music.transcribe'; readonly reason: RuntimeScenarioJobNonSuccessReason | 'input-invalid'; readonly message: string; readonly error: NimiError };

const format = { abc: MusicTranscriptionFormat.ABC, midi: MusicTranscriptionFormat.MIDI, timeline: MusicTranscriptionFormat.TIMELINE };
const part = { 'vocal-melody': MusicTranscriptionPart.VOCAL_MELODY, 'lead-sheet': MusicTranscriptionPart.LEAD_SHEET, 'full-arrangement': MusicTranscriptionPart.FULL_ARRANGEMENT };

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
export async function runRuntimeMusicTranscribe(input: RuntimeMusicTranscribeInput): Promise<RuntimeMusicTranscribeResult> {
  try {
    const spec = validateNimiLocalAppMusicTranscribeSpec({ type: 'music-transcribe', sourceAudio: input.sourceAudio, requestedFormats: input.requestedFormats, requestedParts: input.requestedParts });
    const identity = buildNimiRuntimeScenarioJobIdentity({ appId: input.appId, capabilityId: 'music.transcribe', scenarioId: input.scenarioId });
    const result = await runNimiRuntimeScenarioJob({ ai: input.runtime.ai, request: {
      head: { appId: input.appId, subjectUserId: '', timeoutMs: input.timeoutMs ?? 0 }, scenarioType: ScenarioType.MUSIC_TRANSCRIBE, executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'musicTranscribe', musicTranscribe: {
        sourceAudio: { artifactId: spec.sourceAudio.artifactId, range: spec.sourceAudio.range ? { startFrame: String(spec.sourceAudio.range.startFrame), endFrame: String(spec.sourceAudio.range.endFrame) } : undefined },
        requestedFormats: spec.requestedFormats.map(value => format[value]), requestedParts: spec.requestedParts.map(value => part[value]),
      } } }, requestId: identity.requestId, idempotencyKey: identity.idempotencyKey, labels: { scenarioId: input.scenarioId, surfaceId: input.surfaceId }, extensions: [],
    }, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate });
    return project(result);
  } catch (error) { return failure(error); }
}

export async function observeRuntimeMusicTranscription(input: Pick<RuntimeMusicTranscribeInput, 'runtime' | 'signal' | 'abortReason' | 'onJobUpdate'> & { readonly jobId: string }): Promise<RuntimeMusicTranscribeResult> {
  try { return project(await observeNimiRuntimeScenarioJob({ ai: input.runtime.ai, jobId: input.jobId, scenarioType: ScenarioType.MUSIC_TRANSCRIBE, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate })); }
  catch (error) { return failure(error); }
}

function project(result: NimiRuntimeScenarioJobResult): RuntimeMusicTranscribeResult {
  const value = result.job.musicTranscription;
  if (!value) throw new Error('Runtime music.transcribe returned no typed estimate');
  const artifacts = result.artifacts.map(a => ({ artifactId: a.artifactId, mimeType: a.mimeType, sizeBytes: Number(a.sizeBytes), sha256: a.sha256 }));
  const transcription = validateNimiLocalAppMusicTranscription({
    scores: value.scores.map(score => ({ artifactId: score.artifactId, format: score.format === MusicScoreFormat.ABC ? 'abc' : score.format === MusicScoreFormat.MIDI ? 'midi' : undefined,
      part: ({ [MusicTranscriptionPart.VOCAL_MELODY]: 'vocal-melody', [MusicTranscriptionPart.LEAD_SHEET]: 'lead-sheet', [MusicTranscriptionPart.FULL_ARRANGEMENT]: 'full-arrangement' } as Record<number, string>)[score.part] })),
    ...(value.timelineArtifactId ? { timelineArtifactId: value.timelineArtifactId } : {}), origin: value.origin === MusicScoreOrigin.TRANSCRIBED_ESTIMATE ? 'transcribed-estimate' : undefined,
    sourceArtifactId: value.sourceArtifactId, sourceInfo: value.sourceInfo ? { ...value.sourceInfo, frameCount: Number(value.sourceInfo.frameCount), durationMs: Number(value.sourceInfo.durationMs) } : undefined,
    inputRange: value.inputRange ? { startFrame: Number(value.inputRange.startFrame), endFrame: Number(value.inputRange.endFrame) } : undefined,
    completeness: ({ [MusicTranscriptionCompleteness.UNKNOWN]: 'unknown', [MusicTranscriptionCompleteness.COMPLETE]: 'complete', [MusicTranscriptionCompleteness.TRUNCATED]: 'truncated' } as Record<number, string>)[value.completeness],
  }, artifacts);
  return { ok: true, capabilityId: 'music.transcribe', message: 'Music transcription returned an estimated score and musical events.',
    output: { kind: 'music-transcription-artifacts', jobId: result.job.jobId, jobStatus: 'completed', transcription, artifactCount: artifacts.length, artifacts },
    trace: result.traceId ? { traceId: result.traceId } : undefined };
}
function failure(cause: unknown): RuntimeMusicTranscribeResult {
  const error = asNimiError(cause, { reasonCode: ReasonCode.RUNTIME_CALL_FAILED, actionHint: 'inspect_runtime_music_transcription', source: 'runtime' });
  return { ok: false, capabilityId: 'music.transcribe', reason: error.reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID' ? 'input-invalid' : runtimeScenarioJobNonSuccessReasonFromError(error), message: error.message, error };
}
