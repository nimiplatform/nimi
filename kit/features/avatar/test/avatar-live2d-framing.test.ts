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
});
