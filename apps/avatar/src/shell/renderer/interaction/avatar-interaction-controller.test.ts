import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppOriginEvent } from '../driver/types.js';
import { createAvatarHitRegionSnapshot } from '@nimiplatform/kit/features/avatar/headless';
import {
  AVATAR_DRAG_THRESHOLD_PX,
  AvatarInteractionController,
  LONG_PRESS_THRESHOLD_MS,
  type AvatarLongPressFeedbackState,
} from './avatar-interaction-controller.js';

function createController(input: { hostRuntime?: boolean; clickThroughRejectsOnce?: boolean } = {}) {
  let now = 1000;
  const emitted: AppOriginEvent[] = [];
  const clickThrough: boolean[] = [];
  let clickThroughRejectsOnce = input.clickThroughRejectsOnce === true;
  const pointerInside: boolean[] = [];
  const pointerContact: boolean[] = [];
  const longPressFeedback: AvatarLongPressFeedbackState[] = [];
  const controller = new AvatarInteractionController({
    getHitRegionSnapshot: () => createAvatarHitRegionSnapshot({
      body: { x: 10, y: 20, width: 100, height: 200, region: 'body' },
      capturedAtMs: now,
    }),
    emit: (event) => {
      emitted.push(event);
    },
    setPointerInside: (inside) => {
      pointerInside.push(inside);
    },
    setPointerContact: (contact) => {
      pointerContact.push(contact);
    },
    setClickThrough: async (ignore) => {
      clickThrough.push(ignore);
      if (clickThroughRejectsOnce) {
        clickThroughRejectsOnce = false;
        throw new Error('native click-through failed');
      }
    },
    onLongPressFeedbackChange: (state) => {
      longPressFeedback.push(state);
    },
    nowMs: () => now,
    hasHostRuntime: () => input.hostRuntime ?? false,
  });
  return {
    controller,
    emitted,
    clickThrough,
    pointerInside,
    pointerContact,
    longPressFeedback,
    tick(ms: number) {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AvatarInteractionController', () => {
  it('uses 8px drag threshold and 480ms long-press threshold', () => {
    expect(AVATAR_DRAG_THRESHOLD_PX).toBe(8);
    expect(LONG_PRESS_THRESHOLD_MS).toBe(480);
  });

  it('emits hover, click, double click, and right click only inside hit region', () => {
    const fixture = createController({ hostRuntime: true });

    fixture.controller.pointerMove({ clientX: 60, clientY: 70, button: 0 });
    fixture.controller.pointerDown({ clientX: 60, clientY: 70, button: 0 });
    fixture.controller.pointerUp({ clientX: 60, clientY: 70, button: 0 });
    fixture.tick(100);
    fixture.controller.pointerDown({ clientX: 62, clientY: 72, button: 0 });
    fixture.controller.pointerUp({ clientX: 62, clientY: 72, button: 0 });
    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 2 });
    fixture.controller.pointerDown({ clientX: 5, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual([
      'avatar.user.hover',
      'avatar.user.click',
      'avatar.user.double_click',
      'avatar.user.right_click',
      'avatar.user.leave',
    ]);
    expect(fixture.emitted[1]?.detail).toMatchObject({ region: 'face', x: 50, y: 50, button: 'left' });
    expect(fixture.emitted[3]?.detail).toMatchObject({ region: 'body', button: 'right' });
    expect(fixture.clickThrough.at(-1)).toBe(true);
  });

  it('starts drag after 8px threshold (ignoring sub-threshold jitter), throttles move, and emits end', () => {
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerMove({ clientX: 63, clientY: 180, button: 0, buttons: 1 });
    fixture.controller.pointerMove({ clientX: 67, clientY: 180, button: 0, buttons: 1 });
    expect(fixture.emitted.some((event) => event.name === 'avatar.user.drag.start')).toBe(false);
    expect(fixture.longPressFeedback.at(-1)).toEqual({
      active: true,
      clientX: 60,
      clientY: 180,
      durationMs: 480,
    });

    fixture.controller.pointerMove({ clientX: 68, clientY: 180, button: 0, buttons: 1 });
    expect(fixture.longPressFeedback.at(-1)).toEqual({ active: false });

    fixture.tick(20);
    fixture.controller.pointerMove({ clientX: 80, clientY: 180, button: 0, buttons: 1 });
    fixture.tick(40);
    fixture.controller.pointerMove({ clientX: 92, clientY: 180, button: 0, buttons: 1 });
    fixture.controller.pointerUp({ clientX: 92, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual([
      'avatar.user.hover',
      'avatar.user.drag.start',
      'avatar.user.drag.move',
      'avatar.user.drag.move',
      'avatar.user.drag.end',
    ]);
    expect(fixture.emitted.at(-1)?.detail).toMatchObject({ delta_x: 32, delta_y: 0 });
  });

  it('fails closed at the drag threshold when precision did not approve drag and cancels hold feedback', () => {
    const fixture = createController();
    fixture.controller.pointerDown(
      { clientX: 60, clientY: 180, button: 0 },
      { dragAllowed: false },
    );
    fixture.controller.pointerMove({ clientX: 70, clientY: 180, button: 0, buttons: 1 });
    expect(fixture.longPressFeedback.at(-1)).toEqual({ active: false });
    fixture.controller.pointerUp({ clientX: 70, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual(['avatar.user.hover']);
  });

  it('emits long press after 480ms stationary hold without creating a click and clears hold feedback', () => {
    vi.useFakeTimers();
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    expect(fixture.longPressFeedback).toEqual([
      { active: true, clientX: 60, clientY: 180, durationMs: 480 },
    ]);

    fixture.tick(479);
    vi.advanceTimersByTime(479);
    expect(fixture.emitted.some((event) => event.name === 'avatar.user.long_press')).toBe(false);
    expect(fixture.longPressFeedback.at(-1)).toEqual({
      active: true,
      clientX: 60,
      clientY: 180,
      durationMs: 480,
    });

    fixture.tick(1);
    vi.advanceTimersByTime(1);
    fixture.controller.pointerUp({ clientX: 60, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual([
      'avatar.user.hover',
      'avatar.user.long_press',
    ]);
    expect(fixture.emitted.at(-1)?.detail).toMatchObject({
      region: 'body',
      button: 'left',
      client_x: 60,
      client_y: 180,
    });
    expect(fixture.longPressFeedback).toEqual([
      { active: true, clientX: 60, clientY: 180, durationMs: 480 },
      { active: false },
    ]);
  });

  it('cancels long press timer and hold feedback when movement reaches drag threshold', () => {
    vi.useFakeTimers();
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerMove({ clientX: 68, clientY: 180, button: 0, buttons: 1 });
    expect(fixture.longPressFeedback.at(-1)).toEqual({ active: false });

    fixture.tick(480);
    vi.advanceTimersByTime(480);
    fixture.controller.pointerUp({ clientX: 68, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual([
      'avatar.user.hover',
      'avatar.user.drag.start',
      'avatar.user.drag.move',
      'avatar.user.drag.end',
    ]);
    expect(fixture.emitted.some((event) => event.name === 'avatar.user.long_press')).toBe(false);
  });

  it('cancels pending drag and hold feedback without emitting drag end success', () => {
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    expect(fixture.longPressFeedback.at(-1)).toEqual({
      active: true,
      clientX: 60,
      clientY: 180,
      durationMs: 480,
    });
    fixture.controller.pointerCancel();
    expect(fixture.longPressFeedback.at(-1)).toEqual({ active: false });
    fixture.controller.pointerUp({ clientX: 92, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual(['avatar.user.hover']);
    expect(fixture.pointerContact.at(-1)).toBe(false);
  });

  it('confirms drag immediately on the Desktop Host (unified manual drag, no system handoff)', () => {
    // Drag is unified to the kit standard manual drag primitive; the retired
    // system-level `start_dragging` handoff is gone. Drag start is confirmed
    // synchronously on every host, so the drag events emit without awaiting a
    // native drag session.
    const fixture = createController({ hostRuntime: true });

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerMove({ clientX: 68, clientY: 180, button: 0, buttons: 1 });
    fixture.controller.pointerUp({ clientX: 68, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual([
      'avatar.user.hover',
      'avatar.user.drag.start',
      'avatar.user.drag.move',
      'avatar.user.drag.end',
    ]);
  });

  it('restores cursor handling and clears hold feedback during teardown', () => {
    const fixture = createController({ hostRuntime: true });

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    expect(fixture.longPressFeedback.at(-1)).toMatchObject({ active: true });
    fixture.controller.pointerMove({ clientX: 5, clientY: 180, button: 0 });
    fixture.controller.teardown();

    expect(fixture.clickThrough).toContain(true);
    expect(fixture.clickThrough.at(-1)).toBe(false);
    expect(fixture.pointerInside.at(-1)).toBe(false);
    expect(fixture.pointerContact.at(-1)).toBe(false);
    expect(fixture.longPressFeedback.at(-1)).toEqual({ active: false });
  });

  it('does not treat failed click-through IPC as applied', async () => {
    const fixture = createController({ hostRuntime: true, clickThroughRejectsOnce: true });

    fixture.controller.pointerMove({ clientX: 5, clientY: 180, button: 0 });
    await Promise.resolve();
    fixture.controller.pointerMove({ clientX: 5, clientY: 180, button: 0 });
    await Promise.resolve();

    expect(fixture.clickThrough).toEqual([true, true]);
  });
});
