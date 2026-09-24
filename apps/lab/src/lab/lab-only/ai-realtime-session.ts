import type {
  NimiAiRealtimeClient,
  NimiAiRealtimeEvent,
  NimiRealtimeAudioFormat,
  NimiRealtimeControlStatus,
} from '@nimiplatform/sdk/app';
import type { StudioSessionSummary } from '../../ai-studio-core/runtime-types.js';
import { t } from '../../shell/i18n/index.js';

// Open always declares a legal input format, even for a text-only test:
// 16 kHz mono PCM S16LE in 20 ms frames of 640 bytes.
export const LAB_AI_REALTIME_INPUT_AUDIO: NimiRealtimeAudioFormat = Object.freeze({
  codec: 'pcm-s16le',
  sampleRateHz: 16_000,
  channelCount: 1,
  frameDurationMs: 20,
  maximumFrameBytes: 640,
});

export type LabRealtimeOwnerControl = 'commit-input' | 'start-response' | 'continue-response' | 'pause-response' | 'cancel-response';
type Scope = { readonly realtimeSessionId: string; readonly generation: string };

export type LabRealtimeOutputTrack = {
  readonly outputTrackId: string;
  readonly requestId: string;
  readonly text: string;
  readonly audioFrames: number;
  readonly lifecycle: 'active' | 'interrupted' | 'completed' | 'failed';
  readonly reasonCode: string;
};

export type LabRealtimeLogEntry = { readonly index: number; readonly kind: string; readonly detail: string };

export type LabRealtimeState = {
  readonly phase: 'idle' | 'opening' | 'open' | 'closing' | 'closed' | 'terminated';
  readonly scope?: Scope;
  readonly control?: NimiRealtimeControlStatus;
  readonly negotiatedInputAudio?: NimiRealtimeAudioFormat;
  readonly negotiatedOutputAudio?: NimiRealtimeAudioFormat | null;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly terminalReason?: string;
  readonly error?: string;
  readonly tracks: readonly LabRealtimeOutputTrack[];
  readonly transcripts: readonly { readonly utteranceId: string; readonly text: string; readonly final: boolean }[];
  readonly log: readonly LabRealtimeLogEntry[];
  readonly observed: Readonly<Record<string, number>>;
};

const MAX_LOG_ENTRIES = 200;

function describeError(error: unknown): string {
  const reasonCode = error && typeof error === 'object' ? (error as { reasonCode?: unknown }).reasonCode : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return typeof reasonCode === 'string' && reasonCode ? `${message} (${reasonCode})` : message;
}

function reasonCodeOf(error: unknown, fallback: string): string {
  const value = error && typeof error === 'object' ? (error as { reasonCode?: unknown }).reasonCode : undefined;
  return typeof value === 'string' && value ? value : fallback;
}

// The event log keeps protocol identifiers verbatim; only the words around them are translated.
const LOG = 'CapabilityTests.aiRealtime.log';

function ackDetail(ack: { readonly ok: boolean; readonly reasonCode: string; readonly actionHint: string }): string {
  if (ack.ok) return t(`${LOG}.ack`);
  return ack.actionHint
    ? t(`${LOG}.rejectedWithHint`, { reasonCode: ack.reasonCode, hint: ack.actionHint })
    : t(`${LOG}.rejected`, { reasonCode: ack.reasonCode });
}

function eventDetail(event: NimiAiRealtimeEvent): string {
  switch (event.type) {
    case 'opened': return t(event.outputAudio ? `${LOG}.openedWithAudio` : `${LOG}.opened`, { turnDetection: event.turnDetection });
    case 'input-accepted': return event.requestId
      ? t(`${LOG}.inputRequest`, { requestId: event.requestId })
      : t(`${LOG}.inputFrame`, { track: event.inputTrackId, sequence: event.frameSequence });
    case 'speech-status': return `${event.utteranceId} ${event.state}`;
    case 'transcript': return t(event.final ? `${LOG}.transcriptFinal` : `${LOG}.transcriptPartial`, { text: event.text });
    case 'text-output': return event.final ? t(`${LOG}.textOutputFinal`, { track: event.outputTrackId, text: event.text }) : `${event.outputTrackId}: ${event.text}`;
    case 'audio-frame': return t(`${LOG}.audioFrame`, { track: event.outputTrackId, sequence: event.frameSequence, bytes: event.frame.byteLength });
    case 'output-track': return `${event.outputTrackId} ${event.lifecycle}${event.reasonCode ? ` (${event.reasonCode})` : ''}`;
    case 'request-terminal': return `${event.requestId} ${event.finishReason}${event.reasonCode ? ` (${event.reasonCode})` : ''}`;
    case 'session-terminal': return event.reasonCode;
    case 'failure': return event.requestId || event.outputTrackId
      ? `${event.requestId || event.outputTrackId}: ${event.reasonCode}`
      : t(`${LOG}.failureSession`, { reasonCode: event.reasonCode });
  }
}

