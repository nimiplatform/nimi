import { ScenarioType, VisionLocateGeometry } from '@nimiplatform/sdk/runtime/generated';
import { isJsonObject } from '@nimiplatform/sdk/types';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { JsonValue } from '@nimiplatform/sdk/types';
import { createStudioRunHistoryResultSnapshot, restoreStudioCapabilityRunResult, type StudioRunHistoryResultSnapshot } from './history.js';
import { validateManagedArtifact, validateStudioHistoryResult, validateRunConfig, validateFaceSwapHistory } from './history-policy.js';
import type { StudioRunConfigSnapshot } from './history.js';
import { studioResultAssetPaths, studioResultAssetReferences, verifyStudioManagedAsset } from './managed-result-references.js';
import type { StudioAudioSeparationRequest, StudioCapabilityRunResult, StudioManagedArtifact } from './runtime-types.js';
import { isAudioSeparationRequest } from './audio-separation-request.js';

type Storage = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;
export type StudioJobRecoveryEntry = {
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
export type StudioJobRecoveryCapability = keyof typeof paths;
export type StudioJobRecoveryDetails = {
  readonly sourceImage?: StudioManagedArtifact;
  readonly scenarioType: import('@nimiplatform/sdk/runtime/generated').ScenarioType;
  readonly expectedVision?: { readonly imageArtifactId: string; readonly geometry: import('@nimiplatform/sdk/runtime/generated').VisionLocateGeometry };
  readonly creationSource?: 'reference-audio' | 'text-description';
  readonly timestamps?: boolean;
  readonly texts?: readonly string[];
  readonly faceSwap?: import('./runtime-types.js').StudioFaceSwap;
};
const paths = { 'image.generate': 'studio/image-recovery.json', 'video.generate': 'studio/video-recovery.json', 'audio.synthesize': 'studio/speech-recovery.json', 'audio.transcribe': 'studio/transcript-recovery.json', 'voice.create': 'studio/voice-recovery.json', 'vision.locate': 'studio/locate-recovery.json', 'text.annotate': 'studio/annotation-recovery.json', 'image.face_swap': 'studio/image-face-recovery.json', 'video.face_swap': 'studio/video-face-recovery.json', 'music.generate': 'studio/music-recovery.json', 'music.transcribe': 'studio/music-transcription-recovery.json', 'audio.voice.convert': 'studio/voice-convert-recovery.json', 'audio.separate': 'studio/audio-separation-recovery.json' };
let mutationTail: Promise<unknown> = Promise.resolve();

export async function readStudioJobRecovery(storage: Storage, capability: StudioJobRecoveryCapability = 'music.generate'): Promise<readonly StudioJobRecoveryEntry[]> {
  let value: unknown;
  try { value = (await storage.readJson(paths[capability])).value; }
  catch (cause) {
    const error = cause as { reasonCode?: string; code?: string };
    const code = String(error?.reasonCode ?? error?.code ?? '').toLowerCase().replaceAll('-', '_');
    if (code === 'not_found' || code === 'app_storage_entry_not_found') return [];
    throw cause;
  }
  if (!Array.isArray(value)) throw new Error('Invalid saved task recovery entries');
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.clientSubmissionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.clientSubmissionId)
      || ids.has(item.clientSubmissionId) || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
      || Object.keys(item).some((key) => !['clientSubmissionId', 'createdAt', 'message', 'result', 'prompt', 'runConfig', 'jobId', 'details',
        ...(capability === 'music.generate' ? [] : ['sourceAudio']),
        ...(capability === 'audio.voice.convert' ? ['targetAudio'] : []),
        ...(capability === 'audio.separate' ? ['separationRequest'] : [])].includes(key))) throw new Error('Invalid saved task recovery entry');
    ids.add(item.clientSubmissionId);
    if (item.details !== undefined) validateRecoveryDetails(item.details);
    if (item.prompt !== undefined && typeof item.prompt !== 'string') throw new Error('Invalid saved task prompt');
    if (item.runConfig !== undefined) {
      validateRunConfig(item.runConfig, 'task recovery request');
      if (item.runConfig.target.capabilityId !== capability) throw new Error('Task recovery request has a different capability');
    }
    if (item.separationRequest !== undefined && !isAudioSeparationRequest(item.separationRequest)) throw new Error('Invalid saved separation request');
    if (item.jobId !== undefined
      && (typeof item.jobId !== 'string' || item.jobId.length < 1 || item.jobId.length > 256 || item.jobId !== item.jobId.trim())) throw new Error('Invalid saved task recovery entry');
    if (['music.transcribe', 'audio.voice.convert', 'audio.separate'].includes(capability)) validateManagedArtifact(item.sourceAudio, 'task recovery source');
    if (capability === 'audio.voice.convert' && item.targetAudio !== undefined) validateManagedArtifact(item.targetAudio, 'voice conversion recovery target');
    if (item.result !== undefined) {
      validateStudioHistoryResult(item.result, 'task recovery');
      const complete = capability === 'music.transcribe' ? item.result.musicTranscription
        : capability === 'audio.voice.convert' ? item.result.voiceConversion
        : capability === 'audio.separate' ? item.result.audioSeparation : capability === 'music.generate' ? item.result.musicGeneration : true;
      if (!item.result.ok || !complete || typeof item.message !== 'string') throw new Error('Incomplete saved task result');
      const savedRequest = capability === 'audio.separate' ? item.result.audioSeparation?.request : undefined;
      if (savedRequest && item.separationRequest && (savedRequest.kind !== item.separationRequest.kind
        || savedRequest.startSeconds !== item.separationRequest.startSeconds
        || savedRequest.endSeconds !== item.separationRequest.endSeconds)) throw new Error('Saved separation request conflicts with its result');
    }
  }
  return value as StudioJobRecoveryEntry[];
}

