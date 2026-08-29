import type {
  NimiAgentRealtimeEvent,
  NimiAgentRealtimeLifecycle,
  NimiAgentRealtimeSessionAction,
  NimiAgentRealtimeSessionState,
  NimiLocalAppAgentHandle,
  NimiRealtimeControlStatus,
} from './types.js';

// @nimi-authority: rule.nimi.sdks.client-core.r030
// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-080
export function createNimiAgentRealtimeSessionState(input: {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId?: string;
}): NimiAgentRealtimeSessionState {
  return freezeState({
    sessionEpoch: 0,
    agentHandle: input.agentHandle,
    conversationAnchorId: input.conversationAnchorId ?? null,
    lifecycle: 'idle',
    capture: 'idle',
    playback: 'idle',
    pressure: 'normal',
    control: null,
    negotiatedInputAudio: null,
    negotiatedOutputAudio: null,
    activeOutputTrackIds: [],
    error: null,
  });
}

export function reduceNimiAgentRealtimeSessionState(
  state: NimiAgentRealtimeSessionState,
  action: NimiAgentRealtimeSessionAction,
): NimiAgentRealtimeSessionState {
  if (action.type === 'open-requested') {
    if (action.epoch <= state.sessionEpoch) return state;
    return freezeState({
      ...state,
      sessionEpoch: action.epoch,
      lifecycle: 'opening',
      capture: 'idle',
      playback: 'idle',
      pressure: 'normal',
      control: null,
      negotiatedInputAudio: null,
      negotiatedOutputAudio: null,
      activeOutputTrackIds: [],
      error: null,
    });
  }

  if (action.type === 'close-requested') {
    if (action.epoch <= state.sessionEpoch) return state;
    return freezeState({
      ...state,
      sessionEpoch: action.epoch,
      lifecycle: 'closing',
      capture: state.capture === 'idle' ? 'idle' : 'stopped',
      playback: 'idle',
      pressure: 'normal',
      control: null,
      negotiatedInputAudio: null,
      negotiatedOutputAudio: null,
      activeOutputTrackIds: [],
      error: null,
    });
  }

  if (action.epoch !== state.sessionEpoch) return state;

  switch (action.type) {
    case 'open-succeeded':
      return freezeState({
        ...state,
        conversationAnchorId: action.result.conversationAnchorId,
        lifecycle: lifecycleFromControl(action.result.control),
        pressure: action.result.control.backpressure,
        control: action.result.control,
        negotiatedInputAudio: action.result.negotiatedInputAudio,
        negotiatedOutputAudio: action.result.negotiatedOutputAudio,
        error: null,
      });
    case 'control-observed':
      return freezeState({
        ...state,
        lifecycle: lifecycleFromControl(action.control),
        pressure: action.control.backpressure,
        control: action.control,
        ...(action.control.lifecycle === 'closed' || action.control.lifecycle === 'failed'
          ? {
            capture: state.capture === 'idle' ? 'idle' : 'stopped' as const,
            playback: 'idle' as const,
            activeOutputTrackIds: [],
          }
          : {}),
      });
    case 'event-observed':
      return reduceEvent(state, action.event);
    case 'capture-requested':
      return freezeState({
        ...state,
        capture: 'requesting',
        error: state.error?.source === 'sdk' ? null : state.error,
      });
    case 'capture-started':
      return freezeState({ ...state, capture: 'active', error: null });
    case 'capture-stopped':
      return freezeState({ ...state, capture: action.state });
    case 'capture-unavailable':
      return freezeState({
        ...state,
        capture: action.state,
        error: action.error,
      });
    case 'playback-failed':
      return freezeState({
        ...state,
        playback: 'unavailable',
        error: action.error,
      });
    case 'operation-failed':
      return freezeState({
        ...state,
        lifecycle: action.terminal ? 'failed' : state.lifecycle,
        capture: action.terminal && state.capture !== 'idle' ? 'stopped' : state.capture,
        playback: action.terminal ? 'idle' : state.playback,
        activeOutputTrackIds: action.terminal ? [] : state.activeOutputTrackIds,
        error: action.error,
      });
    case 'issue-cleared':
      return freezeState({ ...state, error: null });
    case 'closed':
      return freezeState({
        ...state,
        lifecycle: 'closed',
        capture: state.capture === 'idle' ? 'idle' : 'stopped',
        playback: 'idle',
        pressure: 'normal',
        control: null,
        negotiatedInputAudio: null,
        negotiatedOutputAudio: null,
        activeOutputTrackIds: [],
      });
    default:
      return state;
  }
}

function reduceEvent(
  state: NimiAgentRealtimeSessionState,
  event: NimiAgentRealtimeEvent,
): NimiAgentRealtimeSessionState {
  if (event.type === 'audio-frame') {
    return freezeState({
      ...state,
      playback: state.playback === 'unavailable' ? 'unavailable' : 'playing',
      activeOutputTrackIds: addTrack(state.activeOutputTrackIds, event.outputTrackId),
    });
  }
  if (event.type === 'output-track') {
    return freezeState({
      ...state,
      playback: event.lifecycle === 'active'
        ? state.playback === 'unavailable' ? 'unavailable' : 'playing'
        : removeTrack(state.activeOutputTrackIds, event.outputTrackId).length === 0
          ? 'idle'
          : state.playback,
      activeOutputTrackIds: event.lifecycle === 'active'
        ? addTrack(state.activeOutputTrackIds, event.outputTrackId)
        : removeTrack(state.activeOutputTrackIds, event.outputTrackId),
    });
  }
  if (event.type === 'terminal') {
    return freezeState({
      ...state,
      lifecycle: state.control?.lifecycle === 'closed' ? 'closed' : 'failed',
      capture: state.capture === 'idle' ? 'idle' : 'stopped',
      playback: 'idle',
      activeOutputTrackIds: [],
      error: state.error,
    });
  }
  return state;
}

function lifecycleFromControl(
  control: NimiRealtimeControlStatus,
): NimiAgentRealtimeLifecycle {
  return control.lifecycle;
}

function addTrack(tracks: readonly string[], trackId: string): readonly string[] {
  return tracks.includes(trackId) ? tracks : Object.freeze([...tracks, trackId]);
}

function removeTrack(tracks: readonly string[], trackId: string): readonly string[] {
  return Object.freeze(tracks.filter((value) => value !== trackId));
}

function freezeState(
  state: NimiAgentRealtimeSessionState,
): NimiAgentRealtimeSessionState {
  return Object.freeze({
    ...state,
    activeOutputTrackIds: Object.freeze([...state.activeOutputTrackIds]),
  });
}
