import type { Dispatch, SetStateAction } from 'react';
import type { CompanionState } from '../companion-state.js';
import type { VoiceCompanionState, AudioPlaybackState } from '../voice-companion-state.js';

type AcceptancePresenceState =
  | 'idle'
  | 'foreground_listening'
  | 'turn_pending'
  | 'assistant_speaking'
  | 'interrupted'
  | 'blocked'
  | 'error';

type AvatarAcceptanceProbeSnapshot = {
  presenceRequest: AcceptancePresenceState | null;
  companion: {
    bubbleVisible: boolean;
    inputVisible: boolean;
    sendState: CompanionState['sendState'];
    hasAssistantCue: boolean;
  };
  voice: {
    availability: VoiceCompanionState['availability'];
    status: VoiceCompanionState['status'];
    level: number;
    lipsyncActive: boolean;
    audioPlaybackState: AudioPlaybackState;
  };
};

export type AvatarAcceptanceProbe = {
  setPresenceState(state: AcceptancePresenceState): void;
  setVoiceLevel(level: number): void;
  snapshot(): AvatarAcceptanceProbeSnapshot;
};

type InstallAvatarAcceptanceProbeInput = {
  getCompanion: () => CompanionState;
  getVoice: () => VoiceCompanionState;
  setCompanion: Dispatch<SetStateAction<CompanionState>>;
  setVoice: Dispatch<SetStateAction<VoiceCompanionState>>;
};

declare global {
  interface Window {
    __NIMI_AVATAR_ACCEPTANCE_PROBE__?: AvatarAcceptanceProbe;
  }
}

let lastPresenceRequest: AcceptancePresenceState | null = null;

export function shouldInstallAvatarAcceptanceProbe(): boolean {
  return import.meta.env.DEV && import.meta.env['VITE_AVATAR_ACCEPTANCE_PROBE'] === '1';
}

function nowIso(): string {
  return new Date().toISOString();
}

function turnIdFor(state: AcceptancePresenceState): string {
  return `acceptance-${state}-turn`;
}

function resetCompanionForPresence(
  current: CompanionState,
  state: AcceptancePresenceState,
): CompanionState {
  const base: CompanionState = {
    ...current,
    inputVisible: false,
    draft: '',
    sendState: 'idle',
    sendError: null,
    unread: false,
  };
  if (state === 'assistant_speaking' || state === 'interrupted') {
    return {
      ...base,
      bubbleVisible: true,
      latestAssistantMessage: {
        text: state === 'interrupted'
          ? 'Reply interrupted for acceptance recording.'
          : 'Runtime is speaking through the embodied avatar.',
        at: nowIso(),
        messageId: `acceptance-${state}-message`,
        turnId: turnIdFor(state),
      },
    };
  }
  return {
    ...base,
    bubbleVisible: false,
  };
}

function voiceForPresence(
  current: VoiceCompanionState,
  state: AcceptancePresenceState,
): VoiceCompanionState {
  const base: VoiceCompanionState = {
    ...current,
    availability: state === 'blocked' ? 'blocked' : 'ready',
    availabilityMessage: state === 'blocked' ? 'acceptance probe blocked state' : null,
    panelVisible: false,
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

  if (state === 'foreground_listening') {
    return {
      ...base,
      panelVisible: true,
      status: 'listening',
      level: Math.max(0.55, current.level || 0),
      userCaption: {
        text: 'Foreground capture active',
        at: nowIso(),
        messageId: null,
        turnId: null,
        live: true,
      },
    };
  }

  if (state === 'turn_pending') {
    return {
      ...base,
      panelVisible: true,
      status: 'pending',
      awaitingReply: true,
      userCaption: {
        text: 'User turn submitted',
        at: nowIso(),
        messageId: null,
        turnId: null,
        live: false,
      },
    };
  }

  if (state === 'assistant_speaking') {
    return {
      ...base,
      panelVisible: true,
      status: 'replying',
      awaitingReply: true,
      currentTurnId: turnIdFor(state),
      assistantCaption: {
        text: 'Runtime is speaking through the embodied avatar.',
        at: nowIso(),
        messageId: `acceptance-${state}-message`,
        turnId: turnIdFor(state),
        live: true,
      },
      lipsyncActive: true,
      currentMouthOpenY: 0.72,
      audioArtifactId: 'acceptance-audio-artifact',
      audioPlaybackState: 'started',
    };
  }

  if (state === 'interrupted') {
    return {
      ...base,
      panelVisible: true,
      status: 'interrupted',
      interruptedTurnId: turnIdFor('assistant_speaking'),
      errorMessage: 'Current anchor reply was interrupted.',
      audioPlaybackState: 'interrupted',
    };
  }

  if (state === 'error') {
    return {
      ...base,
      panelVisible: true,
      status: 'error',
      availability: 'blocked',
      errorMessage: 'Acceptance probe error state.',
      audioPlaybackState: 'failed',
    };
  }

  return base;
}

export function installAvatarAcceptanceProbe(input: InstallAvatarAcceptanceProbeInput): () => void {
  if (!shouldInstallAvatarAcceptanceProbe()) {
    return () => {};
  }

  const probe: AvatarAcceptanceProbe = {
    setPresenceState(state) {
      lastPresenceRequest = state;
      input.setCompanion((current) => resetCompanionForPresence(current, state));
      input.setVoice((current) => voiceForPresence(current, state));
    },
    setVoiceLevel(level) {
      input.setVoice((current) => ({
        ...current,
        level: Math.max(0, Math.min(1, level)),
      }));
    },
    snapshot() {
      const companion = input.getCompanion();
      const voice = input.getVoice();
      return {
        presenceRequest: lastPresenceRequest,
        companion: {
          bubbleVisible: companion.bubbleVisible,
          inputVisible: companion.inputVisible,
          sendState: companion.sendState,
          hasAssistantCue: Boolean(companion.latestAssistantMessage),
        },
        voice: {
          availability: voice.availability,
          status: voice.status,
          level: voice.level,
          lipsyncActive: voice.lipsyncActive,
          audioPlaybackState: voice.audioPlaybackState,
        },
      };
    },
  };
  window.__NIMI_AVATAR_ACCEPTANCE_PROBE__ = probe;
  return () => {
    if (window.__NIMI_AVATAR_ACCEPTANCE_PROBE__ === probe) {
      delete window.__NIMI_AVATAR_ACCEPTANCE_PROBE__;
    }
  };
}