async function mutate(storage: Storage, update: (entries: readonly StudioJobRecoveryEntry[]) => StudioJobRecoveryEntry[], capability: StudioJobRecoveryCapability) {
  const next = mutationTail.then(async () => {
    const entries = update(await readStudioJobRecovery(storage, capability));
    // This is bounded recovery storage, not business-history retention. Never
    // discard an unindexed result to make room for a newer author action.
    if (new TextEncoder().encode(JSON.stringify(entries)).length > 240 * 1024) {
      throw new Error('Task recovery storage is full; explicitly remove completed recovery entries after verifying their saved history.');
    }
    await storage.writeJson(paths[capability], JSON.parse(JSON.stringify(entries)) as JsonValue);
  });
  mutationTail = next.catch(() => undefined);
  await next;
}

export async function beginStudioJobRecovery(storage: Storage, capability: StudioJobRecoveryCapability = 'music.generate', sourceAudio?: StudioManagedArtifact, targetAudio?: StudioManagedArtifact, separationRequest?: StudioAudioSeparationRequest, runConfig?: StudioRunConfigSnapshot, prompt?: string, details?: StudioJobRecoveryDetails): Promise<string> {
  if (['music.transcribe', 'audio.voice.convert', 'audio.separate'].includes(capability)) validateManagedArtifact(sourceAudio, 'task recovery source');
  if (targetAudio !== undefined) validateManagedArtifact(targetAudio, 'voice conversion recovery target');
  if (separationRequest !== undefined && (capability !== 'audio.separate' || !isAudioSeparationRequest(separationRequest))) throw new Error('Invalid separation request');
  if (details) validateRecoveryDetails(details);
  const clientSubmissionId = crypto.randomUUID();
  await mutate(storage, (entries) => [...entries, { clientSubmissionId, createdAt: new Date().toISOString(), ...(sourceAudio ? { sourceAudio } : {}), ...(targetAudio ? { targetAudio } : {}), ...(separationRequest ? { separationRequest } : {}), ...(runConfig ? { runConfig } : {}), ...(prompt === undefined ? {} : { prompt }), ...(details ? { details } : {}) }], capability);
  return clientSubmissionId;
}

