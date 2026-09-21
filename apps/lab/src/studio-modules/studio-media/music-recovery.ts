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
};
export type MusicRecoveryCapability = 'music.generate' | 'music.transcribe';
const paths = { 'music.generate': 'studio/music-recovery.json', 'music.transcribe': 'studio/music-transcription-recovery.json' };
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
      || Object.keys(item).some((key) => !['clientSubmissionId', 'createdAt', 'message', 'result', ...(capability === 'music.transcribe' ? ['sourceAudio'] : [])].includes(key))) throw new Error('Invalid saved music recovery entry');
    ids.add(item.clientSubmissionId);
    if (capability === 'music.transcribe') validateManagedArtifact(item.sourceAudio, 'transcription recovery source');
    if (item.result !== undefined) {
      validateStudioHistoryResult(item.result, 'music recovery');
      if (!item.result.ok || item.result.kind !== 'artifacts' || !(capability === 'music.transcribe' ? item.result.musicTranscription : item.result.musicGeneration) || typeof item.message !== 'string') throw new Error('Incomplete saved music result');
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

export async function beginMusicRecovery(storage: Storage, capability: MusicRecoveryCapability = 'music.generate', sourceAudio?: StudioManagedArtifact): Promise<string> {
  if (capability === 'music.transcribe') validateManagedArtifact(sourceAudio, 'transcription recovery source');
  const clientSubmissionId = crypto.randomUUID();
  await mutate(storage, (entries) => [...entries, { clientSubmissionId, createdAt: new Date().toISOString(), ...(sourceAudio ? { sourceAudio } : {}) }], capability);
  return clientSubmissionId;
}

export async function saveMusicRecoveryResult(storage: Storage, id: string, result: StudioCapabilityRunResult, capability: MusicRecoveryCapability = 'music.generate') {
  if (!result.ok) return;
  if (result.output.kind !== 'artifacts' || !(capability === 'music.transcribe' ? result.output.musicTranscription : result.output.musicGeneration)) throw new Error('Music recovery requires the complete adopted result');
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
