import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopParticleBackgroundLight } from '../src/components/desktop-particle-background-light';

const constructRenderer = vi.hoisted(() => vi.fn());

// Only the GPU boundary is replaced: geometry, camera, raycasting and the component run normally.
vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    constructor(options: unknown) {
      return constructRenderer(options);
    }
  },
}));

function createRenderer(events: string[]) {
  return {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn((ratio: number) => { events.push(`dpr:${ratio}`); }),
    setSize: vi.fn((width: number, height: number) => { events.push(`size:${width}x${height}`); }),
    setClearColor: vi.fn(),
    render: vi.fn((_scene: THREE.Scene, _camera: THREE.Camera) => { events.push('render'); }),
    dispose: vi.fn(),
  };
}

describe('DesktopParticleBackgroundLight lifecycle', () => {
  let root: Root | null;
  let host: HTMLDivElement;
  let width: number;
  let height: number;
  let dpr: number;
  let hidden: boolean;
  let now: number;
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;
  let events: string[];
  let renderer: ReturnType<typeof createRenderer>;
  let notifyResize: () => void;
  let disconnect: ReturnType<typeof vi.fn>;
  let dprDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    width = 800;
    height = 600;
    dpr = 1;
    hidden = false;
    now = 0;
    nextFrameId = 0;
    frames = new Map();
    events = [];
    renderer = createRenderer(events);
    constructRenderer.mockReset().mockReturnValue(renderer);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) { notifyResize = () => callback([], this); }
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const tokens = document.createElement('div').style;
    tokens.setProperty('--nimi-action-primary-bg', '#1476D4');
    tokens.setProperty('--nimi-text-inverse', '#FFFFFF');
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(tokens);
    dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => dpr });
  });

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount(); });
    host.remove();
    if (dprDescriptor) Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => { root?.render(<DesktopParticleBackgroundLight />); });
  }

  function frame(step = 16) {
    now += step;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(now);
  }

  function resize() {
    notifyResize();
    window.dispatchEvent(new Event('resize'));
  }

  function visibility(value: boolean) {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('coalesces pointer work into the visible RAF and skips unchanged size/DPR resets', async () => {
    const raycast = vi.spyOn(THREE.Raycaster.prototype, 'setFromCamera');
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');
    await mount();
    const container = host.firstElementChild as HTMLElement;
    const layout = vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
      ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} }));
    frame();
    expect(constructRenderer).toHaveBeenCalledTimes(1);
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    resize();
    frame(8);
    expect(renderer.setSize).toHaveBeenCalledTimes(1);
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    for (const [clientX, clientY] of [[80, 60], [200, 100], [400, 300]]) {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY }));
    }
    expect(layout).not.toHaveBeenCalled();
    expect(raycast).not.toHaveBeenCalled();
    frame(8);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(raycast).toHaveBeenCalledTimes(1);
    expect(raycast.mock.calls[0]?.[0]).toEqual(new THREE.Vector2(0, 0));
    frame(8);
    expect(renderer.render).toHaveBeenCalledTimes(4);
    expect(layout).toHaveBeenCalledTimes(1);
    expect(raycast).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.dispatchEvent(new FocusEvent('focusout'));
      root?.unmount();
      root = null;
    });
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(2);
    expect(materialDispose).toHaveBeenCalledTimes(2);
    expect(host.querySelector('canvas')).toBeNull();
    resize();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    frame();
    expect(renderer.render).toHaveBeenCalledTimes(4);
  });

  it('defers hidden resize and pointer work until one resumed frame applies the latest dimensions', async () => {
    const raycast = vi.spyOn(THREE.Raycaster.prototype, 'setFromCamera');
    await mount();
    const container = host.firstElementChild as HTMLElement;
    const layout = vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(
      { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON() {} });
    frame();
    visibility(true);
    width = 1000;
    height = 500;
    dpr = 3;
    events.length = 0;
    resize();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 125 }));
    expect(frames.size).toBe(0);
    expect(events).toEqual([]);
    expect(layout).not.toHaveBeenCalled();
    expect(raycast).not.toHaveBeenCalled();
    visibility(false);
    visibility(false);
    await act(async () => { document.dispatchEvent(new FocusEvent('focusout')); });
    expect(frames.size).toBe(1);
    expect(events).toEqual([]);
    frame();
    expect(events).toEqual(['dpr:2', 'size:1000x500', 'render']);
    expect((renderer.render.mock.lastCall?.[1] as THREE.PerspectiveCamera).aspect).toBe(2);
    expect(raycast.mock.lastCall?.[0]).toEqual(new THREE.Vector2(-0.5, 0.5));
  });

  it('keeps rendering while an input is focused or composing, without adding another RAF loop', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      input.focus();
      await mount();
      frame(8);
      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(input);
      for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
        input.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: '测试' }));
        expect(frames.size).toBe(1);
        frame(8);
      }
      expect(renderer.render).toHaveBeenCalledTimes(4);
      width = 900;
      height = 600;
      events.length = 0;
      resize();
      expect(events).toEqual([]);
      expect(frames.size).toBe(1);
      frame(8);
      expect(events).toEqual(['size:900x600', 'render']);
      expect(document.activeElement).toBe(input);
      input.blur();
      expect(frames.size).toBe(1);
    } finally {
      input.remove();
    }
  });

  it('waits for valid observed dimensions and an active page before initializing', async () => {
    width = 0;
    await mount();
    frame();
    expect(constructRenderer).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    width = 800;
    height = 0;
    resize();
    frame();
    expect(constructRenderer).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    visibility(true);
    height = 600;
    resize();
    expect(frames.size).toBe(0);
    expect(constructRenderer).not.toHaveBeenCalled();
    visibility(false);
    frame();
    expect(constructRenderer).toHaveBeenCalledTimes(1);
    expect(renderer.setSize).toHaveBeenCalledWith(800, 600);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });

  it('keeps a static fallback when the actual renderer constructor fails', async () => {
    constructRenderer.mockImplementation(() => { throw new Error('WebGL context unavailable'); });
    await mount();
    expect(() => frame()).not.toThrow();
    expect(constructRenderer).toHaveBeenCalledTimes(1);
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
    expect(host.querySelector('canvas')).toBeNull();
    expect(renderer.render).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    resize();
    visibility(false);
    frame();
    expect(constructRenderer).toHaveBeenCalledTimes(1);
  });
});
