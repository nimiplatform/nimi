import type { CompanionAnchorBinding, CompanionMessageCue } from './companion-state.js';
import { createCompanionAnchorKey } from './companion-state.js';

export type VoiceCompanionAvailability = 'unknown' | 'ready' | 'blocked';
export type VoiceCompanionStatus =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'pending'
  | 'replying'
  | 'interrupted'
  | 'error';

// Wave 3 — runtime.agent.presentation.voice_playback_requested playback_state
// projection per K-AGCORE-051. The avatar surface mirrors the runtime-owned
// playback lifecycle 1:1; `idle` is the avatar-local resting state when no
// committed turn is driving playback.
export type AudioPlaybackState =
  | 'idle'
  | 'requested'
  | 'started'
  | 'completed'
  | 'interrupted'
  | 'failed';

export type VoiceCompanionCaption = CompanionMessageCue & {
  live: boolean;
};

export type VoiceCompanionState = {
  anchorKey: string | null;
  panelVisible: boolean;
  availability: VoiceCompanionAvailability;
  availabilityMessage: string | null;
  status: VoiceCompanionStatus;
  level: number;
  awaitingReply: boolean;
  currentTurnId: string | null;
  interruptedTurnId: string | null;
  errorMessage: string | null;
  userCaption: VoiceCompanionCaption | null;
  assistantCaption: VoiceCompanionCaption | null;
  // Wave 3 lipsync slice (runtime-driven, K-AGCORE-051)
  lipsyncActive: boolean;
  currentMouthOpenY: number;
  audioArtifactId: string | null;
  audioPlaybackState: AudioPlaybackState;
};

