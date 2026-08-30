import { describe, expect, it } from 'vitest';
import { initialVoiceCompanionState } from '../voice-companion-state.js';
import { derivePresenceState } from './presence-state-machine.js';

function derive(
  input: Partial<Parameters<typeof derivePresenceState>[0]> = {},
) {
  const voice = {
    ...initialVoiceCompanionState,
    ...input.voice,
    availability: input.voice?.availability === 'blocked' ? 'blocked' as const : 'ready' as const,
  };
  return derivePresenceState({
    bootstrapReady: true,
    bindingPresent: true,
    compositionReady: true,
    ...input,
    voice,
  });
}

describe('derivePresenceState', () => {
  it('maps ready idle to explicit local click-to-start control', () => {
    const state = derive();
    expect(state.stateId).toBe('idle');
    expect(state.micIntent).toBe('start_listening');
    expect(state.privacyIndicator).toBe('mic_idle');
    expect(state.canStartForegroundCapture).toBe(true);
  });

  it('keeps permission request mic-idle and denied permission mic-blocked', () => {
    const requesting = derive({
      voice: { ...initialVoiceCompanionState, availability: 'ready', status: 'requesting_permission' },
    });
    expect(requesting.stateId).toBe('requesting_permission');
    expect(requesting.privacyIndicator).toBe('mic_idle');
    expect(requesting.micDisabled).toBe(true);

    const denied = derive({
      voice: { ...initialVoiceCompanionState, availability: 'blocked', status: 'error' },
    });
    expect(denied.stateId).toBe('error');
    expect(denied.privacyIndicator).toBe('mic_blocked');
    expect(denied.micDisabled).toBe(true);
  });

  it('fails closed when runtime binding is missing', () => {
    const state = derive({ bindingPresent: false });
    expect(state.stateId).toBe('blocked');
    expect(state.micDisabled).toBe(true);
    expect(state.privacyIndicator).toBe('mic_blocked');
  });

  it('maps foreground listening to explicit click-to-stop and commit', () => {
    const state = derive({
      voice: { ...initialVoiceCompanionState, status: 'listening', level: 0.7 },
    });
    expect(state.stateId).toBe('foreground_listening');
    expect(state.micIntent).toBe('commit_listening');
    expect(state.privacyIndicator).toBe('mic_active');
  });

  it('maps canonical voice pending to turn_pending', () => {
    expect(derive({
      voice: { ...initialVoiceCompanionState, status: 'pending' },
    }).stateId).toBe('turn_pending');
  });

  it('maps only real audio/lipsync activity to assistant speaking and interrupt visibility', () => {
    const playback = derive({
      voice: { ...initialVoiceCompanionState, audioPlaybackState: 'started', lipsyncActive: true },
    });
    expect(playback.stateId).toBe('assistant_speaking');
    expect(playback.privacyIndicator).toBe('speaker_active');
    expect(playback.interruptVisible).toBe(true);
  });

  it('does not let mic availability mask real output or processing truth', () => {
    const speaking = derive({
      voice: {
        ...initialVoiceCompanionState,
        availability: 'blocked',
        audioPlaybackState: 'started',
      },
    });
    expect(speaking.stateId).toBe('assistant_speaking');
    expect(speaking.interruptVisible).toBe(true);

    const pending = derive({
      voice: {
        ...initialVoiceCompanionState,
        availability: 'blocked',
        status: 'pending',
      },
    });
    expect(pending.stateId).toBe('turn_pending');
    expect(pending.micDisabled).toBe(true);
  });

  it('maps failed audio to unavailable while retaining explicit capture recovery', () => {
    const state = derive({
      voice: { ...initialVoiceCompanionState, audioPlaybackState: 'failed' },
    });
    expect(state.stateId).toBe('muted_or_audio_unavailable');
    expect(state.micIntent).toBe('start_listening');
    expect(state.audioUnavailable).toBe(true);
    expect(state.privacyIndicator).toBe('speaker_unavailable');
  });
});