export type LabRealtimePlayback = {
  readonly writeAudioFrame: (input: { readonly outputTrackId: string; readonly frameSequence: string; readonly frame: Uint8Array; readonly format: NimiRealtimeAudioFormat }) => Promise<void>;
  readonly finishOutputTrack: (input: { readonly outputTrackId: string; readonly lifecycle: 'interrupted' | 'completed' | 'failed' }) => Promise<void>;
  readonly interruptOutputTrack: (input: { readonly outputTrackId: string }) => Promise<void>;
};

/**
 * Direct App AI Realtime Session for Lab tests. It never selects an Agent or
 * Agent conversation; the App AIConfig route decides whether Open is admitted,
 * and an ended event stream is reported as its terminal reason, not success.
 */
export function createLabRealtimeController(input: {
  readonly client: NimiAiRealtimeClient;
  readonly now: () => Date;
  readonly createId: (prefix: string) => string;
  readonly onState: (state: LabRealtimeState) => void;
  readonly playback?: LabRealtimePlayback;
}) {
  let state: LabRealtimeState = { phase: 'idle', tracks: [], transcripts: [], log: [], observed: {} };
  let logIndex = 0;
  let cancelSubscription: (() => Promise<void>) | null = null;
  // Close cannot cancel an Open already sent to the owner. A close requested
  // before Open returns is kept here, and the Open flow closes the Session the
  // owner returns instead of leaving it open with nobody holding it.
  let closeRequested = false;
  let pendingOpen: Promise<void> | null = null;
  let pendingClose: Promise<void> | null = null;
  const set = (patch: Partial<LabRealtimeState>) => {
    state = { ...state, ...patch };
    input.onState(state);
  };
  const count = (kind: string, delta = 1) => {
    set({ observed: { ...state.observed, [kind]: (state.observed[kind] ?? 0) + delta } });
  };
  const log = (kind: string, detail: string) => {
    logIndex += 1;
    set({ log: [...state.log, { index: logIndex, kind, detail }].slice(-MAX_LOG_ENTRIES) });
  };
  const finish = (phase: 'closed' | 'terminated', terminalReason: string, error?: string) => {
    if (state.phase === 'closed' || state.phase === 'terminated') return;
    set({ phase, terminalReason, endedAt: input.now().toISOString(), ...(error ? { error } : {}) });
  };
  const track = (outputTrackId: string, requestId: string, patch: (current: LabRealtimeOutputTrack) => Partial<LabRealtimeOutputTrack>) => {
    const existing = state.tracks.find((entry) => entry.outputTrackId === outputTrackId)
      ?? { outputTrackId, requestId, text: '', audioFrames: 0, lifecycle: 'active' as const, reasonCode: '' };
    const next = { ...existing, ...patch(existing) };
    set({ tracks: state.tracks.some((entry) => entry.outputTrackId === outputTrackId)
      ? state.tracks.map((entry) => entry.outputTrackId === outputTrackId ? next : entry)
      : [...state.tracks, next] });
  };
  const requireScope = (): Scope => {
    if (state.phase !== 'open' || !state.scope) throw new Error(t('CapabilityTests.aiRealtime.notOpen'));
    return state.scope;
  };
  const operation = (kind: string, result: { readonly ack: { readonly ok: boolean; readonly reasonCode: string; readonly actionHint: string }; readonly control: NimiRealtimeControlStatus }) => {
    set({ control: result.control });
    log(kind, ackDetail(result.ack));
    if (!result.ack.ok) throw Object.assign(new Error(t('CapabilityTests.aiRealtime.notAcknowledged', { operation: kind })), { reasonCode: result.ack.reasonCode });
    return result;
  };

  const apply = async (event: NimiAiRealtimeEvent) => {
    count(event.type);
    log(event.type, eventDetail(event));
    if (event.type === 'text-output') {
      // Deltas append; the final event carries the complete text of the track.
      track(event.outputTrackId, event.requestId, (current) => ({ text: event.final ? event.text : current.text + event.text }));
    } else if (event.type === 'audio-frame') {
      track(event.outputTrackId, event.requestId, (current) => ({ audioFrames: current.audioFrames + 1 }));
      await input.playback?.writeAudioFrame({ outputTrackId: event.outputTrackId, frameSequence: event.frameSequence, frame: event.frame, format: event.format }).catch(() => undefined);
    } else if (event.type === 'output-track') {
      track(event.outputTrackId, event.requestId, () => ({ lifecycle: event.lifecycle, reasonCode: event.reasonCode }));
      if (event.lifecycle !== 'active') {
        await input.playback?.finishOutputTrack({ outputTrackId: event.outputTrackId, lifecycle: event.lifecycle }).catch(() => undefined);
      }
    } else if (event.type === 'transcript') {
      const transcripts = state.transcripts.filter((entry) => entry.utteranceId !== event.utteranceId || entry.final);
      set({ transcripts: [...transcripts, { utteranceId: event.utteranceId, text: event.text, final: event.final }] });
    } else if (event.type === 'session-terminal' && state.phase !== 'closing') {
      finish('terminated', event.reasonCode || 'session-terminal');
    }
  };

  const pump = async (subscription: AsyncIterable<{ readonly control: NimiRealtimeControlStatus; readonly event: NimiAiRealtimeEvent }>, scope: Scope) => {
    try {
      for await (const envelope of subscription) {
        if (state.scope !== scope) return;
        set({ control: envelope.control });
        await apply(envelope.event);
        if ((envelope.control.lifecycle === 'closed' || envelope.control.lifecycle === 'failed') && state.phase === 'open') {
          finish('terminated', envelope.control.terminalReason || envelope.control.lifecycle);
        }
      }
      if (state.phase === 'open' && state.scope === scope) finish('terminated', state.control?.terminalReason || 'event-stream-ended');
    } catch (error) {
      if (state.phase === 'open' && state.scope === scope) finish('terminated', reasonCodeOf(error, 'event-stream-failed'), describeError(error));
    }
  };

  const closeScope = async (scope: Scope, fallbackReason: string) => {
    set({ phase: 'closing', scope });
    try {
      const result = await input.client.close(scope);
      set({ control: result.control });
      log('close', result.ack.ok
        ? t(`${LOG}.ackWithReason`, { reason: result.control.terminalReason || result.control.lifecycle })
        : t(`${LOG}.rejected`, { reasonCode: result.ack.reasonCode }));
      finish('closed', result.control.terminalReason || fallbackReason);
    } catch (error) {
      finish('terminated', reasonCodeOf(error, 'close-failed'), describeError(error));
      throw error;
    } finally {
      await cancelSubscription?.().catch(() => undefined);
      cancelSubscription = null;
    }
  };

  type OpenOptions = { readonly instruction: string; readonly turnDetection: 'server-vad' | 'manual'; readonly audioOutputEnabled: boolean };
  const openFlow = async (options: OpenOptions) => {
    let opened;
    try {
      opened = await input.client.open({
        inputAudio: LAB_AI_REALTIME_INPUT_AUDIO,
        audioOutputEnabled: options.audioOutputEnabled,
        turnDetection: options.turnDetection,
        initialInstruction: options.instruction.trim(),
      });
    } catch (error) {
      finish('terminated', reasonCodeOf(error, 'open-failed'), describeError(error));
      throw error;
    }
    const scope = { realtimeSessionId: opened.realtimeSessionId, generation: opened.generation };
    log('open', t(`${LOG}.sessionOpened`, { id: opened.realtimeSessionId, generation: opened.generation }));
    if (closeRequested) {
      count('closed-during-open');
      // A failed close is already recorded in the terminal state.
      await closeScope(scope, 'closed-during-open').catch(() => undefined);
      return;
    }
    set({ phase: 'open', scope, control: opened.control, negotiatedInputAudio: opened.negotiatedInputAudio, negotiatedOutputAudio: opened.negotiatedOutputAudio });
    let subscription;
    try {
      subscription = await input.client.subscribe(scope);
    } catch (error) {
      // A close that started meanwhile owns the Session's end.
      if (state.phase !== 'open' || state.scope !== scope) return;
      finish('terminated', reasonCodeOf(error, 'subscribe-failed'), describeError(error));
      await input.client.close(scope).catch(() => undefined);
      throw error;
    }
    if (state.phase !== 'open' || state.scope !== scope) {
      await subscription.cancel().catch(() => undefined);
      return;
    }
    cancelSubscription = () => subscription.cancel();
    void pump(subscription, scope);
  };

  return {
    getState: () => state,
    async open(options: OpenOptions): Promise<void> {
      // Closed before Open was sent: the owner is never contacted.
      if (state.phase === 'closed' && state.terminalReason === 'closed-before-open') return;
      if (state.phase !== 'idle') throw new Error(t('CapabilityTests.aiRealtime.alreadyUsed'));
      set({ phase: 'opening', startedAt: input.now().toISOString() });
      pendingOpen = openFlow(options);
      try {
        await pendingOpen;
      } finally {
        pendingOpen = null;
      }
    },
    // A text turn is one conversation input plus an explicit response start.
    async sendText(text: string): Promise<string> {
      const scope = requireScope();
      const requestId = input.createId('lab-text');
      operation('append-text', await input.client.appendInput({ ...scope, input: { type: 'text', requestId, text } }));
      count('text-input');
      operation('start-response', await input.client.submitOwnerControl({ ...scope, requestId, control: 'start-response' }));
      count('owner-control');
      return requestId;
    },
    async appendAudioFrame(frame: { readonly inputTrackId: string; readonly utteranceId: string; readonly frameSequence: string; readonly frame: Uint8Array }): Promise<void> {
      const scope = requireScope();
      const result = await input.client.appendInput({ ...scope, input: { type: 'audio-frame', ...frame } });
      set({ control: result.control });
      if (!result.ack.ok) throw Object.assign(new Error(t('CapabilityTests.aiRealtime.audioFrameNotAcknowledged')), { reasonCode: result.ack.reasonCode });
      count('audio-frame-input');
    },
    async ownerControl(control: LabRealtimeOwnerControl): Promise<void> {
      const scope = requireScope();
      operation(control, await input.client.submitOwnerControl({ ...scope, requestId: input.createId('lab-control'), control }));
      count('owner-control');
    },
    async interrupt(outputTrackId: string): Promise<void> {
      const scope = requireScope();
      operation('interrupt', await input.client.interruptOutput({ ...scope, outputTrackId }));
      await input.playback?.interruptOutputTrack({ outputTrackId }).catch(() => undefined);
      count('interrupt');
    },
    // While Open is pending this resolves once the returned Session is closed.
    async close(): Promise<void> {
      if (pendingClose) return pendingClose;
      if (state.phase === 'closed' || state.phase === 'terminated') return;
      closeRequested = true;
      if (state.phase === 'opening' && pendingOpen) {
        set({ phase: 'closing' });
        pendingClose = pendingOpen.then(() => undefined, () => undefined);
      } else if (state.scope) {
        pendingClose = closeScope(state.scope, 'closed-by-user');
      } else {
        finish('closed', 'closed-before-open');
        return;
      }
      return pendingClose;
    },
  };
}

export type LabRealtimeController = ReturnType<typeof createLabRealtimeController>;

export function labRealtimeSessionSummary(state: LabRealtimeState): StudioSessionSummary {
  return {
    capabilityContract: 'realtime.interact',
    startedAt: state.startedAt ?? new Date(0).toISOString(),
    endedAt: state.endedAt ?? state.startedAt ?? new Date(0).toISOString(),
    ending: state.phase === 'closed' ? 'closed' : 'terminated',
    terminalReason: state.terminalReason ?? 'unknown',
    observed: Object.fromEntries(Object.entries(state.observed).filter(([key]) => /^[a-z][a-z0-9-]{0,63}$/u.test(key)).slice(0, 32)),
  };
}
