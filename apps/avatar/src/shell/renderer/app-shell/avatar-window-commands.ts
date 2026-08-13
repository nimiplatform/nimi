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

// Avatar window control uses the shared floating-window bridge on every
// supported host. Cursor hit testing remains Avatar-owned because it is
// coupled to the renderer's alpha-mask click-through decision.
export type AvatarManualDragWindowOrigin = {
  x: number;
  y: number;
};

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
