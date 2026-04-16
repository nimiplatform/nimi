import { invoke } from '@tauri-apps/api/core';

export function setAppSetting(key: string, value: string, now: string) {
  return invoke<void>('set_app_setting', { key, value, now });
}

export function getAppSetting(key: string) {
  return invoke<string | null>('get_app_setting', { key });
}

export function dbInit(subjectUserId?: string | null) {
  return invoke<void>('db_init', { subjectUserId: subjectUserId ?? null });
}
