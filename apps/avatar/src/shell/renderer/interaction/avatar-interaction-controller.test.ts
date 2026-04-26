import { describe, expect, it, vi } from 'vitest';
import type { AppOriginEvent } from '../driver/types.js';
import { createAvatarHitRegionSnapshot } from './avatar-hit-region.js';
import { AvatarInteractionController } from './avatar-interaction-controller.js';

function createController(input: { tauri?: boolean; dragRejects?: boolean } = {}) {
  let now = 1000;
  const emitted: AppOriginEvent[] = [];
  const clickThrough: boolean[] = [];
  const pointerInside: boolean[] = [];
  const pointerContact: boolean[] = [];
  const constrainWindowToVisibleArea = vi.fn();
  const startWindowDrag = input.dragRejects
    ? vi.fn(async () => {
      throw new Error('native drag failed');
    })
    : vi.fn(async () => {});
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
    setClickThrough: (ignore) => {
      clickThrough.push(ignore);
    },
    startWindowDrag,
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
    startWindowDrag,
    constrainWindowToVisibleArea,
    tick(ms: number) {
      now += ms;
    },
  };
}

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

  it('cancels pending drag without emitting drag end success', () => {
    const fixture = createController();

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerCancel();
    fixture.controller.pointerUp({ clientX: 92, clientY: 180, button: 0 });

    expect(fixture.emitted.map((event) => event.name)).toEqual(['avatar.user.hover']);
    expect(fixture.pointerContact.at(-1)).toBe(false);
    expect(fixture.constrainWindowToVisibleArea).not.toHaveBeenCalled();
  });

  it('does not emit drag success when native drag handoff rejects', async () => {
    const fixture = createController({ tauri: true, dragRejects: true });

    fixture.controller.pointerDown({ clientX: 60, clientY: 180, button: 0 });
    fixture.controller.pointerMove({ clientX: 66, clientY: 180, button: 0, buttons: 1 });
    await Promise.resolve();
    fixture.controller.pointerUp({ clientX: 66, clientY: 180, button: 0 });

    expect(fixture.startWindowDrag).toHaveBeenCalledTimes(1);
    expect(fixture.emitted.map((event) => event.name)).toEqual(['avatar.user.hover']);
    expect(fixture.constrainWindowToVisibleArea).not.toHaveBeenCalled();
  });

  it('restores cursor handling during teardown instead of leaving click-through active', () => {
    const fixture = createController({ tauri: true });

    fixture.controller.pointerMove({ clientX: 5, clientY: 180, button: 0 });
    fixture.controller.teardown();

    expect(fixture.clickThrough).toEqual([true, false]);
    expect(fixture.pointerInside.at(-1)).toBe(false);
    expect(fixture.pointerContact.at(-1)).toBe(false);
  });
});
