import { describe, expect, it } from 'vitest';

import {
  resolveAvatarBackendLabel,
  resolveAvatarStageRendererModel,
} from '../src/headless.js';

describe('avatar headless renderer resolution', () => {
  it('prefers sprite media urls for sprite2d presentations', () => {
    const renderer = resolveAvatarStageRendererModel({
      presentation: {
        backendKind: 'sprite2d',
        avatarAssetRef: 'https://cdn.nimi.test/avatar.png',
      },
    });

    expect(renderer).toMatchObject({
      kind: 'sprite2d',
      mediaUrl: 'https://cdn.nimi.test/avatar.png',
      posterUrl: 'https://cdn.nimi.test/avatar.png',
      backendLabel: 'Sprite',
      prefersMotion: false,
    });
  });

  it('keeps vrm asset refs while allowing a separate poster image', () => {
    const renderer = resolveAvatarStageRendererModel({
      presentation: {
        backendKind: 'vrm',
        avatarAssetRef: 'https://cdn.nimi.test/avatar.vrm',
        idlePreset: 'companion.idle.soft',
      },
      imageUrl: 'https://cdn.nimi.test/avatar-poster.png',
    });

    expect(renderer).toMatchObject({
      kind: 'vrm',
      mediaUrl: 'https://cdn.nimi.test/avatar.vrm',
      posterUrl: 'https://cdn.nimi.test/avatar-poster.png',
      backendLabel: 'VRM',
      prefersMotion: true,
    });
  });

  it('falls back to non-media canvas renderer for fallback profiles', () => {
    const renderer = resolveAvatarStageRendererModel({
      presentation: {
        backendKind: 'canvas2d',
        avatarAssetRef: 'fallback://avatar-stage',
      },
    });

    expect(renderer).toMatchObject({
      kind: 'canvas2d',
      mediaUrl: null,
      posterUrl: null,
      backendLabel: 'Canvas',
      prefersMotion: false,
    });
  });

  it('exposes stable backend labels for badge rendering', () => {
    expect(resolveAvatarBackendLabel('sprite2d')).toBe('Sprite');
    expect(resolveAvatarBackendLabel('canvas2d')).toBe('Canvas');
    expect(resolveAvatarBackendLabel('vrm')).toBe('VRM');
    expect(resolveAvatarBackendLabel('video')).toBe('Video');
  });
});
