import { createNimiAppRecordStore } from '@nimiplatform/kit/core/app-record-storage';
import { ScenarioType, VisionLocateGeometry } from '@nimiplatform/sdk/runtime/generated';
import { isJsonObject } from '@nimiplatform/sdk/types';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { createStudioRunHistoryResultSnapshot, restoreStudioCapabilityRunResult, type StudioRunHistoryResultSnapshot } from './history.js';
import { validateManagedArtifact, validateStudioHistoryResult, validateRunConfig, validateFaceSwapHistory } from './history-policy.js';
import type { StudioRunConfigSnapshot } from './history.js';
import { studioResultAssetPaths, studioResultAssetReferences, verifyStudioManagedAsset } from './managed-result-references.js';
import type { StudioAudioSeparationRequest, StudioCapabilityRunResult, StudioManagedArtifact } from './runtime-types.js';
import { isAudioSeparationRequest } from './audio-separation-request.js';

export type StudioJobRecoveryAssets = Pick<NimiLocalAppClient['storage']['assets'], 'list' | 'read' | 'write' | 'remove'>;

export type StudioJobRecoveryState = 'pending' | 'acknowledged' | 'completed' | 'rejected';

export type StudioJobRecoveryEntry = {
  readonly id: string;
  readonly state: StudioJobRecoveryState;
  readonly details?: StudioJobRecoveryDetails;
  readonly clientSubmissionId: string;
  readonly createdAt: string;
  readonly message?: string;
  readonly result?: StudioRunHistoryResultSnapshot;
  readonly sourceAudio?: StudioManagedArtifact;
  readonly targetAudio?: StudioManagedArtifact;
  readonly jobId?: string;
  readonly separationRequest?: StudioAudioSeparationRequest;
  readonly prompt?: string;
  readonly runConfig?: StudioRunConfigSnapshot;
};

export type StudioJobRecoveryCapability = (typeof STUDIO_JOB_RECOVERY_CAPABILITY_LIST)[number];

export type StudioJobRecoveryDetails = {
  readonly sourceImage?: StudioManagedArtifact;
  readonly scenarioType: import('@nimiplatform/sdk/runtime/generated').ScenarioType;
  readonly expectedVision?: { readonly imageArtifactId: string; readonly geometry: import('@nimiplatform/sdk/runtime/generated').VisionLocateGeometry };
  readonly creationSource?: 'reference-audio' | 'text-description';
  readonly timestamps?: boolean;
  readonly texts?: readonly string[];
  readonly faceSwap?: import('./runtime-types.js').StudioFaceSwap;
};

export const STUDIO_JOB_RECOVERY_PREFIX = 'studio/recovery/';

const STUDIO_JOB_RECOVERY_CAPABILITY_LIST = [
  'image.upscale',
  'video.upscale',
  'audio.speaker.embed',
  'image.generate',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice.create',
  'vision.locate',
  'text.annotate',
  'image.face_swap',
  'video.face_swap',
  'music.generate',
  'music.transcribe',
  'audio.voice.convert',
  'audio.separate',
] as const;

const STUDIO_JOB_RECOVERY_CAPABILITIES = new Set<string>(STUDIO_JOB_RECOVERY_CAPABILITY_LIST);
const MAX_RECOVERY_RECORD_BYTES = 240 * 1024;
const MAX_RECOVERY_ENTRIES_PER_CAPABILITY = 128;

export function studioJobRecoveryPrefix(capability: StudioJobRecoveryCapability): string {
  return `${STUDIO_JOB_RECOVERY_PREFIX}${capability}`;
}

export function studioJobRecoveryRecordPath(capability: StudioJobRecoveryCapability, id: string): string {
  return `${studioJobRecoveryPrefix(capability)}/${encodeURIComponent(id)}.json`;
}

function isStorageNotFoundError(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const error = cause as { reasonCode?: unknown; code?: unknown };
  const code = String(error.reasonCode ?? error.code ?? '').toLowerCase().replaceAll('-', '_');
  return code === 'not_found' || code === 'app_storage_entry_not_found' || code === 'app_asset_not_found';
}

