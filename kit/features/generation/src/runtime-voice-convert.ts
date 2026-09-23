import { ExecutionMode, ScenarioType, VoiceConversionLengthRelation,
  validateNimiLocalAppVoiceConvertSpec, validateNimiLocalAppVoiceConversion, buildNimiRuntimeScenarioJobIdentity, runNimiRuntimeScenarioJob, observeNimiRuntimeScenarioJob,
  asNimiError, ReasonCode, type NimiLocalAppVoiceConvertSpec, type NimiLocalAppVoiceConversion, type NimiProtectedLocalScenarioJobClient,
  type NimiRuntimeScenarioJobResult, type ScenarioJob, type NimiError } from '@nimiplatform/kit/core/sdk-contract';
import { runtimeScenarioJobNonSuccessReasonFromError, type RuntimeScenarioJobNonSuccessReason } from './runtime-diagnostics.js';

export type RuntimeVoiceConvertInput = Omit<NimiLocalAppVoiceConvertSpec, 'type'> & {
  readonly runtime: { readonly ai: NimiProtectedLocalScenarioJobClient };
  readonly appId: string; readonly scenarioId: string; readonly surfaceId: string;
  readonly signal?: AbortSignal; readonly abortReason?: string; readonly timeoutMs?: number;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
};
export type RuntimeVoiceConvertResult =
  | { readonly ok: true; readonly capabilityId: 'audio.voice.convert'; readonly message: string;
      readonly output: { readonly kind: 'voice-conversion-artifacts'; readonly jobId: string; readonly jobStatus: string;
        readonly conversion: NimiLocalAppVoiceConversion; readonly artifactCount: number;
        readonly artifacts: readonly { artifactId: string; mimeType: string; sizeBytes: number; sha256: string; durationMs: number; sampleRateHz: number; channels: number; frameCount?: number }[] };
      readonly trace?: { readonly traceId?: string } }
  | { readonly ok: false; readonly capabilityId: 'audio.voice.convert'; readonly reason: RuntimeScenarioJobNonSuccessReason | 'input-invalid'; readonly message: string; readonly error: NimiError };

const sourceKind = { singing: 1 } as const;

// @nimi-authority: rule.nimi.runtime.ai-provider.voice-conversion
export async function runRuntimeVoiceConvert(input: RuntimeVoiceConvertInput): Promise<RuntimeVoiceConvertResult> {
  try {
    const spec = validateNimiLocalAppVoiceConvertSpec({ type: 'audio-voice-convert', sourceVocal: input.sourceVocal, sourceKind: input.sourceKind, targetVoice: input.targetVoice,
      ...(input.semitoneShift !== undefined ? { semitoneShift: input.semitoneShift } : {}) });
    const identity = buildNimiRuntimeScenarioJobIdentity({ appId: input.appId, capabilityId: 'audio.voice.convert', scenarioId: input.scenarioId });
    const result = await runNimiRuntimeScenarioJob({ ai: input.runtime.ai, request: {
      head: { appId: input.appId, subjectUserId: '', timeoutMs: input.timeoutMs ?? 0 }, scenarioType: ScenarioType.AUDIO_VOICE_CONVERT, executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'audioVoiceConvert', audioVoiceConvert: {
        sourceVocal: { artifactId: spec.sourceVocal.artifactId, range: spec.sourceVocal.range ? { startFrame: String(spec.sourceVocal.range.startFrame), endFrame: String(spec.sourceVocal.range.endFrame) } : undefined },
        sourceKind: sourceKind[spec.sourceKind],
        targetVoice: spec.targetVoice.kind === 'reference-audio'
          ? { target: { oneofKind: 'referenceAudio', referenceAudio: { artifactId: spec.targetVoice.artifactId, range: spec.targetVoice.range ? { startFrame: String(spec.targetVoice.range.startFrame), endFrame: String(spec.targetVoice.range.endFrame) } : undefined } } }
          : spec.targetVoice.kind === 'preset'
            ? { target: { oneofKind: 'presetVoiceId', presetVoiceId: spec.targetVoice.presetVoiceId } }
            : { target: { oneofKind: 'voiceAssetId', voiceAssetId: spec.targetVoice.voiceAssetId } },
        semitoneShift: spec.semitoneShift,
      } } }, requestId: identity.requestId, idempotencyKey: identity.idempotencyKey, labels: { scenarioId: input.scenarioId, surfaceId: input.surfaceId }, extensions: [],
    }, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate });
    return project(result);
  } catch (error) { return failure(error); }
}

export async function observeRuntimeVoiceConversion(input: Pick<RuntimeVoiceConvertInput, 'runtime' | 'signal' | 'abortReason' | 'onJobUpdate'> & { readonly jobId: string }): Promise<RuntimeVoiceConvertResult> {
  try { return project(await observeNimiRuntimeScenarioJob({ ai: input.runtime.ai, jobId: input.jobId, scenarioType: ScenarioType.AUDIO_VOICE_CONVERT, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate })); }
  catch (error) { return failure(error); }
}

function project(result: NimiRuntimeScenarioJobResult): RuntimeVoiceConvertResult {
  const value = result.job.voiceConversion;
  if (!value) throw new Error('Runtime audio.voice.convert returned no typed conversion');
  const artifacts = result.artifacts.map((artifact) => ({ artifactId: artifact.artifactId, mimeType: artifact.mimeType,
    sha256: artifact.sha256, sizeBytes: Number(artifact.sizeBytes), durationMs: Number(artifact.durationMs), sampleRateHz: artifact.sampleRateHz,
    channels: artifact.channels, ...(Number(artifact.frameCount) > 0 ? { frameCount: Number(artifact.frameCount) } : {}) }));
  const conversion = validateNimiLocalAppVoiceConversion({
    vocalArtifactId: value.vocalArtifactId, sourceArtifactId: value.sourceArtifactId,
    sourceInfo: value.sourceInfo ? { ...value.sourceInfo, frameCount: Number(value.sourceInfo.frameCount), durationMs: Number(value.sourceInfo.durationMs) } : undefined,
    inputRange: value.inputRange ? { startFrame: Number(value.inputRange.startFrame), endFrame: Number(value.inputRange.endFrame) } : undefined,
    vocalInfo: value.vocalInfo ? { ...value.vocalInfo, frameCount: Number(value.vocalInfo.frameCount), durationMs: Number(value.vocalInfo.durationMs) } : undefined,
    lengthRelation: ({ [VoiceConversionLengthRelation.EXACT]: 'EXACT', [VoiceConversionLengthRelation.MODEL_FRAME_ROUNDING]: 'MODEL_FRAME_ROUNDING' } as Record<number, string>)[value.lengthRelation],
    durationDeltaMs: Number(value.durationDeltaMs),
  }, artifacts);
  return { ok: true, capabilityId: 'audio.voice.convert', message: 'Voice conversion returned a converted vocal with a reported length relation and duration delta.',
    output: { kind: 'voice-conversion-artifacts', jobId: result.job.jobId, jobStatus: 'completed', conversion, artifactCount: artifacts.length, artifacts },
    trace: result.traceId ? { traceId: result.traceId } : undefined };
}
function failure(cause: unknown): RuntimeVoiceConvertResult {
  const error = asNimiError(cause, { reasonCode: ReasonCode.RUNTIME_CALL_FAILED, actionHint: 'inspect_runtime_voice_conversion', source: 'runtime' });
  return { ok: false, capabilityId: 'audio.voice.convert', reason: error.reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID' ? 'input-invalid' : runtimeScenarioJobNonSuccessReasonFromError(error), message: error.message, error };
}
