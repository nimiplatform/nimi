import { describe, expect, it } from 'vitest';

import { resolveAvatarLive2dFramingPolicy } from '../src/live2d.js';

describe('avatar live2d framing helpers', () => {
  it('lifts tall no-layout full-body models in portrait rails', () => {
    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.42,
      layout: new Map(),
    })).toEqual({
      mode: 'full-body-tall',
      height: 2.2,
      centerX: 0,
      centerY: 0.13,
    });
  });

  it('keeps wide no-layout models on explicit width framing in portrait rails', () => {
    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1.4,
      modelCanvasHeight: 1,
      layout: new Map(),
    })).toEqual({
      mode: 'wide-in-portrait',
      width: 2,
      centerX: 0,
      centerY: 0.03,
    });
  });

  it('crops upper-body portrait models tighter for the chat rail', () => {
    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.25,
      layout: new Map(),
    })).toEqual({
      mode: 'upper-body-portrait',
      height: 2.22,
      centerX: 0,
      centerY: 0.1,
    });
  });

  it('preserves strong layout metadata without extra recentering', () => {
    const layout = new Map<string, number>([
      ['CenterX', 0],
      ['CenterY', 0],
      ['Width', 2],
    ]);

    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.2,
      layout,
    })).toEqual({
      mode: 'layout',
    });
  });

  it('recenters weak layout metadata inside portrait rails', () => {
    const layout = new Map<string, number>([
      ['Width', 1.7],
    ]);

    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 360,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.1,
      layout,
    })).toEqual({
      mode: 'layout',
      centerX: 0,
      centerY: 0.06,
    });
  });

  it('returns a bust-focused crop in portrait rails when intent is chat-focus', () => {
    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 320,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.42,
      layout: new Map(),
      intent: 'chat-focus',
    })).toEqual({
      mode: 'chat-focus',
      height: 2.2,
      centerX: 0,
      centerY: -0.15,
    });
  });

  it('keeps existing full-body behaviour when intent is showcase', () => {
    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 320,
      railHeight: 820,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.42,
      layout: new Map(),
      intent: 'showcase',
    })).toEqual({
      mode: 'full-body-tall',
      height: 2.2,
      centerX: 0,
      centerY: 0.13,
    });
  });

  it('returns a stronger bust crop for bottom companion intent even on landscape rails', () => {
    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 920,
      railHeight: 360,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.42,
      layout: new Map(),
      intent: 'bottom-companion',
    })).toEqual({
      mode: 'chat-focus',
      height: 2.72,
      centerX: 0,
      centerY: -0.34,
    });
  });

  it('returns a presence crop for side-stage scene placement', () => {
    expect(resolveAvatarLive2dFramingPolicy({
      railWidth: 420,
      railHeight: 920,
      modelCanvasWidth: 1,
      modelCanvasHeight: 1.42,
      layout: new Map(),
      intent: 'scene-presence',
    })).toEqual({
      mode: 'chat-focus',
      height: 2.38,
      centerX: 0,
      centerY: -0.08,
    });
  });
});
