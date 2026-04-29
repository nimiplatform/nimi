import { describe, expect, it } from 'vitest';
import {
  activateLipsync,
  bindVoiceCompanionState,
  closeVoiceCompanion,
  deactivateLipsync,
  initialVoiceCompanionState,
  interruptVoiceCompanion,
  setAudioPlaybackState,
  setMouthOpenY,
  type VoiceCompanionState,
} from './voice-companion-state.js';

const baseBinding = {
  conversationAnchorId: 'agent_anchor_01HZX',
  agentId: 'agent-alpha',
};

describe('voice-companion-state — base slice', () => {
  it('initial state declares lipsync slice with safe defaults', () => {
    expect(initialVoiceCompanionState.lipsyncActive).toBe(false);
    expect(initialVoiceCompanionState.currentMouthOpenY).toBe(0);
    expect(initialVoiceCompanionState.audioArtifactId).toBeNull();
    expect(initialVoiceCompanionState.audioPlaybackState).toBe('idle');
  });

  it('bind to a new anchor resets lipsync slice along with the rest of the state', () => {
    const dirty: VoiceCompanionState = {
      ...initialVoiceCompanionState,
      anchorKey: null,
      lipsyncActive: true,
      currentMouthOpenY: 0.7,
      audioArtifactId: 'artifact-1',
      audioPlaybackState: 'started',
    };
    const next = bindVoiceCompanionState(dirty, baseBinding);
    expect(next.lipsyncActive).toBe(false);
    expect(next.currentMouthOpenY).toBe(0);
    expect(next.audioArtifactId).toBeNull();
    expect(next.audioPlaybackState).toBe('idle');
  });

  it('closing the companion clears lipsync slice', () => {
    const open: VoiceCompanionState = {
      ...initialVoiceCompanionState,
      panelVisible: true,
      lipsyncActive: true,
      currentMouthOpenY: 0.42,
      audioArtifactId: 'artifact-2',
      audioPlaybackState: 'started',
    };
    const closed = closeVoiceCompanion(open);
    expect(closed.panelVisible).toBe(false);
    expect(closed.lipsyncActive).toBe(false);
    expect(closed.currentMouthOpenY).toBe(0);
    expect(closed.audioArtifactId).toBeNull();
    expect(closed.audioPlaybackState).toBe('idle');
  });
});

describe('voice-companion-state — lipsync helpers', () => {
  it('activateLipsync stores audioArtifactId and primes mouth_open_y to 0', () => {
    const next = activateLipsync(initialVoiceCompanionState, { audioArtifactId: 'synthetic://lipsync/turn-1' });
    expect(next.lipsyncActive).toBe(true);
    expect(next.audioArtifactId).toBe('synthetic://lipsync/turn-1');
    expect(next.currentMouthOpenY).toBe(0);
  });

  it('activateLipsync rejects empty / whitespace artifact id (fail-close)', () => {
    expect(activateLipsync(initialVoiceCompanionState, { audioArtifactId: '' })).toBe(initialVoiceCompanionState);
    expect(activateLipsync(initialVoiceCompanionState, { audioArtifactId: '   ' })).toBe(initialVoiceCompanionState);
  });

  it('setMouthOpenY clamps to [0,1] and ignores non-finite values', () => {
    const active = activateLipsync(initialVoiceCompanionState, { audioArtifactId: 'a' });
    expect(setMouthOpenY(active, 0.5).currentMouthOpenY).toBe(0.5);
    expect(setMouthOpenY(active, -0.1).currentMouthOpenY).toBe(0);
    expect(setMouthOpenY(active, 1.5).currentMouthOpenY).toBe(1);
    expect(setMouthOpenY(active, Number.NaN)).toBe(active);
    expect(setMouthOpenY(active, Number.POSITIVE_INFINITY)).toBe(active);
  });

  it('setMouthOpenY returns the same reference when value is unchanged', () => {
    const active = activateLipsync(initialVoiceCompanionState, { audioArtifactId: 'a' });
    const same = setMouthOpenY(active, 0);
    expect(same).toBe(active);
  });

  it('deactivateLipsync clears active + mouth + artifact', () => {
    const active = activateLipsync(initialVoiceCompanionState, { audioArtifactId: 'a' });
    const moved = setMouthOpenY(active, 0.8);
    const off = deactivateLipsync(moved);
    expect(off.lipsyncActive).toBe(false);
    expect(off.currentMouthOpenY).toBe(0);
    expect(off.audioArtifactId).toBeNull();
  });

  it('deactivateLipsync is idempotent on a clean slice', () => {
    expect(deactivateLipsync(initialVoiceCompanionState)).toBe(initialVoiceCompanionState);
  });

  it('setAudioPlaybackState transitions through the runtime lifecycle', () => {
    let state = activateLipsync(initialVoiceCompanionState, { audioArtifactId: 'a' });
    state = setAudioPlaybackState(state, 'requested');
    expect(state.audioPlaybackState).toBe('requested');
    state = setAudioPlaybackState(state, 'started');
    expect(state.audioPlaybackState).toBe('started');
    state = setAudioPlaybackState(state, 'completed');
    expect(state.audioPlaybackState).toBe('completed');
  });

  it('setAudioPlaybackState returns the same reference when state is unchanged', () => {
    const state = setAudioPlaybackState(initialVoiceCompanionState, 'idle');
    expect(state).toBe(initialVoiceCompanionState);
  });

  it('interruptVoiceCompanion forces audio playback into interrupted + clears mouth_open_y', () => {
    const active = activateLipsync(
      { ...initialVoiceCompanionState, panelVisible: true, status: 'replying' as const },
      { audioArtifactId: 'a' },
    );
    const moved = setMouthOpenY(setAudioPlaybackState(active, 'started'), 0.6);
    const interrupted = interruptVoiceCompanion(moved, { turnId: 'turn-x' });
    expect(interrupted.lipsyncActive).toBe(false);
    expect(interrupted.currentMouthOpenY).toBe(0);
    expect(interrupted.audioArtifactId).toBeNull();
    expect(interrupted.audioPlaybackState).toBe('interrupted');
    expect(interrupted.interruptedTurnId).toBe('turn-x');
  });
});
