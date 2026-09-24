import type {
  NimiAgentRealtimeEvent,
  NimiAgentRealtimeSessionState,
} from '@nimiplatform/kit/features/agent-realtime';

/**
 * NimiDay's voice call is a thin view over the Kit Agent Realtime session:
 * the session owns media, Runtime scope and failure state; this module only
 * keeps the captions and decides when a hands-free call may listen again.
 */

export type Caption = {
  readonly key: string;
  readonly who: 'you' | 'agent';
  readonly text: string;
  readonly final: boolean;
};

export type CallView = {
  readonly captions: readonly Caption[];
  readonly userSpeaking: boolean;
  /** The user finished an utterance (or typed) and the Agent turn has not ended yet. */
  readonly turnPending: boolean;
};

export const MAX_CAPTIONS = 24;

export const initialCallView: CallView = Object.freeze({ captions: [], userSpeaking: false, turnPending: false });

function upsert(captions: readonly Caption[], next: Caption): readonly Caption[] {
  const index = captions.findIndex((caption) => caption.key === next.key);
  const merged = index === -1 ? [...captions, next] : captions.map((caption, position) => (position === index ? next : caption));
  return merged.length > MAX_CAPTIONS ? merged.slice(merged.length - MAX_CAPTIONS) : merged;
}

function mergePartial(previous: string | undefined, incoming: string): string {
  if (!previous) return incoming;
  // Providers send partial transcripts either cumulatively or as deltas.
  return incoming.startsWith(previous) ? incoming : previous + incoming;
}

export function finalizeAll(captions: readonly Caption[]): readonly Caption[] {
  return captions.some((caption) => !caption.final) ? captions.map((caption) => (caption.final ? caption : { ...caption, final: true })) : captions;
}

export function applyRealtimeEvent(view: CallView, event: NimiAgentRealtimeEvent): CallView {
  switch (event.type) {
    case 'speech-status':
      return { ...view, userSpeaking: event.state === 'started' };
    case 'transcript': {
      const key = `you:${event.utteranceId}`;
      const existing = view.captions.find((caption) => caption.key === key);
      if (event.final) {
        const text = event.text.trim();
        const captions = text
          ? upsert(view.captions, { key, who: 'you', text, final: true })
          : view.captions.filter((caption) => caption.key !== key);
        return { captions, userSpeaking: false, turnPending: text ? true : view.turnPending };
      }
      return { ...view, captions: upsert(view.captions, { key, who: 'you', text: mergePartial(existing?.text, event.text), final: false }) };
    }
    case 'text-output': {
      const key = `agent:${event.outputTrackId}`;
      const existing = view.captions.find((caption) => caption.key === key);
      // Runtime streams deltas and then repeats the complete text once as final.
      const text = event.final ? event.text : (existing?.text ?? '') + event.text;
      if (!text) return view;
      return { ...view, captions: upsert(view.captions, { key, who: 'agent', text, final: event.final }) };
    }
    case 'output-track': {
      if (event.lifecycle === 'active') return view;
      const key = `agent:${event.outputTrackId}`;
      return { ...view, captions: view.captions.map((caption) => (caption.key === key && !caption.final ? { ...caption, final: true } : caption)) };
    }
    case 'terminal':
      return { captions: finalizeAll(view.captions), userSpeaking: false, turnPending: false };
    default:
      return view;
  }
}

export function markTyped(view: CallView, requestId: string, text: string): CallView {
  return { ...view, captions: upsert(view.captions, { key: `typed:${requestId}`, who: 'you', text, final: true }), turnPending: true };
}

export type CallPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'you-speaking'
  | 'thinking'
  | 'agent-speaking'
  | 'muted'
  | 'reconnecting'
  | 'ended'
  | 'failed';

export function callPhase(state: NimiAgentRealtimeSessionState, view: CallView): CallPhase {
  switch (state.lifecycle) {
    case 'idle':
      return 'idle';
    case 'opening':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'closing':
    case 'closed':
      return 'ended';
    case 'failed':
      return 'failed';
    default:
      break;
  }
  if (state.activeOutputTrackIds.length > 0) return 'agent-speaking';
  if (view.turnPending) return 'thinking';
  if (state.capture === 'active' || state.capture === 'requesting') return view.userSpeaking ? 'you-speaking' : 'listening';
  return 'muted';
}

/** A hands-free call listens again once the Agent has finished its turn and stopped talking. */
export function shouldListenAgain(input: {
  readonly state: NimiAgentRealtimeSessionState;
  readonly view: CallView;
  readonly micWanted: boolean;
}): boolean {
  const { state, view, micWanted } = input;
  return micWanted
    && state.lifecycle === 'ready'
    && (state.capture === 'idle' || state.capture === 'stopped')
    && state.pressure === 'normal'
    && state.negotiatedInputAudio !== null
    && !view.turnPending
    && state.activeOutputTrackIds.length === 0;
}

export type MicProblem = 'permission' | 'missing' | 'lost' | null;

export function micProblem(state: NimiAgentRealtimeSessionState): MicProblem {
  if (state.capture === 'permission-denied') return 'permission';
  if (state.capture === 'device-unavailable') return 'missing';
  if (state.capture === 'device-lost') return 'lost';
  return null;
}
