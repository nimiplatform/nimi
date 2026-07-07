import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { invokeChecked } from './invoke.js';
import { assertRecord, isJsonObject } from './types.js';
import type { JsonObject } from './types.js';

/**
 * Window bounds patch (physical pixels, integers). At least one field must be
 * present. `x`/`y` drive a position update; `width`/`height` drive a size
 * update.
 */
export type FloatingWindowBounds = {
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
};

/**
 * `setIgnoreCursorEvents` options. `forward` is Electron-only (whether to keep
 * forwarding move events while ignoring). Tauri hosts ignore `forward`.
 */
export type FloatingWindowIgnoreCursorEventsOptions = {
  readonly forward?: boolean;
};

/**
 * `beginManualDrag` result. `mode` is a forward-compatible union: today both
 * hosts always return `'manual'` because the system-level `start_dragging`
 * path is unreliable for transparent always-on-top windows, but `'system'`
 * is reserved for a future platform that can drive an OS-level drag session.
 * When `mode === 'manual'` the host returns the window's current outer
 * position so the renderer can send total pointer deltas from a fixed origin.
 */
export type FloatingWindowManualDragOrigin = {
  readonly mode: 'system' | 'manual';
  readonly originX: number;
  readonly originY: number;
};

/**
 * `moveManualDrag` payload. Host sets the window position to
 * `(originX + totalDeltaX, originY + totalDeltaY)`.
 */
export type FloatingWindowMoveDelta = {
  readonly originX: number;
  readonly originY: number;
  readonly totalDeltaX: number;
  readonly totalDeltaY: number;
};

/**
 * `constrainToVisibleArea` result. `constrained` is `true` when the host
 * actually moved the window to keep the minimum visible ratio on-screen.
 */
export type FloatingWindowConstrainResult = {
  readonly constrained: boolean;
};

export async function floatingWindowSetBounds(bounds: FloatingWindowBounds): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.setBounds'];
  const payload = pickBoundsPayload(bounds, command);
  return invokeChecked(command, { payload }, (value) => parseEmptyResult(value, command));
}

export async function floatingWindowSetIgnoreCursorEvents(
  ignore: boolean,
  options?: FloatingWindowIgnoreCursorEventsOptions,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.setIgnoreCursorEvents'];
  const payload: JsonObject = { ignore };
  if (options?.forward !== undefined) {
    payload.forward = options.forward;
  }
  return invokeChecked(command, { payload }, (value) => parseEmptyResult(value, command));
}

export async function floatingWindowSetAlwaysOnTop(alwaysOnTop: boolean): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.setAlwaysOnTop'];
  return invokeChecked(command, { payload: { alwaysOnTop } }, (value) => parseEmptyResult(value, command));
}

export async function floatingWindowHide(): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.hide'];
  return invokeChecked(command, { payload: {} }, (value) => parseEmptyResult(value, command));
}

export async function floatingWindowClose(): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.close'];
  return invokeChecked(command, { payload: {} }, (value) => parseEmptyResult(value, command));
}

export async function floatingWindowBeginManualDrag(): Promise<FloatingWindowManualDragOrigin> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag'];
  return invokeChecked(command, { payload: {} }, (value) => parseManualDragOrigin(value, command));
}

export async function floatingWindowMoveManualDrag(delta: FloatingWindowMoveDelta): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.moveManualDrag'];
  const payload: JsonObject = {
    originX: assertInteger(delta.originX, 'originX', command),
    originY: assertInteger(delta.originY, 'originY', command),
    totalDeltaX: assertInteger(delta.totalDeltaX, 'totalDeltaX', command),
    totalDeltaY: assertInteger(delta.totalDeltaY, 'totalDeltaY', command),
  };
  return invokeChecked(command, { payload }, (value) => parseEmptyResult(value, command));
}

export async function floatingWindowConstrainToVisibleArea(
  minVisibleRatio: number,
): Promise<FloatingWindowConstrainResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['floating-window.constrainToVisibleArea'];
  if (!Number.isFinite(minVisibleRatio)) {
    throw new Error(`${command}: minVisibleRatio must be a finite number`);
  }
  return invokeChecked(
    command,
    { payload: { minVisibleRatio } },
    (value) => parseConstrainResult(value, command),
  );
}

function pickBoundsPayload(bounds: FloatingWindowBounds, command: string): JsonObject {
  const payload: JsonObject = {};
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const value = bounds[field];
    if (value !== undefined) {
      payload[field] = assertInteger(value, field, command);
    }
  }
  if (Object.keys(payload).length === 0) {
    throw new Error(`${command}: at least one of x, y, width, height is required`);
  }
  return payload;
}

function assertInteger(value: number, field: string, command: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${command}: ${field} must be an integer`);
  }
  return value;
}

function parseEmptyResult(value: unknown, command: string): JsonObject {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isJsonObject(value)) {
    throw new Error(`${command} returned invalid payload`);
  }
  return value;
}

function parseManualDragOrigin(value: unknown, command: string): FloatingWindowManualDragOrigin {
  const record = assertRecord(value, `${command} returned invalid payload`);
  const mode = String(record.mode || '').trim();
  if (mode !== 'manual' && mode !== 'system') {
    throw new Error(`${command}: mode must be 'manual' or 'system'`);
  }
  return {
    mode,
    originX: assertResultInteger(record.originX, 'originX', command),
    originY: assertResultInteger(record.originY, 'originY', command),
  };
}

function parseConstrainResult(value: unknown, command: string): FloatingWindowConstrainResult {
  const record = assertRecord(value, `${command} returned invalid payload`);
  if (typeof record.constrained !== 'boolean') {
    throw new Error(`${command}: constrained must be a boolean`);
  }
  return { constrained: record.constrained };
}

function assertResultInteger(value: unknown, field: string, command: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${command}: ${field} must be an integer`);
  }
  return value;
}