function parseStudioJobRecoveryEntry(capability: StudioJobRecoveryCapability, item: unknown): StudioJobRecoveryEntry {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Invalid saved task recovery entry');
  }
  const record = item as Record<string, unknown>;
  const allowedKeys = [
    'id',
    'state',
    'clientSubmissionId',
    'createdAt',
    'message',
    'result',
    'prompt',
    'runConfig',
    'jobId',
    'details',
    ...(capability === 'music.generate' ? [] : ['sourceAudio']),
    ...(capability === 'audio.voice.convert' ? ['targetAudio'] : []),
    ...(capability === 'audio.separate' ? ['separationRequest'] : []),
  ];
  if (
    typeof record.clientSubmissionId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(record.clientSubmissionId)
    || record.id !== record.clientSubmissionId
    || !['pending', 'acknowledged', 'completed', 'rejected'].includes(String(record.state))
    || typeof record.createdAt !== 'string'
    || !Number.isFinite(Date.parse(record.createdAt))
    || Object.keys(record).some((key) => !allowedKeys.includes(key))
  ) {
    throw new Error('Invalid saved task recovery entry');
  }
  const state = record.state as StudioJobRecoveryState;
  if (record.details !== undefined) validateRecoveryDetails(record.details);
  if (record.prompt !== undefined && typeof record.prompt !== 'string') throw new Error('Invalid saved task prompt');
  if (record.runConfig !== undefined) {
    validateRunConfig(record.runConfig, 'task recovery request');
    if ((record.runConfig as StudioRunConfigSnapshot).target.capabilityId !== capability) {
      throw new Error('Task recovery request has a different capability');
    }
  }
  if (record.separationRequest !== undefined && !isAudioSeparationRequest(record.separationRequest)) {
    throw new Error('Invalid saved separation request');
  }
  if (
    record.jobId !== undefined
    && (typeof record.jobId !== 'string' || record.jobId.length < 1 || record.jobId.length > 256 || record.jobId !== record.jobId.trim())
  ) {
    throw new Error('Invalid saved task recovery entry');
  }
  if ((state === 'pending' || state === 'rejected') && (record.jobId !== undefined || record.result !== undefined)) {
    throw new Error('Invalid saved task recovery state');
  }
  if (state === 'acknowledged' && record.jobId === undefined) {
    throw new Error('Acknowledged task recovery entry is missing jobId');
  }
  if (['music.transcribe', 'audio.voice.convert', 'audio.separate'].includes(capability)) {
    validateManagedArtifact(record.sourceAudio, 'task recovery source');
  }
  if (capability === 'audio.voice.convert' && record.targetAudio !== undefined) {
    validateManagedArtifact(record.targetAudio, 'voice conversion recovery target');
  }
  if (record.result !== undefined) {
    validateStudioHistoryResult(record.result, 'task recovery');
    const result = record.result as StudioRunHistoryResultSnapshot;
    const complete = capability === 'music.transcribe' ? (result.ok && result.kind === 'artifacts' ? result.musicTranscription : undefined)
      : capability === 'audio.voice.convert' ? (result.ok && result.kind === 'artifacts' ? result.voiceConversion : undefined)
      : capability === 'audio.separate' ? (result.ok && result.kind === 'artifacts' ? result.audioSeparation : undefined)
      : capability === 'music.generate' ? (result.ok && result.kind === 'artifacts' ? result.musicGeneration : undefined)
      : true;
    if (!result.ok || !complete || typeof record.message !== 'string') {
      throw new Error('Incomplete saved task result');
    }
    const savedRequest = capability === 'audio.separate' && result.ok && result.kind === 'artifacts'
      ? result.audioSeparation?.request
      : undefined;
    const separationRequest = record.separationRequest as StudioAudioSeparationRequest | undefined;
    if (
      savedRequest
      && separationRequest
      && (
        savedRequest.kind !== separationRequest.kind
        || (savedRequest.kind === 'range' && separationRequest.kind === 'range'
          && (savedRequest.startSeconds !== separationRequest.startSeconds || savedRequest.endSeconds !== separationRequest.endSeconds))
      )
    ) {
      throw new Error('Saved separation request conflicts with its result');
    }
  } else if (state === 'completed') {
    throw new Error('Completed task recovery entry is missing result');
  }
  return record as unknown as StudioJobRecoveryEntry;
}

