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
      consumeAuthority: 'runtime',
      audio: audio('idle'),
    })).toBe('loading');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      consumeAuthority: 'runtime',
      presentationState: 'loading',
      audio: audio('idle'),
    })).toBe('loading');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      consumeAuthority: 'runtime',
      presentationState: 'recovering',
      audio: audio('idle'),
    })).toBe('recovering');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      consumeAuthority: 'runtime',
      presentationState: 'unavailable',
      audio: audio('started'),
    })).toBe('unavailable');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      consumeAuthority: 'runtime',
      presentationState: 'ready',
      audio: audio('idle'),
    })).toBe('ready');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      consumeAuthority: 'runtime',
      audio: audio('started'),
    })).toBe('speaking');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      consumeAuthority: 'runtime',
      audio: audio('failed', 'decode_failed'),
    })).toBe('voice_failed');
    expect(deriveAvatarRuntimeStatus({
      compositionReady: true,
      compositionState: 'ready',
      consumeAuthority: 'runtime',
      audio: audio('started', 'lipsync_sink_failed'),
    })).toBe('lipsync_silent');
  });

  it('keeps fixture output explicitly outside product readiness', () => {
    expect(deriveAvatarRuntimeStatus({
      compositionReady: false,
      compositionState: 'fixture_not_verified',
      consumeAuthority: 'fixture',
      presentationState: 'ready',
      audio: audio('started'),
    })).toBe('not_verified');

    render(<AvatarRuntimeStatusRegion status="not_verified" />);
    const region = screen.getByTestId('avatar-runtime-status');
    expect(region.getAttribute('data-avatar-status')).toBe('not_verified');
    expect(region.textContent).toBe('Fixture preview — not verified as a live Runtime avatar');
    expect(region.classList.contains('sr-only')).toBe(false);
  });

  it('renders the state visibly and through a polite live region', () => {
    render(<AvatarRuntimeStatusRegion status="speaking" />);
    const region = screen.getByTestId('avatar-runtime-status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.getAttribute('data-avatar-status')).toBe('speaking');
    expect(region.textContent).toBe('Avatar speaking');
    expect(region.classList.contains('sr-only')).toBe(false);
  });

  it('announces ready without rendering a permanent visible success pill', () => {
    render(<AvatarRuntimeStatusRegion status="ready" />);
    const region = screen.getByTestId('avatar-runtime-status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Avatar ready');
    expect(region.classList.contains('sr-only')).toBe(true);
    expect(region.style.width).toBe('1px');
    expect(region.style.overflow).toBe('hidden');
  });
});