export async function captureStudioJobRecoveryJobId(storage: Storage, id: string, jobId: string, capability: StudioJobRecoveryCapability = 'music.generate') {
  if (!jobId || jobId.length > 256 || jobId !== jobId.trim()) throw new Error('Invalid task recovery job identity');
  await mutate(storage, (entries) => {
    const current = entries.find(entry => entry.clientSubmissionId === id);
    if (!current || (current.jobId && current.jobId !== jobId)) throw new Error('Saved action has a different Job identity');
    return entries.map(entry => entry.clientSubmissionId === id ? { ...entry, jobId } : entry);
  }, capability);
}

export async function saveStudioJobRecoveryResult(storage: Storage, id: string, result: StudioCapabilityRunResult, capability: StudioJobRecoveryCapability = 'music.generate') {
  if (!result.ok) return;
  if (result.capabilityId !== capability) throw new Error('Saved result belongs to a different capability');
  if (['music.generate', 'music.transcribe', 'audio.voice.convert', 'audio.separate'].includes(capability) && result.output.kind !== 'artifacts') throw new Error('Recovery requires the complete adopted result');
  const media = result.output.kind === 'artifacts' ? result.output : undefined;
  const complete = capability === 'music.transcribe' ? media?.musicTranscription
    : capability === 'audio.voice.convert' ? media?.voiceConversion
    : capability === 'audio.separate' ? media?.audioSeparation : capability === 'music.generate' ? media?.musicGeneration : true;
  if (!complete) throw new Error('Task recovery requires the complete adopted result');
  const snapshot = createStudioRunHistoryResultSnapshot(result);
  await mutate(storage, (entries) => {
    const entry = entries.find(item => item.clientSubmissionId === id);
    if (!entry || !('jobId' in result.output) || (entry.jobId && entry.jobId !== result.output.jobId)) throw new Error('Saved result does not belong to the recorded action');
    return entries.map((entry) => entry.clientSubmissionId === id ? { ...entry, message: result.message, result: snapshot } : entry);
  }, capability);
}

export async function forgetStudioJobRecovery(storage: Storage, id: string, capability: StudioJobRecoveryCapability = 'music.generate') {
  await mutate(storage, (entries) => entries.filter((entry) => entry.clientSubmissionId !== id), capability);
}

export async function restoreSavedStudioJobResult(entry: StudioJobRecoveryEntry, label: string, capability: StudioJobRecoveryCapability,
  assets: Pick<NimiLocalAppClient['storage']['assets'], 'read'>, signal?: AbortSignal): Promise<StudioCapabilityRunResult | null> {
  if (!entry.result) return null;
  await verifySavedStudioJobAssets(entry, assets, signal);
  signal?.throwIfAborted();
  const result = restoreStudioCapabilityRunResult({ capabilityId: capability, result: entry.result, message: entry.message ?? '' }, () => label);
  if (capability === 'audio.separate' && entry.separationRequest && result?.ok && result.output.kind === 'artifacts' && result.output.audioSeparation) {
    return { ...result, output: { ...result.output,
      audioSeparation: { ...result.output.audioSeparation, request: entry.separationRequest } } };
  }
  return result;
}

export async function verifySavedStudioJobAssets(entry: StudioJobRecoveryEntry,
  assets: Pick<NimiLocalAppClient['storage']['assets'], 'read'>, signal?: AbortSignal): Promise<void> {
  if (!entry.result) return;
  const refs = studioResultAssetReferences(entry.result);
  for (const path of studioResultAssetPaths(entry.result)) {
    const references = refs.filter(ref => ref.relativePath === path);
    const expected: { relativePath: string; sha256?: string; sizeBytes?: number; mediaType?: string } = { relativePath: path };
    for (const ref of references) {
      for (const key of ['sha256', 'sizeBytes', 'mediaType'] as const) {
        const value = ref[key];
        if (value === undefined) continue;
        if ((key === 'sizeBytes' ? typeof value !== 'number' : typeof value !== 'string') || (expected[key] !== undefined && expected[key] !== value)) throw new Error('Saved asset roles disagree');
        Object.assign(expected, { [key]: value });
      }
    }
    await verifyStudioManagedAsset(assets, expected, signal);
  }
}

