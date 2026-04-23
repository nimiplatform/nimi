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
  };
}
