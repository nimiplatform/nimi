import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { useDepthNavigation } from '../../src/shell/chrome/depth-workspace.tsx';

function pointerEvent(
  window: Window,
  type: string,
  init: MouseEventInit & { readonly pointerId: number },
): Event {
  const event = new window.MouseEvent(type, init);
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  return event;
}

test('focused depth window follows x/y pointer movement and keeps its final position', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1400 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 1000 });

  function Harness() {
    const navigation = useDepthNavigation({
      ids: ['modules', 'worlds'],
      activeId: 'modules',
      onActiveChange: () => {},
    });
    const position = navigation.positions.modules ?? { x: 0, y: 0 };
    const size = navigation.sizes.modules;

    return (
      <section
        className="depth-window"
        data-position={`${position.x},${position.y}`}
        data-size={size ? `${size.width},${size.height}` : undefined}
        data-dragging={navigation.isDragging || undefined}
        data-resizing={navigation.resizingId === 'modules' || undefined}
      >
        <div className="depth-window__header" {...navigation.dragHandleProps} />
        <span
          className="depth-window__resize-handle"
          data-resize-edge="se"
          {...navigation.resizeHandleProps('modules', 'se')}
        />
      </section>
    );
  }

  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));

  const depthWindow = container.querySelector<HTMLElement>('.depth-window');
  const header = container.querySelector<HTMLElement>('.depth-window__header');
  const resizeHandle = container.querySelector<HTMLElement>('.depth-window__resize-handle');
  assert.ok(depthWindow);
  assert.ok(header);
  assert.ok(resizeHandle);

  depthWindow.getBoundingClientRect = () => ({
    left: 300,
    top: 200,
    width: 700,
    height: 400,
    right: 1000,
    bottom: 600,
    x: 300,
    y: 200,
    toJSON: () => ({}),
  });
  const capturedPointers = new Set<number>();
  header.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
  header.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
  header.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
  resizeHandle.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
  resizeHandle.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
  resizeHandle.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);

  await act(async () => {
    header.dispatchEvent(pointerEvent(dom.window, 'pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 500,
      clientY: 250,
      pointerId: 7,
    }));
  });
  assert.equal(depthWindow.dataset.dragging, 'true');

  await act(async () => {
    header.dispatchEvent(pointerEvent(dom.window, 'pointermove', {
      bubbles: true,
      clientX: 620,
      clientY: 340,
      pointerId: 7,
    }));
  });
  assert.equal(depthWindow.dataset.position, '120,90');

  await act(async () => {
    header.dispatchEvent(pointerEvent(dom.window, 'pointerup', {
      bubbles: true,
      button: 0,
      clientX: 620,
      clientY: 340,
      pointerId: 7,
    }));
  });
  assert.equal(depthWindow.dataset.position, '120,90');
  assert.equal(depthWindow.dataset.dragging, undefined);
  assert.equal(capturedPointers.size, 0);

  await act(async () => {
    resizeHandle.dispatchEvent(pointerEvent(dom.window, 'pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 1000,
      clientY: 600,
      pointerId: 8,
    }));
  });
  assert.equal(depthWindow.dataset.resizing, 'true');

  await act(async () => {
    resizeHandle.dispatchEvent(pointerEvent(dom.window, 'pointermove', {
      bubbles: true,
      clientX: 1120,
      clientY: 690,
      pointerId: 8,
    }));
  });
  assert.equal(depthWindow.dataset.size, '820,490');
  assert.equal(depthWindow.dataset.position, '120,180');

  await act(async () => {
    resizeHandle.dispatchEvent(pointerEvent(dom.window, 'pointerup', {
      bubbles: true,
      button: 0,
      clientX: 1120,
      clientY: 690,
      pointerId: 8,
    }));
  });
  assert.equal(depthWindow.dataset.resizing, undefined);
  assert.equal(depthWindow.dataset.size, '820,490');
  assert.equal(capturedPointers.size, 0);

  await act(async () => root.unmount());
  dom.window.close();
});
