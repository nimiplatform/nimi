import type { CompanionState } from '../companion-state.js';
import type { VoiceCompanionState } from '../voice-companion-state.js';

export type PresenceLifecycleStateId =
  | 'idle'
  | 'foreground_listening'
  | 'transcribing'
  | 'turn_pending'
  | 'assistant_speaking'
  | 'interrupted'
  | 'muted_or_audio_unavailable'
  | 'blocked'
  | 'error'
  | 'runtime_degraded'
  | 'wake_future_unadmitted';

export type PresenceVisualTone =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'pending'
  | 'replying'
  | 'interrupted'
  | 'error'
  | 'sending'
  | 'blocked'
  | 'audio-unavailable';

export type PresencePrivacyIndicator =
  | 'none'
  | 'mic_idle'
  | 'mic_active'
  | 'mic_blocked'
  | 'capture_processing'
  | 'speaker_active'
  | 'speaker_unavailable';

export type PresenceMicIntent = 'start_listening' | 'commit_listening' | 'disabled';

export type PresenceMachineInput = {
  companion: CompanionState;
  voice: VoiceCompanionState;
  bootstrapReady: boolean;
  bindingPresent: boolean;
  compositionReady?: boolean;
};

export type PresenceState = {
  stateId: PresenceLifecycleStateId;
  tone: PresenceVisualTone;
  labelKey: string;
  privacyIndicator: PresencePrivacyIndicator;
  micIntent: PresenceMicIntent;
  micDisabled: boolean;
  interruptVisible: boolean;
  speakerVisible: boolean;
  audioActive: boolean;
  audioUnavailable: boolean;
  captionsVisible: boolean;
  canStartForegroundCapture: boolean;
};

const LABEL_KEY_BY_TONE: Record<PresenceVisualTone, string> = {
  idle: 'Avatar.status.idle',
  listening: 'Avatar.status.listening',
  transcribing: 'Avatar.status.transcribing',
  pending: 'Avatar.status.pending',
  replying: 'Avatar.status.replying',
  interrupted: 'Avatar.status.interrupted',
  error: 'Avatar.status.error',
  sending: 'Avatar.status.sending',
  blocked: 'Avatar.status.blocked',
  'audio-unavailable': 'Avatar.status.audio_unavailable_short',
};

export function derivePresenceState(input: PresenceMachineInput): PresenceState {
  const { companion, voice, bootstrapReady, bindingPresent } = input;
  const compositionReady = input.compositionReady ?? true;
  const audioActive = voice.audioPlaybackState === 'requested'
    || voice.audioPlaybackState === 'started'
    || voice.lipsyncActive;
  const audioUnavailable = voice.audioPlaybackState === 'failed'
    || voice.audioPlaybackState === 'interrupted';
  const blocked = !compositionReady
    || !bootstrapReady
    || !bindingPresent
    || voice.availability === 'blocked';

  if (!compositionReady) {
    return makePresence({
      stateId: 'runtime_degraded',
      tone: 'blocked',
      privacyIndicator: 'none',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable,
    });
  }

  if (blocked) {
    return makePresence({
      stateId: 'blocked',
      tone: 'blocked',
      privacyIndicator: 'mic_blocked',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable,
    });
  }

  if (voice.status === 'error') {
    return makePresence({
      stateId: 'error',
      tone: 'error',
      privacyIndicator: 'mic_blocked',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable,
    });
  }

  if (voice.status === 'listening') {
    return makePresence({
      stateId: 'foreground_listening',
      tone: 'listening',
      privacyIndicator: 'mic_active',
      micIntent: 'commit_listening',
      audioActive,
      audioUnavailable,
    });
  }

  if (voice.status === 'transcribing') {
    return makePresence({
      stateId: 'transcribing',
      tone: 'transcribing',
      privacyIndicator: 'capture_processing',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable,
    });
  }

  if (companion.sendState === 'sending') {
    return makePresence({
      stateId: 'turn_pending',
      tone: 'sending',
      privacyIndicator: 'capture_processing',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable,
    });
  }

  if (voice.status === 'pending') {
    return makePresence({
      stateId: 'turn_pending',
      tone: 'pending',
      privacyIndicator: 'capture_processing',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable,
    });
  }

  if (voice.status === 'replying' || audioActive) {
    return makePresence({
      stateId: 'assistant_speaking',
      tone: 'replying',
      privacyIndicator: 'speaker_active',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable,
      interruptVisible: voice.status === 'replying',
    });
  }

  if (voice.status === 'interrupted') {
    return makePresence({
      stateId: 'interrupted',
      tone: 'interrupted',
      privacyIndicator: 'speaker_unavailable',
      micIntent: 'disabled',
      audioActive,
      audioUnavailable: true,
    });
  }

  if (audioUnavailable) {
    return makePresence({
      stateId: 'muted_or_audio_unavailable',
      tone: 'audio-unavailable',
      privacyIndicator: 'speaker_unavailable',
      micIntent: 'start_listening',
      audioActive,
      audioUnavailable,
    });
  }

  return makePresence({
    stateId: 'idle',
    tone: 'idle',
    privacyIndicator: 'mic_idle',
    micIntent: 'start_listening',
    audioActive,
    audioUnavailable,
  });
}

function makePresence(input: {
  stateId: PresenceLifecycleStateId;
  tone: PresenceVisualTone;
  privacyIndicator: PresencePrivacyIndicator;
  micIntent: PresenceMicIntent;
  audioActive: boolean;
  audioUnavailable: boolean;
  interruptVisible?: boolean;
}): PresenceState {
  const interruptVisible = input.interruptVisible ?? false;
  const micDisabled = input.micIntent === 'disabled';
  return {
    stateId: input.stateId,
    tone: input.tone,
    labelKey: LABEL_KEY_BY_TONE[input.tone],
    privacyIndicator: input.privacyIndicator,
    micIntent: input.micIntent,
    micDisabled,
    interruptVisible,
    speakerVisible: !interruptVisible,
    audioActive: input.audioActive,
    audioUnavailable: input.audioUnavailable,
    captionsVisible:
      input.stateId === 'foreground_listening'
      || input.stateId === 'transcribing'
      || input.stateId === 'turn_pending'
      || input.stateId === 'assistant_speaking',
    canStartForegroundCapture: input.micIntent === 'start_listening' && !micDisabled,
  };
}
