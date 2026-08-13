import type { AppOriginEvent } from '../driver/types.js';
import {
  hitTestAvatarRegion,
  type AvatarHitRegionSnapshot,
  type AvatarHitTestPoint,
  type AvatarHitTestResult,
} from '@nimiplatform/kit/features/avatar/headless';

export type AvatarPointerButton = 'left' | 'middle' | 'right';

export type AvatarInteractionControllerDeps = {
  getHitRegionSnapshot(): AvatarHitRegionSnapshot | null;
  emit(event: AppOriginEvent): void;
  setPointerInside(inside: boolean): void;
  setPointerContact(contact: boolean): void;
  setClickThrough(ignore: boolean): Promise<void> | void;
  constrainWindowToVisibleArea(): Promise<void> | void;
  nowMs(): number;
  isTauriRuntime(): boolean;
  setTimer?(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimer?(timer: ReturnType<typeof setTimeout>): void;
};

export type AvatarPointerEventLike = AvatarHitTestPoint & {
  button: number;
  buttons?: number;
  pointerId?: number;
};

type PendingDrag = {
  pointerId: number | null;
  startedAtMs: number;
  startClientX: number;
  startClientY: number;
  lastMoveEmittedAtMs: number;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  startHit: AvatarHitTestResult;
  dragging: boolean;
  dragStartConfirmed: boolean;
  dragStartFailed: boolean;
};

const DRAG_THRESHOLD_PX = 4;
const DRAG_MOVE_INTERVAL_MS = 33;
const LONG_PRESS_THRESHOLD_MS = 1000;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DISTANCE_PX = 8;

// @nimi-authority: rule.nimi.avatar.embodiment.r075
export class AvatarInteractionController {
  private pending: PendingDrag | null = null;
  private pointerInside = false;
  private lastClick: { atMs: number; clientX: number; clientY: number } | null = null;
  private clickThrough = false;
  private clickThroughInFlight: boolean | null = null;

  constructor(private readonly deps: AvatarInteractionControllerDeps) {}

  pointerMove(event: AvatarPointerEventLike): void {
    const hit = this.hitTest(event);
    this.updatePointerRegion(hit);

    if (!this.pending) return;
    if (this.pending.dragStartFailed) return;

    const nowMs = this.deps.nowMs();
    const dx = event.clientX - this.pending.startClientX;
    const dy = event.clientY - this.pending.startClientY;
    const distance = Math.hypot(dx, dy);

    if (!this.pending.dragging && distance >= DRAG_THRESHOLD_PX) {
      this.clearPendingLongPressTimer(this.pending);
      this.beginDrag(this.pending, event, hit);
      return;
    }

    if (this.pending.dragging && this.pending.dragStartConfirmed && nowMs - this.pending.lastMoveEmittedAtMs >= DRAG_MOVE_INTERVAL_MS) {
      this.pending.lastMoveEmittedAtMs = nowMs;
      this.emitDragEvent('avatar.user.drag.move', event, hit, {
        dx: Math.round(dx),
        dy: Math.round(dy),
      });
    }
  }

  pointerLeave(event: AvatarPointerEventLike): void {
    const hit = this.hitTest(event);
    if (this.pointerInside) {
      this.deps.emit({
        name: 'avatar.user.leave',
        detail: eventDetail(hit, 'left'),
      });
    }
    this.pointerInside = false;
    this.deps.setPointerInside(false);
    this.setClickThrough(true);
    if (!this.pending?.dragging) {
      this.deps.setPointerContact(false);
    }
  }

  pointerDown(event: AvatarPointerEventLike): void {
    const hit = this.hitTest(event);
    this.updatePointerRegion(hit);
    if (!hit.inside) {
      this.clearPendingLongPressTimer(this.pending);
      this.pending = null;
      this.deps.setPointerContact(false);
      this.setClickThrough(true);
      return;
    }

    const button = pointerButton(event.button);
    if (button === 'right') {
      this.deps.emit({
        name: 'avatar.user.right_click',
        detail: {
          ...eventDetail(hit, button),
          client_x: Math.round(event.clientX),
          client_y: Math.round(event.clientY),
        },
      });
      this.deps.setPointerContact(false);
      return;
    }

    if (button !== 'left') {
      return;
    }

    const pending: PendingDrag = {
      pointerId: event.pointerId ?? null,
      startedAtMs: this.deps.nowMs(),
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastMoveEmittedAtMs: 0,
      longPressTimer: null,
      startHit: hit,
      dragging: false,
      dragStartConfirmed: false,
      dragStartFailed: false,
    };
    this.pending = pending;
    pending.longPressTimer = this.setTimer(() => {
      this.fireLongPress(pending);
    }, LONG_PRESS_THRESHOLD_MS);
    this.deps.setPointerContact(true);
  }

  pointerUp(event: AvatarPointerEventLike): void {
    const pending = this.pending;
    this.pending = null;
    this.clearPendingLongPressTimer(pending);
    const hit = this.hitTest(event);
    this.updatePointerRegion(hit);
    this.deps.setPointerContact(false);

    if (!pending || pending.dragStartFailed) return;
    if (pending.dragging) {
      if (pending.dragStartConfirmed) {
        this.emitDragEvent('avatar.user.drag.end', event, hit, {
          dx: Math.round(event.clientX - pending.startClientX),
          dy: Math.round(event.clientY - pending.startClientY),
        });
        void this.deps.constrainWindowToVisibleArea();
      }
      return;
    }

    if (!hit.inside) return;
    const nowMs = this.deps.nowMs();
    const doubleClick = this.lastClick
      && nowMs - this.lastClick.atMs <= DOUBLE_CLICK_MS
      && Math.hypot(event.clientX - this.lastClick.clientX, event.clientY - this.lastClick.clientY) <= DOUBLE_CLICK_DISTANCE_PX;
    this.lastClick = { atMs: nowMs, clientX: event.clientX, clientY: event.clientY };
    this.deps.emit({
      name: doubleClick ? 'avatar.user.double_click' : 'avatar.user.click',
      detail: eventDetail(hit, 'left'),
    });
  }

  pointerCancel(): void {
    this.clearPendingLongPressTimer(this.pending);
    this.pending = null;
    this.deps.setPointerContact(false);
  }

  teardown(): void {
    this.clearPendingLongPressTimer(this.pending);
    this.pending = null;
    this.pointerInside = false;
    this.deps.setPointerInside(false);
    this.deps.setPointerContact(false);
    this.setClickThrough(false);
  }

  private hitTest(point: AvatarHitTestPoint): AvatarHitTestResult {
    return hitTestAvatarRegion(this.deps.getHitRegionSnapshot(), point, this.deps.nowMs());
  }

  private updatePointerRegion(hit: AvatarHitTestResult): void {
    if (hit.inside && !this.pointerInside) {
      this.deps.emit({
        name: 'avatar.user.hover',
        detail: eventDetail(hit, 'left'),
      });
    }
    if (!hit.inside && this.pointerInside) {
      this.deps.emit({
        name: 'avatar.user.leave',
        detail: eventDetail(hit, 'left'),
      });
    }
    this.pointerInside = hit.inside;
    this.deps.setPointerInside(hit.inside);
    this.setClickThrough(!hit.inside);
  }

  private beginDrag(pending: PendingDrag, event: AvatarPointerEventLike, hit: AvatarHitTestResult): void {
    // Drag is unified to manual (kit standard `floatingWindow.beginManualDrag`
    // always reports `mode: 'manual'`); the retired system-level
    // `start_dragging` path is gone. Actual window movement is owned by the
    // embodiment-stage manual-drag pointer path; the controller only emits the
    // `avatar.user.drag.*` semantic events (30Hz move cadence + physics
    // feedback consumers). The drag start is therefore confirmed immediately
    // on every host.
    pending.dragging = true;
    pending.lastMoveEmittedAtMs = this.deps.nowMs();
    pending.dragStartConfirmed = true;
    this.deps.setPointerContact(false);
    this.emitDragEvent('avatar.user.drag.start', event, pending.startHit, { dx: 0, dy: 0 });
    this.emitDragEvent('avatar.user.drag.move', event, hit, {
      dx: Math.round(event.clientX - pending.startClientX),
      dy: Math.round(event.clientY - pending.startClientY),
    });
  }

  private fireLongPress(pending: PendingDrag): void {
    if (this.pending !== pending || pending.dragging || pending.dragStartFailed) return;
    pending.longPressTimer = null;
    this.pending = null;
    this.deps.setPointerContact(false);
    this.deps.emit({
      name: 'avatar.user.long_press',
      detail: {
        ...eventDetail(pending.startHit, 'left'),
        client_x: Math.round(pending.startClientX),
        client_y: Math.round(pending.startClientY),
      },
    });
  }

  private setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return this.deps.setTimer
      ? this.deps.setTimer(callback, delayMs)
      : setTimeout(callback, delayMs);
  }

  private clearTimer(timer: ReturnType<typeof setTimeout>): void {
    if (this.deps.clearTimer) {
      this.deps.clearTimer(timer);
      return;
    }
    clearTimeout(timer);
  }

  private clearPendingLongPressTimer(pending: PendingDrag | null): void {
    if (!pending?.longPressTimer) return;
    this.clearTimer(pending.longPressTimer);
    pending.longPressTimer = null;
  }

  private emitDragEvent(name: string, event: AvatarPointerEventLike, hit: AvatarHitTestResult, delta: { dx: number; dy: number }): void {
    this.deps.emit({
      name,
      detail: {
        ...eventDetail(hit, 'left'),
        client_x: Math.round(event.clientX),
        client_y: Math.round(event.clientY),
        delta_x: delta.dx,
        delta_y: delta.dy,
      },
    });
  }

  private setClickThrough(ignore: boolean): void {
    if (!this.deps.isTauriRuntime()) return;
    if (this.clickThrough === ignore && this.clickThroughInFlight === null) return;
    this.clickThroughInFlight = ignore;
    void Promise.resolve(this.deps.setClickThrough(ignore))
      .then(() => {
        this.clickThrough = ignore;
      })
      .catch((error: unknown) => {
        if (this.clickThroughInFlight === ignore) this.clickThroughInFlight = null;
        console.warn(`[avatar:interaction] set click-through failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (this.clickThroughInFlight === ignore) this.clickThroughInFlight = null;
      });
  }
}

function eventDetail(hit: AvatarHitTestResult, button: AvatarPointerButton): Record<string, unknown> {
  return {
    region: hit.region,
    x: hit.localX,
    y: hit.localY,
    button,
  };
}

function pointerButton(button: number): AvatarPointerButton {
  if (button === 1) return 'middle';
  if (button === 2) return 'right';
  return 'left';
}
