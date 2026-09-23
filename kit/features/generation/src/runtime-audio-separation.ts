import { ExecutionMode, ScenarioType, AudioInstrumentPartKind,
  validateNimiLocalAppAudioSeparation, buildNimiRuntimeScenarioJobIdentity, runNimiRuntimeScenarioJob, observeNimiRuntimeScenarioJob,
  asNimiError, createNimiError, ReasonCode, type NimiLocalAppAudioSeparation, type NimiProtectedLocalScenarioJobClient,
  type NimiRuntimeScenarioJobResult, type ScenarioJob, type NimiError } from '@nimiplatform/kit/core/sdk-contract';
import { runtimeScenarioJobNonSuccessReasonFromError, type RuntimeScenarioJobNonSuccessReason } from './runtime-diagnostics.js';

export type NimiLocalAppAudioSeparateSpec = {
  type: 'audio-separate';
  mimeType: string;
  audioSource?: { type: 'bytes'; bytes: readonly number[] } | { type: 'uri'; uri: string };
  sourceAudio?: { artifactId: string; range?: { startFrame: number; endFrame: number } };
  includeInstrumentParts?: boolean;
};

export type RuntimeAudioSeparationInput = Omit<NimiLocalAppAudioSeparateSpec, 'type'> & {
  readonly runtime: { readonly ai: NimiProtectedLocalScenarioJobClient };
  readonly appId: string; readonly scenarioId: string; readonly surfaceId: string;
  readonly signal?: AbortSignal; readonly abortReason?: string; readonly timeoutMs?: number;
  readonly onJobUpdate?: (job: ScenarioJob) => void;
};
export type RuntimeAudioSeparationResult =
  | { readonly ok: true; readonly capabilityId: 'audio.separate'; readonly message: string;
      readonly output: { readonly kind: 'audio-separation'; readonly jobId: string; readonly jobStatus: string;
        readonly separation: NimiLocalAppAudioSeparation; readonly artifactCount: number;
        readonly artifacts: readonly { artifactId: string; mimeType: string; sizeBytes: number; sha256: string; durationMs: number; sampleRateHz: number; channels: number; frameCount?: number }[] };
      readonly trace?: { readonly traceId?: string } }
  | { readonly ok: false; readonly capabilityId: 'audio.separate'; readonly reason: RuntimeScenarioJobNonSuccessReason | 'input-invalid'; readonly message: string; readonly error: NimiError };

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

function inputError(): never {
  throw createNimiError({ message: 'Invalid audio separation input', reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID', actionHint: 'fix_input', source: 'sdk' });
}
const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength;
const hasControl = (value: string): boolean => /[\u0000-\u001f\u007f]/u.test(value);
const boundedToken = (value: unknown, maximum: number): boolean => typeof value === 'string' && value.trim() === value && utf8Length(value) <= maximum && !hasControl(value);
const boundedIdentifier = (value: unknown): boolean => typeof value === 'string' && !!value.trim() && value.trim() === value && utf8Length(value) <= 128 && !hasControl(value);
const onlyAllowedKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

function validateAudioSource(value: unknown): void {
  const source = value as Record<string, unknown> | undefined;
  if (!source) inputError();
  if (source.type === 'bytes') {
    if (!onlyAllowedKeys(source, ['type', 'bytes'])) inputError();
    const bytes = source.bytes;
    if (!Array.isArray(bytes) || bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES
      || bytes.some((byte) => !Number.isInteger(byte) || (byte as number) < 0 || (byte as number) > 255)) inputError();
    return;
  }
  if (source.type === 'uri') {
    if (!onlyAllowedKeys(source, ['type', 'uri'])) inputError();
    const uri = source.uri;
    if (typeof uri !== 'string' || !uri.trim() || uri.trim() !== uri || utf8Length(uri) > 2048 || uri.includes('\0')) inputError();
    try { if (new URL(uri).protocol !== 'https:') inputError(); } catch { inputError(); }
    return;
  }
  inputError();
}

function validateMusicAudioInput(value: unknown): void {
  const source = value as Record<string, unknown> | undefined;
  if (!source || !onlyAllowedKeys(source, ['artifactId', 'range']) || !boundedIdentifier(source.artifactId)) inputError();
  if (source.range !== undefined) {
    const range = source.range as Record<string, unknown> | undefined;
    if (!range || !onlyAllowedKeys(range, ['startFrame', 'endFrame'])
      || !Number.isSafeInteger(range.startFrame) || (range.startFrame as number) < 0 || (range.startFrame as number) > 57600000
      || !Number.isSafeInteger(range.endFrame) || (range.endFrame as number) < 1 || (range.endFrame as number) > 57600000
      || (range.startFrame as number) >= (range.endFrame as number)) inputError();
  }
}

function validateAudioSeparateSpec(value: unknown): NimiLocalAppAudioSeparateSpec {
  const record = value as Record<string, unknown> | undefined;
  if (!record || record.type !== 'audio-separate' || !boundedToken(record.mimeType, 128)) inputError();
  if ((record.audioSource === undefined) === (record.sourceAudio === undefined)) inputError();
  if (record.audioSource !== undefined) validateAudioSource(record.audioSource);
  if (record.sourceAudio !== undefined) validateMusicAudioInput(record.sourceAudio);
  if (record.includeInstrumentParts !== undefined && typeof record.includeInstrumentParts !== 'boolean') inputError();
  return value as NimiLocalAppAudioSeparateSpec;
}

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
export async function runRuntimeAudioSeparation(input: RuntimeAudioSeparationInput): Promise<RuntimeAudioSeparationResult> {
  try {
    const spec = validateAudioSeparateSpec({ type: 'audio-separate', mimeType: input.mimeType,
      ...(input.audioSource !== undefined ? { audioSource: input.audioSource } : {}),
      ...(input.sourceAudio !== undefined ? { sourceAudio: input.sourceAudio } : {}),
      ...(input.includeInstrumentParts !== undefined ? { includeInstrumentParts: input.includeInstrumentParts } : {}) });
    const identity = buildNimiRuntimeScenarioJobIdentity({ appId: input.appId, capabilityId: 'audio.separate', scenarioId: input.scenarioId });
    const result = await runNimiRuntimeScenarioJob({ ai: input.runtime.ai, request: {
      head: { appId: input.appId, subjectUserId: '', timeoutMs: input.timeoutMs ?? 0 }, scenarioType: ScenarioType.AUDIO_SEPARATE, executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'audioSeparate', audioSeparate: {
        mimeType: spec.mimeType,
        audioSource: spec.audioSource ? { source: spec.audioSource.type === 'bytes'
          ? { oneofKind: 'audioBytes', audioBytes: Uint8Array.from(spec.audioSource.bytes) }
          : { oneofKind: 'audioUri', audioUri: spec.audioSource.uri } } : undefined,
        sourceAudio: spec.sourceAudio ? { artifactId: spec.sourceAudio.artifactId,
          range: spec.sourceAudio.range ? { startFrame: String(spec.sourceAudio.range.startFrame), endFrame: String(spec.sourceAudio.range.endFrame) } : undefined } : undefined,
        includeInstrumentParts: spec.includeInstrumentParts ?? false,
      } } }, requestId: identity.requestId, idempotencyKey: identity.idempotencyKey, labels: { scenarioId: input.scenarioId, surfaceId: input.surfaceId }, extensions: [],
    }, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate });
    return project(result);
  } catch (error) { return failure(error); }
}

