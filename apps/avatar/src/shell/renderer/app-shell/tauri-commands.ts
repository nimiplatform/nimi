import { invoke } from '@tauri-apps/api/core';

export async function startWindowDrag(): Promise<void> {
  await invoke('nimi_avatar_start_window_drag');
}

export async function setWindowSize(width: number, height: number): Promise<void> {
  await invoke('nimi_avatar_set_window_size', { width: Math.round(width), height: Math.round(height) });
}

export async function setIgnoreCursorEvents(ignore: boolean): Promise<void> {
  await invoke('nimi_avatar_set_ignore_cursor_events', { ignore });
}

export async function constrainWindowToVisibleArea(minVisibleRatio = 0.2): Promise<void> {
  await invoke('nimi_avatar_constrain_window_to_visible_area', { minVisibleRatio });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  await invoke('nimi_avatar_set_always_on_top', { alwaysOnTop });
}
