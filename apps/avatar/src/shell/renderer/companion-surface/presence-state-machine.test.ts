import { describe, expect, it } from 'vitest';
import { initialCompanionState } from '../companion-state.js';
import { initialVoiceCompanionState } from '../voice-companion-state.js';
import { derivePresenceState } from './presence-state-machine.js';

function derive(
  input: Partial<Parameters<typeof derivePresenceState>[0]> = {},
) {
  return derivePresenceState({
    companion: initialCompanionState,
    voice: initialVoiceCompanionState,
    bootstrapReady: true,
    bindingPresent: true,
    compositionReady: true,
    ...input,
  });
}

describe('derivePresenceState', () => {
  it('maps ready idle to no local mic start control', () => {
    const state = derive();
    expect(state.stateId).toBe('idle');
    expect(state.micIntent).toBe('disabled');
    expect(state.privacyIndicator).toBe('none');
    expect(state.canStartForegroundCapture).toBe(false);
  });

  it('fails closed when runtime binding is missing', () => {
    const state = derive({ bindingPresent: false });
    expect(state.stateId).toBe('blocked');
    expect(state.micDisabled).toBe(true);
    expect(state.privacyIndicator).toBe('mic_blocked');
  });

  it('maps Runtime-projected foreground listening without local commit action', () => {
    const state = derive({
      voice: { ...initialVoiceCompanionState, status: 'listening', level: 0.7 },
    });
    expect(state.stateId).toBe('foreground_listening');
    expect(state.micIntent).toBe('disabled');
    expect(state.privacyIndicator).toBe('mic_active');
  });

  it('maps pending and composer sending to turn_pending', () => {
    expect(derive({
      voice: { ...initialVoiceCompanionState, status: 'pending' },
    }).stateId).toBe('turn_pending');
    expect(derive({
      companion: { ...initialCompanionState, sendState: 'sending' },
    }).stateId).toBe('turn_pending');
  });

  it('maps active reply/audio/lipsync to assistant speaking and interrupt visibility', () => {
    const reply = derive({
      voice: { ...initialVoiceCompanionState, status: 'replying', currentTurnId: 'turn-1' },
    });
    expect(reply.stateId).toBe('assistant_speaking');
    expect(reply.interruptVisible).toBe(true);

    const playback = derive({
      voice: { ...initialVoiceCompanionState, audioPlaybackState: 'started', lipsyncActive: true },
    });
    expect(playback.stateId).toBe('assistant_speaking');
    expect(playback.privacyIndicator).toBe('speaker_active');
  });

  it('maps failed audio to unavailable without exposing local capture', () => {
    const state = derive({
      voice: { ...initialVoiceCompanionState, audioPlaybackState: 'failed' },
    });
    expect(state.stateId).toBe('muted_or_audio_unavailable');
    expect(state.micIntent).toBe('disabled');
    expect(state.audioUnavailable).toBe(true);
    expect(state.privacyIndicator).toBe('speaker_unavailable');
  });
});
