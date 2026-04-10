import { invoke } from '@tauri-apps/api/core';

export interface SavedChildAvatar {
  path: string;
}

export function saveChildAvatar(params: {
  childId: string;
  mimeType: string;
  imageBase64: string;
}) {
  return invoke<SavedChildAvatar>('save_child_avatar', params);
}
