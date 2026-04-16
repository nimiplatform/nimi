import { describe, expect, it } from 'vitest';

import {
  createVrmAvatarRenderer,
  formatAvatarVrmAssetLabel,
} from '../src/vrm.js';

describe('avatar vrm renderer surface', () => {
  it('renders injected viewport content when provided', () => {
    const renderer = createVrmAvatarRenderer({
      renderViewport: (input) => `viewport:${input.assetRef}`,
    });

    const result = renderer({
      label: 'Companion',
      fallback: 'C',
      renderer: {
        kind: 'vrm',
        assetRef: 'https://cdn.nimi.test/avatar.vrm',
        mediaUrl: 'https://cdn.nimi.test/avatar.vrm',
        posterUrl: 'https://cdn.nimi.test/avatar.png',
        backendLabel: 'VRM',
        prefersMotion: true,
      },
      snapshot: {
        presentation: {
          backendKind: 'vrm',
          avatarAssetRef: 'https://cdn.nimi.test/avatar.vrm',
          idlePreset: 'companion.idle.soft',
        },
        interaction: {
          phase: 'idle',
        },
      },
      size: 'md',
      frameClassName: 'h-28 w-28',
    });

    expect(result).toBeTruthy();
  });

  it('falls back to default vrm shell when no viewport renderer is injected', () => {
    const renderer = createVrmAvatarRenderer();

    const result = renderer({
      label: 'Companion',
      fallback: 'C',
      renderer: {
        kind: 'vrm',
        assetRef: 'https://cdn.nimi.test/avatar.vrm',
        mediaUrl: 'https://cdn.nimi.test/avatar.vrm',
        posterUrl: 'https://cdn.nimi.test/avatar.png',
        backendLabel: 'VRM',
        prefersMotion: true,
      },
      snapshot: {
        presentation: {
          backendKind: 'vrm',
          avatarAssetRef: 'https://cdn.nimi.test/avatar.vrm',
        },
        interaction: {
          phase: 'idle',
        },
      },
      size: 'md',
      frameClassName: 'h-28 w-28',
    });

    expect(result).toBeTruthy();
  });

  it('normalizes stable vrm asset labels for badges and fallbacks', () => {
    expect(formatAvatarVrmAssetLabel('https://cdn.nimi.test/avatars/airi.vrm')).toBe('airi.vrm');
    expect(formatAvatarVrmAssetLabel('fallback://airi-vrm-shell')).toBe('airi-vrm-shell');
  });
});
