import { invoke } from '@tauri-apps/api/core';

export async function startWindowDrag(): Promise<void> {
  await invoke('nimi_avatar_start_window_drag');
}

// Wave 4 manual drag fallback. macOS NSWindow with transparent +
// always_on_top + decorations(false) does not consistently honor the OS
// `start_dragging()` flow; we fall back to feeding pointer screen-coord
// deltas to Rust which adjusts the window's outer position frame-by-frame.
export async function dragWindowBy(deltaX: number, deltaY: number): Promise<void> {
  await invoke('nimi_avatar_drag_window_by', {
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY),
  });
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
