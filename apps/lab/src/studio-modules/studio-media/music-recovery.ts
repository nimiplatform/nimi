import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { JsonValue } from '@nimiplatform/sdk/types';
import { createStudioRunHistoryResultSnapshot, restoreStudioCapabilityRunResult, type StudioRunHistoryResultSnapshot } from '../../ai-studio-core/history.js';
import { validateManagedArtifact, validateStudioHistoryResult } from '../../ai-studio-core/history-policy.js';
import type { StudioCapabilityRunResult, StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';

type Storage = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;
export type MusicRecoveryEntry = {
  readonly clientSubmissionId: string;
  readonly createdAt: string;
  readonly message?: string;
  readonly result?: StudioRunHistoryResultSnapshot;
  readonly sourceAudio?: StudioManagedArtifact;
  readonly targetAudio?: StudioManagedArtifact;
  readonly jobId?: string;
};
export type MusicRecoveryCapability = 'music.generate' | 'music.transcribe' | 'audio.voice.convert' | 'audio.separate';
const paths = { 'music.generate': 'studio/music-recovery.json', 'music.transcribe': 'studio/music-transcription-recovery.json', 'audio.voice.convert': 'studio/voice-convert-recovery.json', 'audio.separate': 'studio/audio-separation-recovery.json' };
let mutationTail: Promise<unknown> = Promise.resolve();

export async function readMusicRecovery(storage: Storage, capability: MusicRecoveryCapability = 'music.generate'): Promise<readonly MusicRecoveryEntry[]> {
  let value: unknown;
  try { value = (await storage.readJson(paths[capability])).value; }
  catch (cause) {
    const error = cause as { reasonCode?: string; code?: string };
    const code = String(error?.reasonCode ?? error?.code ?? '').toLowerCase().replaceAll('-', '_');
    if (code === 'not_found' || code === 'app_storage_entry_not_found') return [];
    throw cause;
  }
  if (!Array.isArray(value) || value.length > 32) throw new Error('Invalid saved music recovery entries');
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.clientSubmissionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.clientSubmissionId)
      || ids.has(item.clientSubmissionId) || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
      || Object.keys(item).some((key) => !['clientSubmissionId', 'createdAt', 'message', 'result',
        ...(capability === 'music.generate' ? [] : ['sourceAudio']),
        ...(capability === 'audio.voice.convert' ? ['targetAudio'] : []),
        ...(capability === 'audio.separate' ? ['jobId'] : [])].includes(key))) throw new Error('Invalid saved music recovery entry');
    ids.add(item.clientSubmissionId);
    if (capability === 'audio.separate' && item.jobId !== undefined
      && (typeof item.jobId !== 'string' || item.jobId.length < 1 || item.jobId.length > 256 || item.jobId !== item.jobId.trim())) throw new Error('Invalid saved music recovery entry');
    if (capability !== 'music.generate') validateManagedArtifact(item.sourceAudio, 'music recovery source');
    if (capability === 'audio.voice.convert' && item.targetAudio !== undefined) validateManagedArtifact(item.targetAudio, 'voice conversion recovery target');
    if (item.result !== undefined) {
      validateStudioHistoryResult(item.result, 'music recovery');
      const complete = capability === 'music.transcribe' ? item.result.musicTranscription
        : capability === 'audio.voice.convert' ? item.result.voiceConversion
        : capability === 'audio.separate' ? item.result.audioSeparation : item.result.musicGeneration;
      if (!item.result.ok || item.result.kind !== 'artifacts' || !complete || typeof item.message !== 'string') throw new Error('Incomplete saved music result');
    }
  }
  return value as MusicRecoveryEntry[];
}

async function mutate(storage: Storage, update: (entries: readonly MusicRecoveryEntry[]) => MusicRecoveryEntry[], capability: MusicRecoveryCapability) {
  const next = mutationTail.then(async () => {
    const entries = update(await readMusicRecovery(storage, capability));
    while (entries.length > 32 || new TextEncoder().encode(JSON.stringify(entries)).length > 240 * 1024) {
      const obsolete = entries.findIndex((entry) => entry.result !== undefined);
      if (obsolete < 0) throw new Error('Music recovery storage is full; review unfinished actions first.');
      entries.splice(obsolete, 1);
    }
    await storage.writeJson(paths[capability], JSON.parse(JSON.stringify(entries)) as JsonValue);
  });
  mutationTail = next.catch(() => undefined);
  await next;
}

export async function beginMusicRecovery(storage: Storage, capability: MusicRecoveryCapability = 'music.generate', sourceAudio?: StudioManagedArtifact, targetAudio?: StudioManagedArtifact): Promise<string> {
  if (capability !== 'music.generate') validateManagedArtifact(sourceAudio, 'music recovery source');
  if (targetAudio !== undefined) validateManagedArtifact(targetAudio, 'voice conversion recovery target');
  const clientSubmissionId = crypto.randomUUID();
  await mutate(storage, (entries) => [...entries, { clientSubmissionId, createdAt: new Date().toISOString(), ...(sourceAudio ? { sourceAudio } : {}), ...(targetAudio ? { targetAudio } : {}) }], capability);
  return clientSubmissionId;
}

export async function captureMusicRecoveryJobId(storage: Storage, id: string, jobId: string, capability: MusicRecoveryCapability = 'music.generate') {
  if (!jobId || jobId.length > 256 || jobId !== jobId.trim()) throw new Error('Invalid music recovery job identity');
  await mutate(storage, (entries) => entries.map((entry) => (
    entry.clientSubmissionId === id && !entry.jobId ? { ...entry, jobId } : entry
  )), capability);
}

export async function saveMusicRecoveryResult(storage: Storage, id: string, result: StudioCapabilityRunResult, capability: MusicRecoveryCapability = 'music.generate') {
  if (!result.ok) return;
  if (result.output.kind !== 'artifacts') throw new Error('Music recovery requires the complete adopted result');
  const complete = capability === 'music.transcribe' ? result.output.musicTranscription
    : capability === 'audio.voice.convert' ? result.output.voiceConversion
    : capability === 'audio.separate' ? result.output.audioSeparation : result.output.musicGeneration;
  if (!complete) throw new Error('Music recovery requires the complete adopted result');
  const snapshot = createStudioRunHistoryResultSnapshot(result);
  await mutate(storage, (entries) => {
    if (!entries.some((entry) => entry.clientSubmissionId === id)) throw new Error('Music author action is no longer recorded');
    return entries.map((entry) => entry.clientSubmissionId === id ? { ...entry, message: result.message, result: snapshot } : entry);
  }, capability);
}

export async function forgetMusicRecovery(storage: Storage, id: string, capability: MusicRecoveryCapability = 'music.generate') {
  await mutate(storage, (entries) => entries.filter((entry) => entry.clientSubmissionId !== id), capability);
}

export function restoreSavedMusicResult(entry: MusicRecoveryEntry, label: string, capability: MusicRecoveryCapability = 'music.generate'): StudioCapabilityRunResult | null {
  if (!entry.result) return null;
  return restoreStudioCapabilityRunResult({ capabilityId: capability, result: entry.result, message: entry.message ?? '' }, () => label);
}