function recoveryStore(assets: StudioJobRecoveryAssets, capability: StudioJobRecoveryCapability) {
  return createNimiAppRecordStore<StudioJobRecoveryEntry>(
    assets,
    studioJobRecoveryPrefix(capability),
    (value) => parseStudioJobRecoveryEntry(capability, value),
  );
}

export async function readStudioJobRecovery(
  assets: StudioJobRecoveryAssets,
  capability: StudioJobRecoveryCapability = 'music.generate',
): Promise<readonly StudioJobRecoveryEntry[]> {
  const versions = await recoveryStore(assets, capability).listVersions();
  return versions
    .map((item) => item.record)
    .filter((entry) => entry.state !== 'rejected')
    .sort((left, right) => (
      Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.clientSubmissionId.localeCompare(right.clientSubmissionId)
    ));
}

export class StudioRecoveryWriteUnconfirmed extends Error {
  constructor(readonly submissionId: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

export async function beginStudioJobRecovery(
  assets: StudioJobRecoveryAssets,
  capability: StudioJobRecoveryCapability = 'music.generate',
  sourceAudio?: StudioManagedArtifact,
  targetAudio?: StudioManagedArtifact,
  separationRequest?: StudioAudioSeparationRequest,
  runConfig?: StudioRunConfigSnapshot,
  prompt?: string,
  details?: StudioJobRecoveryDetails,
): Promise<string> {
  if (['music.transcribe', 'audio.voice.convert', 'audio.separate'].includes(capability)) {
    validateManagedArtifact(sourceAudio, 'task recovery source');
  }
  if (targetAudio !== undefined) validateManagedArtifact(targetAudio, 'voice conversion recovery target');
  if (separationRequest !== undefined && (capability !== 'audio.separate' || !isAudioSeparationRequest(separationRequest))) {
    throw new Error('Invalid separation request');
  }
  if (details) validateRecoveryDetails(details);
  const clientSubmissionId = crypto.randomUUID();
  const entry: StudioJobRecoveryEntry = {
    id: clientSubmissionId,
    state: 'pending',
    clientSubmissionId,
    createdAt: new Date().toISOString(),
    ...(sourceAudio ? { sourceAudio } : {}),
    ...(targetAudio ? { targetAudio } : {}),
    ...(separationRequest ? { separationRequest } : {}),
    ...(runConfig ? { runConfig } : {}),
    ...(prompt === undefined ? {} : { prompt }),
    ...(details ? { details } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(entry)).byteLength > MAX_RECOVERY_RECORD_BYTES) {
    throw new Error('Task recovery storage is full; explicitly remove completed recovery entries after verifying their saved history.');
  }
  const existing = await readStudioJobRecovery(assets, capability);
  if (existing.length >= MAX_RECOVERY_ENTRIES_PER_CAPABILITY) {
    throw new Error('Task recovery storage is full; explicitly remove completed recovery entries after verifying their saved history.');
  }
  try {
    await recoveryStore(assets, capability).write(entry, null);
  } catch (cause) {
    // The file may already own its inputs when the write receipt is lost.
    throw new StudioRecoveryWriteUnconfirmed(clientSubmissionId, cause);
  }
  return clientSubmissionId;
}

export async function captureStudioJobRecoveryJobId(
  assets: StudioJobRecoveryAssets,
  id: string,
  jobId: string,
  capability: StudioJobRecoveryCapability = 'music.generate',
) {
  if (!jobId || jobId.length > 256 || jobId !== jobId.trim()) {
    throw new Error('Invalid task recovery job identity');
  }
  const store = recoveryStore(assets, capability);
  const current = await store.readVersion(id);
  if (!current || current.record.state === 'rejected') {
    throw new Error('Saved action was already rejected or removed');
  }
  if (current.record.jobId && current.record.jobId !== jobId) {
    throw new Error('Saved action has a different Job identity');
  }
  if (current.record.jobId === jobId && (current.record.state === 'acknowledged' || current.record.state === 'completed')) {
    return;
  }
  const next: StudioJobRecoveryEntry = {
    ...current.record,
    jobId,
    state: current.record.state === 'completed' ? 'completed' : 'acknowledged',
  };
  await store.write(next, current.sha256);
}

export async function saveStudioJobRecoveryResult(
  assets: StudioJobRecoveryAssets,
  id: string,
  result: StudioCapabilityRunResult,
  capability: StudioJobRecoveryCapability = 'music.generate',
) {
  if (result.capabilityId !== capability) throw new Error('Saved result belongs to a different capability');
  if (!result.ok) {
    if (result.terminalJobFailure && result.jobId) {
      const current = await recoveryStore(assets, capability).readVersion(id);
      if (current?.record.state === 'acknowledged' && current.record.jobId === result.jobId) {
        await forgetStudioJobRecovery(assets, id, capability);
      }
    }
    return;
  }
  if (['music.generate', 'music.transcribe', 'audio.voice.convert', 'audio.separate'].includes(capability) && result.output.kind !== 'artifacts') {
    throw new Error('Recovery requires the complete adopted result');
  }
  const media = result.output.kind === 'artifacts' ? result.output : undefined;
  const complete = capability === 'music.transcribe' ? media?.musicTranscription
    : capability === 'audio.voice.convert' ? media?.voiceConversion
    : capability === 'audio.separate' ? media?.audioSeparation
    : capability === 'music.generate' ? media?.musicGeneration
    : true;
  if (!complete) throw new Error('Task recovery requires the complete adopted result');
  const snapshot = createStudioRunHistoryResultSnapshot(result);
  const store = recoveryStore(assets, capability);
  const current = await store.readVersion(id);
  if (
    !current
    || current.record.state === 'rejected'
    || !('jobId' in result.output)
    || (current.record.jobId && current.record.jobId !== result.output.jobId)
  ) {
    throw new Error('Saved result does not belong to the recorded action');
  }
  const next: StudioJobRecoveryEntry = {
    ...current.record,
    jobId: current.record.jobId ?? result.output.jobId,
    state: 'completed',
    message: result.message,
    result: snapshot,
  };
  if (new TextEncoder().encode(JSON.stringify(next)).byteLength > MAX_RECOVERY_RECORD_BYTES) {
    throw new Error('Task recovery storage is full; explicitly remove completed recovery entries after verifying their saved history.');
  }
  await store.write(next, current.sha256);
}

export async function forgetStudioJobRecovery(
  assets: StudioJobRecoveryAssets,
  id: string,
  capability: StudioJobRecoveryCapability = 'music.generate',
) {
  try {
    await assets.remove(studioJobRecoveryRecordPath(capability, id));
  } catch (cause) {
    if (!isStorageNotFoundError(cause)) throw cause;
  }
}

export type ForgetPendingRecoveryResult =
  | { readonly removed: true; readonly entry: StudioJobRecoveryEntry }
  | { readonly removed: false; readonly reason: 'read-unconfirmed' | 'missing' | 'already-acknowledged' | 'cas-conflict' | 'remove-unconfirmed' };

/**
 * Two-phase atomic cleanup for a definite pre-admission rejection:
 * 1. Read current record + sha256 and require state === 'pending' with no jobId/result.
 * 2. CAS-transition the record to state === 'rejected' with expectedSha256.
 *    If another observer already filled jobId, CAS fails and we leave the record intact.
 * 3. Only the CAS winner calls assets.remove(path), returning removed: true only when
 *    assets.remove confirms { removed: true }.
 */
export async function forgetPendingStudioJobRecoveryIfUnacknowledged(
  assets: StudioJobRecoveryAssets,
  capability: StudioJobRecoveryCapability,
  id: string,
): Promise<ForgetPendingRecoveryResult> {
  const store = recoveryStore(assets, capability);
  let current;
  try {
    current = await store.readVersion(id);
  } catch {
    return { removed: false, reason: 'read-unconfirmed' };
  }
  if (!current) return { removed: false, reason: 'missing' };
  if (current.record.state !== 'pending' || current.record.jobId || current.record.result) {
    return { removed: false, reason: 'already-acknowledged' };
  }
  try {
    await store.write({ ...current.record, state: 'rejected' }, current.sha256);
  } catch {
    return { removed: false, reason: 'cas-conflict' };
  }
  try {
    const deletion = await assets.remove(studioJobRecoveryRecordPath(capability, id));
    if (deletion?.removed === true) {
      return { removed: true, entry: current.record };
    }
    return { removed: false, reason: 'remove-unconfirmed' };
  } catch {
    return { removed: false, reason: 'remove-unconfirmed' };
  }
}

function normalizedReasonCode(cause: unknown): string {
  if (!cause || typeof cause !== 'object' || !('reasonCode' in cause)) return '';
  const raw = (cause as { reasonCode?: unknown }).reasonCode;
  if (typeof raw !== 'string') return '';
  return raw.trim().replaceAll('-', '_').toUpperCase();
}

/**
 * Narrow D1 pre-admission rejection classifier:
 * - AI_LOCAL_ASSET_SLOT_MISSING is guaranteed pre-Job-persistence in Runtime.
 * - AI_MEDIA_OPTION_UNSUPPORTED on vision.locate is guaranteed pre-Job-persistence
 *   (local_vision_execution.go:70).
 * Explicitly excludes PROTOCOL_ENVELOPE_INVALID / invalid-payload, timeouts,
 * aborts, network errors, and post-acknowledgement local persistence failures.
 */
export function isDefiniteStudioPreAdmissionRejection(
  capability: StudioJobRecoveryCapability,
  cause: unknown,
): boolean {
  const reasonCode = normalizedReasonCode(cause);
  if (reasonCode === 'AI_LOCAL_ASSET_SLOT_MISSING') return true;
  if (capability === 'vision.locate' && reasonCode === 'AI_MEDIA_OPTION_UNSUPPORTED') return true;
  return false;
}

// Some validation codes also occur after a Job was issued. On the submit
// boundary, resolve the exact idempotency key before discarding its record.
export async function reconcileStudioSubmitRejection(
  client: { readonly ai: Pick<NimiLocalAppClient['ai'], 'scenarioJobs'>; readonly storage: { readonly assets: StudioJobRecoveryAssets } },
  capability: StudioJobRecoveryCapability,
  id: string,
  cause: unknown,
) {
  const assets = client.storage.assets;
  if (isDefiniteStudioPreAdmissionRejection(capability, cause)) {
    await cleanupRejectedStudioRecoveryEntry(assets, capability, id);
    return;
  }
  const reason = normalizedReasonCode(cause);
  if (!['AI_MEDIA_OPTION_UNSUPPORTED', 'AI_VOICE_INPUT_INVALID', 'AI_VOICE_TARGET_MODEL_MISMATCH',
    'AI_VOICE_ASSET_NOT_FOUND', 'AI_VOICE_ASSET_EXPIRED', 'AI_ROUTE_UNSUPPORTED', 'AI_INPUT_INVALID',
    'AI_INPUT_LIMIT_EXCEEDED', 'AI_MEDIA_SPEC_INVALID', 'AI_LOCAL_EXECUTION_LOAD_FAILED'].includes(reason)) return;
  let found;
  try {
    found = await client.ai.scenarioJobs.lookupSubmission(id);
  } catch (lookupError) {
    if (normalizedReasonCode(lookupError) === 'AI_MEDIA_JOB_NOT_FOUND') await cleanupRejectedStudioRecoveryEntry(assets, capability, id);
    return;
  }
  await captureStudioJobRecoveryJobId(assets, id, found.job.jobId, capability);
}

export function isDefiniteUninvokedRunnerRejection(cause: unknown): boolean {
  return normalizedReasonCode(cause) === 'SDK_LOCAL_APP_INPUT_INVALID';
}

export async function cleanupRejectedStudioRecoveryEntry(
  assets: StudioJobRecoveryAssets,
  capability: StudioJobRecoveryCapability,
  id: string,
): Promise<ForgetPendingRecoveryResult> {
  const outcome = await forgetPendingStudioJobRecoveryIfUnacknowledged(assets, capability, id);
  if (!outcome.removed) return outcome;
  const ownedInputPaths = [
    ...new Set([
      ...(outcome.entry.sourceAudio ? [outcome.entry.sourceAudio.relativePath] : []),
      ...(outcome.entry.targetAudio ? [outcome.entry.targetAudio.relativePath] : []),
      ...(outcome.entry.details?.sourceImage ? [outcome.entry.details.sourceImage.relativePath] : []),
    ]),
  ];
  for (const relativePath of ownedInputPaths) {
    await assets.remove(relativePath).catch(() => undefined);
  }
  return outcome;
}

export async function restoreSavedStudioJobResult(
  entry: StudioJobRecoveryEntry,
  label: string,
  capability: StudioJobRecoveryCapability,
  assets: Pick<NimiLocalAppClient['storage']['assets'], 'read'>,
  signal?: AbortSignal,
): Promise<StudioCapabilityRunResult | null> {
  if (!entry.result) return null;
  await verifySavedStudioJobAssets(entry, assets, signal);
  signal?.throwIfAborted();
  const result = restoreStudioCapabilityRunResult({ capabilityId: capability, result: entry.result, message: entry.message ?? '' }, () => label);
  if (capability === 'audio.separate' && entry.separationRequest && result?.ok && result.output.kind === 'artifacts' && result.output.audioSeparation) {
    return {
      ...result,
      output: {
        ...result.output,
        audioSeparation: { ...result.output.audioSeparation, request: entry.separationRequest },
      },
    };
  }
  return result;
}

export async function verifySavedStudioJobAssets(
  entry: StudioJobRecoveryEntry,
  assets: Pick<NimiLocalAppClient['storage']['assets'], 'read'>,
  signal?: AbortSignal,
): Promise<void> {
  if (!entry.result) return;
  const refs = studioResultAssetReferences(entry.result);
  for (const path of studioResultAssetPaths(entry.result)) {
    const references = refs.filter((ref) => ref.relativePath === path);
    const expected: { relativePath: string; sha256?: string; sizeBytes?: number; mediaType?: string } = { relativePath: path };
    for (const ref of references) {
      for (const key of ['sha256', 'sizeBytes', 'mediaType'] as const) {
        const value = ref[key];
        if (value === undefined) continue;
        if ((key === 'sizeBytes' ? typeof value !== 'number' : typeof value !== 'string') || (expected[key] !== undefined && expected[key] !== value)) {
          throw new Error('Saved asset roles disagree');
        }
        Object.assign(expected, { [key]: value });
      }
    }
    await verifyStudioManagedAsset(assets, expected, signal);
  }
}

export function createRecordedStudioScenarioJobSession(
  context: import('./runtime.js').StudioCapabilityRuntimeContext,
  clientSubmissionId: string,
  capability: StudioJobRecoveryCapability,
) {
  const api = context.host.client.ai;
  const assets = context.host.client.storage.assets;
  let submitInvoked = false;
  const client = context.host.createScenarioJobClient({
    ...api,
    scenarioJobs: {
      ...api.scenarioJobs,
      async submit(spec, options) {
        context.input.observationSignal?.throwIfAborted();
        context.input.signal?.throwIfAborted();
        const current = await recoveryStore(assets, capability).readVersion(clientSubmissionId);
        if (!current || current.record.state !== 'pending' || current.record.jobId) {
          throw new Error('The recorded action is missing or already submitted');
        }
        context.input.observationSignal?.throwIfAborted();
        context.input.signal?.throwIfAborted();
        submitInvoked = true;
        let response;
        try {
          response = await api.scenarioJobs.submit(spec, { ...options, clientSubmissionId });
        } catch (cause) {
          await reconcileStudioSubmitRejection(context.host.client, capability, clientSubmissionId, cause);
          throw cause;
        }
        // Post-acknowledgement local persistence failure must never remove the recovery record.
        await captureStudioJobRecoveryJobId(assets, clientSubmissionId, response.job.jobId, capability);
        return response;
      },
    },
  });
  return {
    client,
    wasSubmitInvoked: () => submitInvoked,
  };
}

/** Submit only after beginStudioJobRecovery has durably recorded this action. */
export function recordedStudioScenarioJobClient(
  context: import('./runtime.js').StudioCapabilityRuntimeContext,
  clientSubmissionId: string,
  capability: StudioJobRecoveryCapability,
) {
  return createRecordedStudioScenarioJobSession(context, clientSubmissionId, capability).client;
}

export async function recoverStudioJobId(
  client: { readonly ai: Pick<NimiLocalAppClient['ai'], 'scenarioJobs'>; readonly storage: { readonly assets: StudioJobRecoveryAssets } },
  entry: StudioJobRecoveryEntry,
  capability: StudioJobRecoveryCapability,
): Promise<string> {
  const response = entry.jobId
    ? await client.ai.scenarioJobs.get(entry.jobId)
    : await client.ai.scenarioJobs.lookupSubmission(entry.clientSubmissionId);
  await captureStudioJobRecoveryJobId(client.storage.assets, entry.clientSubmissionId, response.job.jobId, capability);
  return response.job.jobId;
}

export function isStudioJobRecoveryCapability(value: string): value is StudioJobRecoveryCapability {
  return STUDIO_JOB_RECOVERY_CAPABILITIES.has(value);
}

function validateRecoveryDetails(value: unknown): asserts value is StudioJobRecoveryDetails {
  const fail = () => { throw new Error('Saved task inputs are invalid'); };
  if (
    !isJsonObject(value)
    || Object.keys(value).some((key) => !['scenarioType', 'sourceImage', 'expectedVision', 'creationSource', 'timestamps', 'texts', 'faceSwap'].includes(key))
    || typeof value.scenarioType !== 'number'
    || value.scenarioType <= 0
    || !Object.values(ScenarioType).includes(value.scenarioType)
  ) return fail();
  if (value.expectedVision !== undefined || value.sourceImage !== undefined) {
    if (
      value.scenarioType !== ScenarioType.VISION_LOCATE
      || !isJsonObject(value.expectedVision)
      || Object.keys(value.expectedVision).some((key) => !['imageArtifactId', 'geometry'].includes(key))
      || typeof value.expectedVision.imageArtifactId !== 'string'
      || !value.expectedVision.imageArtifactId.trim()
      || ![VisionLocateGeometry.BOX, VisionLocateGeometry.POINT].includes(Number(value.expectedVision.geometry))
    ) return fail();
    validateManagedArtifact(value.sourceImage, 'saved Locate image');
  }
  if (value.creationSource !== undefined && (value.scenarioType !== ScenarioType.VOICE_CREATE || !['reference-audio', 'text-description'].includes(String(value.creationSource)))) return fail();
  if (value.timestamps !== undefined && (value.scenarioType !== ScenarioType.SPEECH_TRANSCRIBE || typeof value.timestamps !== 'boolean')) return fail();
  if (value.texts !== undefined && (value.scenarioType !== ScenarioType.TEXT_ANNOTATE || !Array.isArray(value.texts) || !value.texts.length || value.texts.length > 64 || value.texts.some((text) => typeof text !== 'string'))) return fail();
  if (value.faceSwap !== undefined) {
    if (![ScenarioType.IMAGE_FACE_SWAP, ScenarioType.VIDEO_FACE_SWAP].includes(value.scenarioType)) return fail();
    validateFaceSwapHistory(value.faceSwap, 'saved face replacement');
  }
}

export const studioJobRecoveryCapabilities = Object.freeze([...STUDIO_JOB_RECOVERY_CAPABILITY_LIST]);

/** Local result work stops for either view disposal or the current user action. */
export function studioJobRecoverySignal(input: { readonly signal?: AbortSignal; readonly observationSignal?: AbortSignal }): AbortSignal {
  return AbortSignal.any([input.signal, input.observationSignal].filter((value): value is AbortSignal => Boolean(value)));
}
