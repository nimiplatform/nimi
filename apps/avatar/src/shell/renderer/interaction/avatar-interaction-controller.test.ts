import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppOriginEvent } from '../driver/types.js';
import { createAvatarHitRegionSnapshot } from '@nimiplatform/kit/features/avatar/headless';
import { AvatarInteractionController } from './avatar-interaction-controller.js';

function createController(input: { tauri?: boolean; clickThroughRejectsOnce?: boolean } = {}) {
  let now = 1000;
  const emitted: AppOriginEvent[] = [];
  const clickThrough: boolean[] = [];
  let clickThroughRejectsOnce = input.clickThroughRejectsOnce === true;
  const pointerInside: boolean[] = [];
  const pointerContact: boolean[] = [];
  const constrainWindowToVisibleArea = vi.fn();
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
    constrainWindowToVisibleArea,
    nowMs: () => now,
    isTauriRuntime: () => input.tauri ?? false,
  });
  return {
    controller,
    emitted,
    clickThrough,
    pointerInside,
    pointerContact,
    constrainWindowToVisibleArea,
    tick(ms: number) {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AvatarInteractionController', () => {
  it('emits hover, click, double click, and right click only inside hit region', () => {
    const fixture = createController({ tauri: true });

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

  it('starts drag after threshold, throttles move, emits end, and applies edge constraints', () => {
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerMove({ clientX: 63, clientY: 180, button: 0, buttons: 1 });
    fixture.controller.pointerMove({ clientX: 66, clientY: 180, button: 0, buttons: 1 });
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
    expect(fixture.constrainWindowToVisibleArea).toHaveBeenCalledTimes(1);
  });

  it('emits long press after 1s stationary hold without creating a click', () => {
    vi.useFakeTimers();
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.tick(1000);
    vi.advanceTimersByTime(1000);
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
  });

  it('cancels long press timer when movement starts drag', () => {
    vi.useFakeTimers();
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerMove({ clientX: 66, clientY: 180, button: 0, buttons: 1 });
    fixture.tick(1000);
    vi.advanceTimersByTime(1000);
    fixture.controller.pointerUp({ clientX: 66, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual([
      'avatar.user.hover',
      'avatar.user.drag.start',
      'avatar.user.drag.move',
      'avatar.user.drag.end',
    ]);
    expect(fixture.emitted.some((event) => event.name === 'avatar.user.long_press')).toBe(false);
  });

  it('cancels pending drag without emitting drag end success', () => {
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerCancel();
    fixture.controller.pointerUp({ clientX: 92, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual(['avatar.user.hover']);
    expect(fixture.pointerContact.at(-1)).toBe(false);
    expect(fixture.constrainWindowToVisibleArea).not.toHaveBeenCalled();
  });

  it('confirms drag immediately on the Tauri host (unified manual drag, no system handoff)', () => {
    // Drag is unified to the kit standard manual drag primitive; the retired
    // system-level `start_dragging` handoff is gone. Drag start is confirmed
    // synchronously on every host, so the drag events emit without awaiting a
    // native drag session.
    const fixture = createController({ tauri: true });

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerMove({ clientX: 66, clientY: 180, button: 0, buttons: 1 });
    fixture.controller.pointerUp({ clientX: 66, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual([
      'avatar.user.hover',
      'avatar.user.drag.start',
      'avatar.user.drag.move',
      'avatar.user.drag.end',
    ]);
    expect(fixture.constrainWindowToVisibleArea).toHaveBeenCalledTimes(1);
  });

  it('restores cursor handling during teardown instead of leaving click-through active', () => {
    const fixture = createController({ tauri: true });

    fixture.controller.pointerMove({ clientX: 5, clientY: 180, button: 0 });
    fixture.controller.teardown();

    expect(fixture.clickThrough).toEqual([true, false]);
    expect(fixture.pointerInside.at(-1)).toBe(false);
    expect(fixture.pointerContact.at(-1)).toBe(false);
  });

  it('does not treat failed click-through IPC as applied', async () => {
    const fixture = createController({ tauri: true, clickThroughRejectsOnce: true });

    fixture.controller.pointerMove({ clientX: 5, clientY: 180, button: 0 });
    await Promise.resolve();
    fixture.controller.pointerMove({ clientX: 5, clientY: 180, button: 0 });
    await Promise.resolve();

    expect(fixture.clickThrough).toEqual([true, true]);
  });
});
