import { invoke } from '@tauri-apps/api/core';

export interface SavedJournalVoiceAudio {
  path: string;
}

export function saveJournalVoiceAudio(params: {
  childId: string;
  entryId: string;
  mimeType: string;
  audioBase64: string;
}) {
  return invoke<SavedJournalVoiceAudio>('save_journal_voice_audio', params);
}

export function deleteJournalVoiceAudio(path: string) {
  return invoke<void>('delete_journal_voice_audio', { path });
}
