import type { AppOriginEvent } from '../driver/types.js';
import {
  hitTestAvatarRegion,
  type AvatarHitRegionSnapshot,
  type AvatarHitTestPoint,
  type AvatarHitTestResult,
} from './avatar-hit-region.js';

export type AvatarPointerButton = 'left' | 'middle' | 'right';

export type AvatarInteractionControllerDeps = {
  getHitRegionSnapshot(): AvatarHitRegionSnapshot | null;
  emit(event: AppOriginEvent): void;
  setPointerInside(inside: boolean): void;
  setPointerContact(contact: boolean): void;
  setClickThrough(ignore: boolean): Promise<void> | void;
  startWindowDrag(): Promise<void> | void;
  constrainWindowToVisibleArea(): Promise<void> | void;
  nowMs(): number;
  isTauriRuntime(): boolean;
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
  startHit: AvatarHitTestResult;
  dragging: boolean;
  dragStartConfirmed: boolean;
  dragStartFailed: boolean;
};

const DRAG_THRESHOLD_PX = 4;
const DRAG_HOLD_THRESHOLD_MS = 200;
const DRAG_MOVE_INTERVAL_MS = 33;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DISTANCE_PX = 8;

export class AvatarInteractionController {
  private pending: PendingDrag | null = null;
  private pointerInside = false;
  private lastClick: { atMs: number; clientX: number; clientY: number } | null = null;
  private clickThrough = false;

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
    const heldMs = nowMs - this.pending.startedAtMs;

    if (!this.pending.dragging && (distance >= DRAG_THRESHOLD_PX || heldMs >= DRAG_HOLD_THRESHOLD_MS)) {
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
      this.pending = null;
      this.deps.setPointerContact(false);
      this.setClickThrough(true);
      return;
    }

    const button = pointerButton(event.button);
    if (button === 'right') {
      this.deps.emit({
        name: 'avatar.user.right_click',
        detail: eventDetail(hit, button),
      });
      this.deps.setPointerContact(false);
      return;
    }

    if (button !== 'left') {
      return;
    }

    this.pending = {
      pointerId: event.pointerId ?? null,
      startedAtMs: this.deps.nowMs(),
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastMoveEmittedAtMs: 0,
      startHit: hit,
      dragging: false,
      dragStartConfirmed: false,
      dragStartFailed: false,
    };
    this.deps.setPointerContact(true);
  }

  pointerUp(event: AvatarPointerEventLike): void {
    const pending = this.pending;
    this.pending = null;
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
    this.pending = null;
    this.deps.setPointerContact(false);
  }

  teardown(): void {
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
    pending.dragging = true;
    pending.lastMoveEmittedAtMs = this.deps.nowMs();
    if (!this.deps.isTauriRuntime()) {
      pending.dragStartConfirmed = true;
      this.deps.setPointerContact(false);
      this.emitDragEvent('avatar.user.drag.start', event, pending.startHit, { dx: 0, dy: 0 });
      this.emitDragEvent('avatar.user.drag.move', event, hit, {
        dx: Math.round(event.clientX - pending.startClientX),
        dy: Math.round(event.clientY - pending.startClientY),
      });
      return;
    }
    void Promise.resolve(this.deps.startWindowDrag()).then(() => {
      if (this.pending !== pending || pending.dragStartFailed) return;
      pending.dragStartConfirmed = true;
      this.deps.setPointerContact(false);
      this.emitDragEvent('avatar.user.drag.start', event, pending.startHit, { dx: 0, dy: 0 });
      this.emitDragEvent('avatar.user.drag.move', event, hit, {
        dx: Math.round(event.clientX - pending.startClientX),
        dy: Math.round(event.clientY - pending.startClientY),
      });
    }).catch(() => {
      pending.dragStartFailed = true;
      pending.dragging = false;
      this.deps.setPointerContact(false);
    });
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
    if (!this.deps.isTauriRuntime() || this.clickThrough === ignore) return;
    this.clickThrough = ignore;
    void Promise.resolve(this.deps.setClickThrough(ignore)).catch(() => {});
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