export const initialVoiceCompanionState: VoiceCompanionState = {
  anchorKey: null,
  panelVisible: false,
  availability: 'unknown',
  availabilityMessage: null,
  status: 'idle',
  level: 0,
  awaitingReply: false,
  currentTurnId: null,
  interruptedTurnId: null,
  errorMessage: null,
  userCaption: null,
  assistantCaption: null,
  lipsyncActive: false,
  currentMouthOpenY: 0,
  audioArtifactId: null,
  audioPlaybackState: 'idle',
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function bindVoiceCompanionState(
  state: VoiceCompanionState,
  binding: CompanionAnchorBinding | null,
): VoiceCompanionState {
  const anchorKey = createCompanionAnchorKey(binding);
  if (anchorKey === state.anchorKey) {
    return state;
  }
  return {
    ...initialVoiceCompanionState,
    anchorKey,
  };
}

export function openVoiceCompanion(state: VoiceCompanionState): VoiceCompanionState {
  return {
    ...state,
    panelVisible: true,
  };
}

export function closeVoiceCompanion(state: VoiceCompanionState): VoiceCompanionState {
  return {
    ...state,
    panelVisible: false,
    status: 'idle',
    level: 0,
    awaitingReply: false,
    currentTurnId: null,
    interruptedTurnId: null,
    errorMessage: null,
    lipsyncActive: false,
    currentMouthOpenY: 0,
    audioArtifactId: null,
    audioPlaybackState: 'idle',
  };
}

export function setVoiceCompanionAvailability(
  state: VoiceCompanionState,
  input: {
    availability: VoiceCompanionAvailability;
    message?: string | null;
  },
): VoiceCompanionState {
  return {
    ...state,
    availability: input.availability,
    availabilityMessage: normalizeText(input.message) || null,
  };
}

export function beginVoiceListening(state: VoiceCompanionState): VoiceCompanionState {
  return {
    ...state,
    panelVisible: true,
    status: 'listening',
    level: 0,
    awaitingReply: false,
    currentTurnId: null,
    interruptedTurnId: null,
    errorMessage: null,
  };
}

export function beginVoiceTranscribing(state: VoiceCompanionState): VoiceCompanionState {
  return {
    ...state,
    panelVisible: true,
    status: 'transcribing',
    level: 0,
    errorMessage: null,
  };
}

export function setVoiceLevel(state: VoiceCompanionState, level: number): VoiceCompanionState {
  return {
    ...state,
    level: Math.max(0, Math.min(1, level)),
  };
}

export function setVoiceCompanionError(
  state: VoiceCompanionState,
  message: string,
): VoiceCompanionState {
  return {
    ...state,
    panelVisible: true,
    status: 'error',
    level: 0,
    awaitingReply: false,
    currentTurnId: null,
    interruptedTurnId: null,
    errorMessage: normalizeText(message) || 'Foreground voice is unavailable for the current anchor.',
  };
}

export function setVoiceTranscriptSubmitted(
  state: VoiceCompanionState,
  input: {
    transcript: string;
    at: string;
  },
): VoiceCompanionState {
  return {
    ...state,
    panelVisible: true,
    status: 'pending',
    level: 0,
    awaitingReply: true,
    currentTurnId: null,
    interruptedTurnId: null,
    errorMessage: null,
    userCaption: {
      text: normalizeText(input.transcript),
      at: input.at,
      messageId: null,
      turnId: null,
      live: false,
    },
  };
}

export function setVoiceReplyingTurn(
  state: VoiceCompanionState,
  input: {
    turnId: string;
  },
): VoiceCompanionState {
  return {
    ...state,
    status: 'replying',
    awaitingReply: true,
    currentTurnId: normalizeText(input.turnId) || state.currentTurnId,
    errorMessage: null,
  };
}

export function setVoiceAssistantCaption(
  state: VoiceCompanionState,
  input: VoiceCompanionCaption,
): VoiceCompanionState {
  return {
    ...state,
    panelVisible: true,
    assistantCaption: input,
  };
}

export function completeVoiceReplying(state: VoiceCompanionState): VoiceCompanionState {
  return {
    ...state,
    status: 'idle',
    awaitingReply: false,
    currentTurnId: null,
    errorMessage: null,
    level: 0,
  };
}

export function interruptVoiceCompanion(
  state: VoiceCompanionState,
  input: {
    turnId?: string | null;
    message?: string | null;
  },
): VoiceCompanionState {
  return {
    ...state,
    panelVisible: true,
    status: 'interrupted',
    awaitingReply: false,
    currentTurnId: null,
    interruptedTurnId: normalizeText(input.turnId) || null,
    errorMessage: normalizeText(input.message) || 'Current anchor reply was interrupted.',
    level: 0,
    lipsyncActive: false,
    currentMouthOpenY: 0,
    audioArtifactId: null,
    audioPlaybackState: 'interrupted',
  };
}

// Wave 3 — lipsync slice helpers (runtime.agent.presentation.lipsync_frame_batch
// + voice_playback_requested driven). All helpers are pure reducers; consumers
// MUST set `audioArtifactId` via `activateLipsync` before pushing frames so the
// state stays internally consistent.

export function activateLipsync(
  state: VoiceCompanionState,
  input: { audioArtifactId: string },
): VoiceCompanionState {
  const audioArtifactId = normalizeText(input.audioArtifactId);
  if (!audioArtifactId) {
    return state;
  }
  return {
    ...state,
    lipsyncActive: true,
    currentMouthOpenY: 0,
    audioArtifactId,
  };
}

export function setMouthOpenY(state: VoiceCompanionState, value: number): VoiceCompanionState {
  if (!Number.isFinite(value)) {
    return state;
  }
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped === state.currentMouthOpenY) {
    return state;
  }
  return {
    ...state,
    currentMouthOpenY: clamped,
  };
}

export function deactivateLipsync(state: VoiceCompanionState): VoiceCompanionState {
  if (!state.lipsyncActive && state.currentMouthOpenY === 0 && state.audioArtifactId === null) {
    return state;
  }
  return {
    ...state,
    lipsyncActive: false,
    currentMouthOpenY: 0,
    audioArtifactId: null,
  };
}

export function setAudioPlaybackState(
  state: VoiceCompanionState,
  next: AudioPlaybackState,
): VoiceCompanionState {
  if (state.audioPlaybackState === next) {
    return state;
  }
  return {
    ...state,
    audioPlaybackState: next,
  };
}
