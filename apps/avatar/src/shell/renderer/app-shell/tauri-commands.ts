import { invokeAvatarHostCommand } from './avatar-host-bridge.js';

export type AvatarCursorClientPosition = {
  screenX: number;
  screenY: number;
  clientX: number;
  clientY: number;
  scaleFactor: number;
};

export async function startWindowDrag(): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_start_window_drag');
}

export type AvatarManualDragWindowOrigin = {
  x: number;
  y: number;
};

// macOS manual drag fallback. The renderer captures the native window origin
// once, then sends absolute targets derived from total pointer delta. This
// avoids a per-frame Rust `outer_position()` read during drag.
export async function beginManualDragWindow(): Promise<AvatarManualDragWindowOrigin | null> {
  return invokeAvatarHostCommand<AvatarManualDragWindowOrigin>('nimi_avatar_begin_manual_drag_window');
}

export async function moveManualDragWindow(input: {
  origin: AvatarManualDragWindowOrigin;
  totalDeltaX: number;
  totalDeltaY: number;
}): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_move_manual_drag_window', {
    originX: Math.round(input.origin.x),
    originY: Math.round(input.origin.y),
    totalDeltaX: Math.round(input.totalDeltaX),
    totalDeltaY: Math.round(input.totalDeltaY),
  });
}

export async function setWindowSize(width: number, height: number): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_set_window_size', { width: Math.round(width), height: Math.round(height) });
}

export async function setIgnoreCursorEvents(ignore: boolean): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_set_ignore_cursor_events', { ignore });
}

export async function getCursorClientPosition(): Promise<AvatarCursorClientPosition> {
  return invokeAvatarHostCommand<AvatarCursorClientPosition>('nimi_avatar_get_cursor_client_position');
}

export async function constrainWindowToVisibleArea(minVisibleRatio = 0.2): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_constrain_window_to_visible_area', { minVisibleRatio });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_set_always_on_top', { alwaysOnTop });
}

export async function hideAvatarWindow(): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_hide_window');
}

export async function closeAvatarWindow(): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_close_window');
}

export async function bindAvatarRuntimeIdentity(input: {
  avatarInstanceId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  launchSource?: string | null;
}): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_bind_runtime_identity', {
    payload: {
      avatarInstanceId: input.avatarInstanceId,
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      launchSource: input.launchSource || null,
    },
  });
}
