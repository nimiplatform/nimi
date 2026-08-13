import { describe, expect, it } from 'vitest';

import {
  createAvatarStageSnapshot,
  resolveAvatarBackendLabel,
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

  it('creates a stage snapshot from an explicit presentation profile', () => {
    const presentation = {
      backendKind: 'sprite2d' as const,
      avatarAssetRef: 'profile_media_url:https://cdn.nimi.test/avatar.png',
    };
    const snapshot = createAvatarStageSnapshot(presentation, {
      phase: 'thinking',
    });

    expect(snapshot.presentation).toBe(presentation);
    expect(snapshot.interaction).toMatchObject({
      phase: 'thinking',
      emotion: 'neutral',
      attentionTarget: 'camera',
    });
  });

  it('uses reviewed profile media urls as static sprite2d presentation assets', () => {
    const renderer = resolveAvatarStageRendererModel({
      presentation: {
        backendKind: 'sprite2d',
        avatarAssetRef: 'profile_media_url:https://cdn.nimi.test/cbdb/su-zhe.png',
        defaultVoiceReference: 'preset_voice_id:zh_narrator',
      },
    });

    expect(renderer).toMatchObject({
      kind: 'sprite2d',
      mediaUrl: 'https://cdn.nimi.test/cbdb/su-zhe.png',
      posterUrl: 'https://cdn.nimi.test/cbdb/su-zhe.png',
      backendLabel: 'Sprite 2D',
      prefersMotion: false,
    });
  });

  it('exposes stable backend labels for badge rendering', () => {
    expect(resolveAvatarBackendLabel('vrm')).toBe('VRM');
    expect(resolveAvatarBackendLabel('live2d')).toBe('Live2D');
    expect(resolveAvatarBackendLabel('sprite2d')).toBe('Sprite 2D');
  });
});