export async function observeRuntimeAudioSeparation(input: Pick<RuntimeAudioSeparationInput, 'runtime' | 'signal' | 'abortReason' | 'onJobUpdate'> & { readonly jobId: string }): Promise<RuntimeAudioSeparationResult> {
  try { return project(await observeNimiRuntimeScenarioJob({ ai: input.runtime.ai, jobId: input.jobId, scenarioType: ScenarioType.AUDIO_SEPARATE, signal: input.signal, abortReason: input.abortReason, onJobUpdate: input.onJobUpdate })); }
  catch (error) { return failure(error); }
}

function project(result: NimiRuntimeScenarioJobResult): RuntimeAudioSeparationResult {
  const value = result.job.audioSeparation;
  if (!value) throw new Error('Runtime audio.separate returned no typed separation');
  const artifacts = result.artifacts.map((artifact) => ({ artifactId: artifact.artifactId, mimeType: artifact.mimeType,
    sha256: artifact.sha256, sizeBytes: Number(artifact.sizeBytes), durationMs: Number(artifact.durationMs), sampleRateHz: artifact.sampleRateHz,
    channels: artifact.channels, ...(Number(artifact.frameCount) > 0 ? { frameCount: Number(artifact.frameCount) } : {}) }));
  const instrumentParts = (value.instrumentParts ?? []).map((part) => ({
    kind: ({ [AudioInstrumentPartKind.DRUMS]: 'DRUMS', [AudioInstrumentPartKind.BASS]: 'BASS', [AudioInstrumentPartKind.OTHER]: 'OTHER' } as Record<number, string>)[part.part],
    artifactId: part.artifactId }));
  const separation = validateNimiLocalAppAudioSeparation({
    vocalsArtifactId: value.vocalsArtifactId, backgroundArtifactId: value.backgroundArtifactId,
    ...(instrumentParts.length ? { instrumentParts } : {}) }, artifacts);
  return { ok: true, capabilityId: 'audio.separate', message: 'Audio separation returned committed vocals and background with instrument parts when produced.',
    output: { kind: 'audio-separation', jobId: result.job.jobId, jobStatus: 'completed', separation, artifactCount: artifacts.length, artifacts },
    trace: result.traceId ? { traceId: result.traceId } : undefined };
}
function failure(cause: unknown): RuntimeAudioSeparationResult {
  const error = asNimiError(cause, { reasonCode: ReasonCode.RUNTIME_CALL_FAILED, actionHint: 'inspect_runtime_audio_separation', source: 'runtime' });
  return { ok: false, capabilityId: 'audio.separate', reason: error.reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID' ? 'input-invalid' : runtimeScenarioJobNonSuccessReasonFromError(error), message: error.message, error };
}