/** Submit only after beginStudioJobRecovery has durably recorded this action. */
export function recordedStudioScenarioJobClient(context: import('./runtime.js').StudioCapabilityRuntimeContext,
  clientSubmissionId: string, capability: StudioJobRecoveryCapability) {
  const api = context.host.client.ai;
  return context.host.createScenarioJobClient({ ...api, scenarioJobs: { ...api.scenarioJobs,
    async submit(spec, options) {
      context.input.observationSignal?.throwIfAborted();
      context.input.signal?.throwIfAborted();
      const entry = (await readStudioJobRecovery(context.host.client.storage, capability)).find(item => item.clientSubmissionId === clientSubmissionId);
      if (!entry || entry.jobId) throw new Error('The recorded action is missing or already submitted');
      context.input.observationSignal?.throwIfAborted();
      context.input.signal?.throwIfAborted();
      const response = await api.scenarioJobs.submit(spec, { ...options, clientSubmissionId });
      await captureStudioJobRecoveryJobId(context.host.client.storage, clientSubmissionId, response.job.jobId, capability);
      return response;
    },
  } });
}

export async function recoverStudioJobId(client: NimiLocalAppClient, entry: StudioJobRecoveryEntry, capability: StudioJobRecoveryCapability): Promise<string> {
  const response = entry.jobId ? await client.ai.scenarioJobs.get(entry.jobId) : await client.ai.scenarioJobs.lookupSubmission(entry.clientSubmissionId);
  await captureStudioJobRecoveryJobId(client.storage, entry.clientSubmissionId, response.job.jobId, capability);
  return response.job.jobId;
}

export function isStudioJobRecoveryCapability(value: string): value is StudioJobRecoveryCapability {
  return Object.hasOwn(paths, value);
}

function validateRecoveryDetails(value: unknown): asserts value is StudioJobRecoveryDetails {
  const fail = () => { throw new Error('Saved task inputs are invalid'); };
  if (!isJsonObject(value) || Object.keys(value).some(key => !['scenarioType', 'sourceImage', 'expectedVision', 'creationSource', 'timestamps', 'texts', 'faceSwap'].includes(key))
    || typeof value.scenarioType !== 'number' || value.scenarioType <= 0 || !Object.values(ScenarioType).includes(value.scenarioType)) return fail();
  if (value.expectedVision !== undefined || value.sourceImage !== undefined) {
    if (value.scenarioType !== ScenarioType.VISION_LOCATE || !isJsonObject(value.expectedVision)
      || Object.keys(value.expectedVision).some(key => !['imageArtifactId', 'geometry'].includes(key))
      || typeof value.expectedVision.imageArtifactId !== 'string' || !value.expectedVision.imageArtifactId.trim()
      || ![VisionLocateGeometry.BOX, VisionLocateGeometry.POINT].includes(Number(value.expectedVision.geometry))) return fail();
    validateManagedArtifact(value.sourceImage, 'saved Locate image');
  }
  if (value.creationSource !== undefined && (value.scenarioType !== ScenarioType.VOICE_CREATE || !['reference-audio', 'text-description'].includes(String(value.creationSource)))) return fail();
  if (value.timestamps !== undefined && (value.scenarioType !== ScenarioType.SPEECH_TRANSCRIBE || typeof value.timestamps !== 'boolean')) return fail();
  if (value.texts !== undefined && (value.scenarioType !== ScenarioType.TEXT_ANNOTATE || !Array.isArray(value.texts) || !value.texts.length || value.texts.length > 64 || value.texts.some(text => typeof text !== 'string'))) return fail();
  if (value.faceSwap !== undefined) {
    if (![ScenarioType.IMAGE_FACE_SWAP, ScenarioType.VIDEO_FACE_SWAP].includes(value.scenarioType)) return fail();
    validateFaceSwapHistory(value.faceSwap, 'saved face replacement');
  }
}

export const studioJobRecoveryCapabilities = Object.freeze(Object.keys(paths) as StudioJobRecoveryCapability[]);

/** Local result work stops for either view disposal or the current user action. */
export function studioJobRecoverySignal(input: { readonly signal?: AbortSignal; readonly observationSignal?: AbortSignal }): AbortSignal {
  return AbortSignal.any([input.signal, input.observationSignal].filter((value): value is AbortSignal => Boolean(value)));
}
