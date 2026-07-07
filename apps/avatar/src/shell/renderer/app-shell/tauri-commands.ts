import {
  floatingWindowBeginManualDrag,
  floatingWindowClose,
  floatingWindowConstrainToVisibleArea,
  floatingWindowHide,
  floatingWindowMoveManualDrag,
  floatingWindowSetAlwaysOnTop,
  floatingWindowSetBounds,
  floatingWindowSetIgnoreCursorEvents,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { invokeAvatarHostCommand } from './avatar-host-bridge.js';

export type AvatarCursorClientPosition = {
  screenX: number;
  screenY: number;
  clientX: number;
  clientY: number;
  scaleFactor: number;
};

// Window control is delegated to the kit standard floating-window bridge
// (`@nimiplatform/kit/shell/renderer/bridge`). It routes to the invoking
// window on both hosts: Tauri → `floating_window_*` commands; Electron →
// `standardShellHost.floatingWindow.*` hooks. The avatar-local export names
// and signatures are preserved so the drag / click-through / bounds-sync
// consumers stay stable; only the underlying primitive changed. The retired
// system-level `start_dragging` path is gone — drag is unified to manual.

// Manual drag origin. The renderer captures the native window origin once at
// drag start, then sends absolute targets derived from total pointer delta so
// the host does not read the current window position per frame.
export type AvatarManualDragWindowOrigin = {
  x: number;
  y: number;
};

// Unified manual drag start (kit standard). Returns the current window origin
// when the host reports `mode: 'manual'` (always true today for the
// transparent always-on-top avatar window); returns null otherwise so the
// renderer drag path can no-op. The avatar window never relies on a
// system-level drag session.
export async function beginManualDragWindow(): Promise<AvatarManualDragWindowOrigin | null> {
  const origin = await floatingWindowBeginManualDrag();
  if (origin.mode !== 'manual') return null;
  return { x: origin.originX, y: origin.originY };
}

export async function moveManualDragWindow(input: {
  origin: AvatarManualDragWindowOrigin;
  totalDeltaX: number;
  totalDeltaY: number;
}): Promise<void> {
  await floatingWindowMoveManualDrag({
    originX: Math.round(input.origin.x),
    originY: Math.round(input.origin.y),
    totalDeltaX: Math.round(input.totalDeltaX),
    totalDeltaY: Math.round(input.totalDeltaY),
  });
}

export async function setWindowSize(width: number, height: number): Promise<void> {
  await floatingWindowSetBounds({ width: Math.round(width), height: Math.round(height) });
}

export async function setIgnoreCursorEvents(ignore: boolean): Promise<void> {
  await floatingWindowSetIgnoreCursorEvents(ignore);
}

// Cursor hit-testing stays avatar app-local (tightly coupled to the
// alpha-mask click-through decision; not a kit floating-window primitive).
// It routes through the avatar product host bridge on both hosts.
export async function getCursorClientPosition(): Promise<AvatarCursorClientPosition> {
  return invokeAvatarHostCommand<AvatarCursorClientPosition>('nimi_avatar_get_cursor_client_position');
}

export async function constrainWindowToVisibleArea(minVisibleRatio = 0.2): Promise<void> {
  await floatingWindowConstrainToVisibleArea(minVisibleRatio);
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  await floatingWindowSetAlwaysOnTop(alwaysOnTop);
}

export async function hideAvatarWindow(): Promise<void> {
  await floatingWindowHide();
}

export async function closeAvatarWindow(): Promise<void> {
  await floatingWindowClose();
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
