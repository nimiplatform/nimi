import { describe, expect, it } from 'vitest';

import {
  resolveAvatarBackendLabel,
  resolveAvatarPresentationProfile,
  resolveAvatarStagePosterUrl,
  resolveAvatarStageRendererModel,
} from '../src/headless.js';

describe('avatar headless renderer resolution', () => {
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

  it('keeps live2d asset refs while allowing a separate poster image', () => {
    const renderer = resolveAvatarStageRendererModel({
      presentation: {
        backendKind: 'live2d',
        avatarAssetRef: 'desktop-avatar://resource-2/avatar.model3.json',
        idlePreset: 'companion.idle.soft',
      },
      imageUrl: 'https://cdn.nimi.test/avatar-poster.png',
    });

    expect(renderer).toMatchObject({
      kind: 'live2d',
      mediaUrl: 'desktop-avatar://resource-2/avatar.model3.json',
      posterUrl: 'https://cdn.nimi.test/avatar-poster.png',
      backendLabel: 'Live2D',
      prefersMotion: true,
    });
  });

  it('keeps fallback profiles inside the admitted backend union', () => {
    const presentation = resolveAvatarPresentationProfile({
      fallbackAssetRef: 'https://cdn.nimi.test/avatar.png',
    });
    const posterUrl = resolveAvatarStagePosterUrl(
      presentation,
      'https://cdn.nimi.test/avatar.png',
    );
    const renderer = resolveAvatarStageRendererModel({
      presentation,
      imageUrl: posterUrl,
    });

    expect(renderer).toMatchObject({
      kind: 'live2d',
      mediaUrl: 'https://cdn.nimi.test/avatar.png',
      posterUrl: 'https://cdn.nimi.test/avatar.png',
      backendLabel: 'Live2D',
      prefersMotion: true,
    });
  });

  it('exposes stable backend labels for badge rendering', () => {
    expect(resolveAvatarBackendLabel('vrm')).toBe('VRM');
    expect(resolveAvatarBackendLabel('live2d')).toBe('Live2D');
  });
});
