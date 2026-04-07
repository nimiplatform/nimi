import { invoke } from '@tauri-apps/api/core';

export interface SavedJournalPhoto {
  path: string;
}

export function saveJournalPhoto(params: {
  childId: string;
  entryId: string;
  index: number;
  mimeType: string;
  imageBase64: string;
}) {
  return invoke<SavedJournalPhoto>('save_journal_photo', params);
}

export function deleteJournalPhoto(path: string) {
  return invoke<void>('delete_journal_photo', { path });
}
