import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AudioPlaybackSnapshot } from '@nimiplatform/kit/features/avatar/headless';
import {
  AvatarRuntimeStatusRegion,
  deriveAvatarRuntimeStatus,
} from './avatar-runtime-status.js';

function audio(
  state: AudioPlaybackSnapshot['state'],
  reason: string | null = null,
): AudioPlaybackSnapshot {
  return {
    state,
    reason,
    audioArtifactId: state === 'idle' ? null : 'artifact-1',
    audioMimeType: state === 'idle' ? null : 'audio/wav',
  };
}

describe('Avatar runtime accessible status', () => {
  it('distinguishes loading, ready, speaking, voice failure, and lipsync-silent', () => {
    expect(deriveAvatarRuntimeStatus({
      compositionReady: false,
      compositionState: 'loading',
      audio: audio('idle'),
    })).toBe('loading');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      audio: audio('idle'),
    })).toBe('ready');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      audio: audio('started'),
    })).toBe('speaking');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      audio: audio('failed', 'decode_failed'),
    })).toBe('voice_failed');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      audio: audio('started', 'lipsync_sink_failed'),
    })).toBe('lipsync_silent');
  });

  it('renders the state visibly and through a polite live region', () => {
    render(<AvatarRuntimeStatusRegion status="speaking" />);
    const region = screen.getByTestId('avatar-runtime-status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.getAttribute('data-avatar-status')).toBe('speaking');
    expect(region.textContent).toBe('Avatar speaking');
  });
});
