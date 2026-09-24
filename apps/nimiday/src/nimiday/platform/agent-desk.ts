// The on-duty agent, through the public Local App agent.local surface only.
// Runtime owns the agent, its single Conversation and every committed turn;
// NimiDay keeps a projection for display and correlates its own work items.

import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReference,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationMessage,
  NimiLocalAppConversationSubscription,
} from '@nimiplatform/sdk/app';
import type { Appointment } from '../domain/types.js';
import { conversationWorkApi, toSdkWork, type ConversationWorkApi, type WorkSendInput } from './conversation-work.js';

export type AgentRef = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  /** App-scoped durable correlation, when the Runtime provides one. */
  readonly binding: string | null;
};

export type DeskPhase =
  | 'idle'
  | 'loading'
  | 'unavailable'
  | 'no-agents'
  | 'choose'
  | 'opening'
  | 'ready';

export type DeskMessage = {
  readonly id: string;
  readonly turnId: string;
  /** `app` marks a request an App started on its own (a routine), never user speech. */
  readonly role: 'user' | 'assistant' | 'app';
  readonly text: string;
  readonly images: readonly { readonly artifactId: string; readonly mimeType: string; readonly name: string | null }[];
};

export type LiveTool = {
  readonly turnId: string;
  readonly toolId: string;
  readonly name: string;
  readonly lifecycle: 'started' | 'updated' | 'completed' | 'failed';
};

export type TurnOutcome = {
  readonly turnId: string;
  readonly kind: 'completed' | 'failed' | 'interrupted';
  readonly detail: string | null;
};

export type DeskState = {
  readonly phase: DeskPhase;
  readonly references: readonly AgentRef[];
  readonly agent: AgentRef | null;
  /** The appointment kept in NimiDay that could not be matched automatically. */
  readonly awaitingConfirmation: Appointment | null;
  /** The on-duty agent was found, but their conversation could not be opened right now. */
  readonly unreachable: AgentRef | null;
  /** An appointment (kept, or just chosen) is on its way to being ready; who is on duty is not settled yet. */
  readonly restoring: boolean;
  readonly anchorId: string | null;
  readonly messages: readonly DeskMessage[];
  readonly truncatedBefore: boolean;
  readonly activeTurnId: string | null;
  readonly streaming: { readonly turnId: string; readonly text: string } | null;
  readonly liveTools: readonly LiveTool[];
  readonly lastOutcome: TurnOutcome | null;
  readonly connection: 'live' | 'reconnecting' | 'lost';
  readonly error: string | null;
  readonly canUseWork: boolean;
};

export type TurnScope = { readonly agentHandle: NimiLocalAppAgentHandle; readonly conversationAnchorId: string };

export type SendResult =
  /** `scope`: the agent and conversation the turn was sent to, which own it for its whole life. */
  | { readonly ok: true; readonly turnId: string; readonly scope: TurnScope }
  | { readonly ok: false; readonly reason: 'busy' | 'not-ready' | 'failed'; readonly message: string };

export type DeskEventListener = (event: NimiLocalAppConversationEvent) => void;

export type SpeakResult =
  | { readonly ok: true; readonly finished: Promise<void> }
  | { readonly ok: false; readonly reason: 'voice-unavailable' | 'not-ready' | 'failed'; readonly code: string };

type DeskClient = Pick<NimiLocalAppClient, 'agents' | 'conversation'>;

/** Phases on the way to an outcome. */
const SETTLING_PHASES: ReadonlySet<DeskPhase> = new Set(['idle', 'loading', 'opening']);

const INITIAL: DeskState = {
  phase: 'idle',
  references: [],
  agent: null,
  awaitingConfirmation: null,
  unreachable: null,
  restoring: false,
  anchorId: null,
  messages: [],
  truncatedBefore: false,
  activeTurnId: null,
  streaming: null,
  liveTools: [],
  lastOutcome: null,
  connection: 'live',
  error: null,
  canUseWork: false,
};

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as { reasonCode?: unknown; code?: unknown };
  return String(record.reasonCode ?? record.code ?? '');
}

function isOverflow(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { retryable?: unknown; code?: unknown; reasonCode?: unknown; details?: { retryable?: unknown } };
  const retryable = record.retryable === true || record.details?.retryable === true;
  return retryable && (record.code === 'resource-exhausted' || record.reasonCode === 'renderer-local-app-conversation-buffer-exhausted');
}

/** A handle from an earlier session, account or Runtime generation is no longer valid. */
export function isStaleSelector(error: unknown): boolean {
  const code = errorCode(error).toLowerCase();
  return code === 'local-app-access-denied' || code === 'local_app_access_denied'
    || code.includes('session-revoked') || code.includes('account-changed') || code.includes('runtime-restarted');
}

/** Runtime rejects a second turn while one is active (typed as AGENT_BUSY / agent-busy). */
function isBusy(error: unknown): boolean {
  return /already has an active turn/iu.test(errorText(error, ''))
    || errorCode(error).toLowerCase().replace('_', '-').includes('agent-busy');
}

function toRef(reference: NimiLocalAppAgentReference): AgentRef {
  return {
    agentHandle: reference.agentHandle,
    displayName: reference.displayName,
    avatarUrl: reference.avatarUrl,
    binding: reference.agentBinding || null,
  };
}

function project(message: NimiLocalAppConversationMessage): DeskMessage {
  return {
    id: message.messageId,
    turnId: message.turnId,
    role: message.role,
    text: message.parts.filter((part) => part.kind === 'text').map((part) => (part.kind === 'text' ? part.text : '')).join('\n'),
    images: message.parts.flatMap((part) => (part.kind === 'artifact-ref'
      ? [{ artifactId: part.artifactId, mimeType: part.mimeType, name: part.displayName }]
      : [])),
  };
}

function parseSequence(value: string): bigint | null {
  return /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}

type ActiveSession = {
  readonly epoch: number;
  readonly agent: AgentRef;
  readonly anchorId: string;
  subscription: NimiLocalAppConversationSubscription;
  pending: NimiLocalAppConversationEvent[];
  initialized: boolean;
  recovering: boolean;
  through: bigint;
};

export type AgentDesk = {
  readonly getState: () => DeskState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly onEvent: (listener: DeskEventListener) => () => void;
  /** List current agents and restore the appointment when it can be matched safely. */
  readonly start: (appointment: Appointment | null) => Promise<void>;
  readonly appoint: (agentHandle: NimiLocalAppAgentHandle) => Promise<AgentRef | null>;
  /** Re-list the account's agents without touching the open conversation. */
  readonly refreshReferences: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  /**
   * The turn Runtime currently runs for this conversation, asked directly so a
   * missed terminal event cannot leave NimiDay waiting forever. `undefined`
   * when it cannot be asked right now.
   */
  readonly runtimeActiveTurn: () => Promise<string | null | undefined>;
  readonly send: (text: string, requestId: string) => Promise<SendResult>;
  readonly sendWork: (input: WorkSendInput) => Promise<SendResult>;
  readonly work: () => ConversationWorkApi | null;
  /**
   * Stop one turn NimiDay started. The conversation is shared with other Apps,
   * so NimiDay only ever names its own turn; a turn that already ended reports
   * `not-active` and is never retried as an untargeted stop.
   */
  readonly interrupt: (turnId: string) => Promise<'interrupted' | 'not-active' | 'failed'>;
  /** Whether NimiDay started this turn (as opposed to another App or Nimi itself). */
  readonly ownsTurn: (turnId: string | null) => boolean;
  readonly readImage: (artifactId: string) => Promise<string | null>;
  /** Resolves once playback starts; `finished` settles when it ends or is stopped. */
  readonly speak: (messageId: string, requestId: string) => Promise<SpeakResult>;
  readonly stopSpeaking: () => void;
  readonly transcribe: (input: { readonly requestId: string; readonly mimeType: string; readonly bytes: Uint8Array }) => Promise<string>;
  readonly dispose: () => Promise<void>;
};

export function createAgentDesk(client: DeskClient): AgentDesk {
  let state: DeskState = INITIAL;
  let epoch = 0;
  let active: ActiveSession | null = null;
  let disposed = false;
  let lastAppointment: Appointment | null = null;
  /** Turns this NimiDay session started; the only ones it may stop. */
  const ownTurns = new Set<string>();
  const listeners = new Set<() => void>();
  const eventListeners = new Set<DeskEventListener>();
  const imageUrls = new Map<string, string>();
  let audio: HTMLAudioElement | null = null;
  let audioUrl: string | null = null;
  const workApi = conversationWorkApi(client.conversation);

  const publish = (patch: Partial<DeskState>) => {
    const next = { ...state, ...patch };
    // Once the desk settles on any outcome, nothing is being restored any more.
    state = SETTLING_PHASES.has(next.phase) ? next : { ...next, restoring: false };
    listeners.forEach((listener) => listener());
  };

  const releaseActive = async () => {
    const previous = active;
    active = null;
    if (previous) await previous.subscription.cancel().catch(() => undefined);
  };

  const applyEvent = (session: ActiveSession, event: NimiLocalAppConversationEvent): void => {
    if (event.conversationAnchorId !== session.anchorId) return;
    const sequence = parseSequence(event.sequence);
    if (sequence === null || sequence <= session.through) return;
    session.through = sequence;
    let { messages, activeTurnId, streaming, liveTools, lastOutcome } = state;
    switch (event.type) {
      case 'turn-accepted':
      case 'turn-started':
        activeTurnId = event.turnId;
        break;
      case 'text-delta':
        streaming = streaming && streaming.turnId === event.turnId
          ? { turnId: event.turnId, text: streaming.text + event.delta }
          : { turnId: event.turnId, text: event.delta };
        break;
      case 'live-tool': {
        const entry: LiveTool = { turnId: event.turnId, toolId: event.tool.toolId, name: event.tool.name, lifecycle: event.tool.lifecycle };
        liveTools = [...liveTools.filter((tool) => tool.toolId !== entry.toolId && tool.turnId === event.turnId), entry];
        break;
      }
      case 'message-committed': {
        const projected = project(event.message);
        const index = messages.findIndex((message) => message.id === projected.id);
        messages = index < 0 ? [...messages, projected] : messages.map((message, position) => (position === index ? projected : message));
        if (projected.role === 'assistant' && streaming?.turnId === event.turnId) streaming = null;
        break;
      }
      case 'turn-completed':
      case 'turn-failed':
      case 'turn-interrupted': {
        if (activeTurnId === event.turnId) activeTurnId = null;
        if (streaming?.turnId === event.turnId) streaming = null;
        liveTools = liveTools.filter((tool) => tool.turnId !== event.turnId);
        lastOutcome = {
          turnId: event.turnId,
          kind: event.type === 'turn-completed' ? 'completed' : event.type === 'turn-failed' ? 'failed' : 'interrupted',
          detail: event.type === 'turn-failed' ? (event.message ?? event.reasonCode) : event.type === 'turn-interrupted' ? event.reason : event.terminalReason || null,
        };
        break;
      }
      default:
        break;
    }
    publish({ messages, activeTurnId, streaming, liveTools, lastOutcome, connection: 'live' });
    eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // A listener failure never corrupts the Conversation projection.
      }
    });
  };

  const hydrate = async (session: ActiveSession, fallbackActiveTurn: string | null): Promise<void> => {
    const snapshot = await client.conversation.snapshot({ agentHandle: session.agent.agentHandle, conversationAnchorId: session.anchorId });
    if (active !== session || disposed) return;
    const through = parseSequence(snapshot.throughSequence);
    if (snapshot.conversationAnchorId !== session.anchorId || through === null) {
      throw new Error('The conversation snapshot does not match the open conversation.');
    }
    session.through = through;
    publish({
      phase: 'ready',
      agent: session.agent,
      anchorId: session.anchorId,
      messages: snapshot.messages.map(project),
      truncatedBefore: snapshot.truncatedBefore,
      activeTurnId: snapshot.turns.find((turn) => turn.status === 'active')?.turnId ?? fallbackActiveTurn,
      streaming: null,
      liveTools: [],
      connection: 'live',
      error: null,
    });
    healAttempts = 0;
    const pending = session.pending.splice(0);
    session.initialized = true;
    for (const event of pending) applyEvent(session, event);
  };

  /** Re-subscribe the same session; resolves false when that session cannot be resumed. */
  const recover = async (session: ActiveSession): Promise<boolean> => {
    if (session.recovering || active !== session) return false;
    session.recovering = true;
    publish({ connection: 'reconnecting' });
    try {
      await session.subscription.cancel().catch(() => undefined);
      session.subscription = await client.conversation.subscribe({ agentHandle: session.agent.agentHandle, conversationAnchorId: session.anchorId });
      session.pending = [];
      session.initialized = false;
      void consume(session);
      await hydrate(session, state.activeTurnId);
      healAttempts = 0;
      return true;
    } catch (error) {
      if (active === session) publish({ connection: 'lost', error: `${errorCode(error) || 'error'} · ${errorText(error, 'The conversation connection was lost.')}` });
      return false;
    } finally {
      session.recovering = false;
    }
  };

  /**
   * Bring the conversation back: first the same session, then a fresh open by
   * the saved binding (an Agent handle belongs to one technical session, so a
   * renewed session needs fresh references).
   */
  const heal = async () => {
    const session = active;
    if (session && await recover(session)) return;
    if (disposed) return;
    await restart();
  };

  /** A dropped connection retries on its own a few times before waiting for the user. */
  let healAttempts = 0;
  let healTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleHeal = () => {
    if (healTimer || disposed || healAttempts >= 3) return;
    const delay = [1_500, 5_000, 15_000][healAttempts]!;
    healAttempts += 1;
    healTimer = setTimeout(() => {
      healTimer = null;
      if (!disposed && state.connection === 'lost') void heal();
    }, delay);
  };

  const consume = async (session: ActiveSession) => {
    const subscription = session.subscription;
    try {
      for await (const event of subscription) {
        if (active !== session || disposed || session.subscription !== subscription) return;
        if (!session.initialized) {
          session.pending.push(event);
          continue;
        }
        applyEvent(session, event);
      }
      if (active === session && session.subscription === subscription && !disposed) {
        publish({ connection: 'lost' });
        scheduleHeal();
      }
    } catch (error) {
      if (active !== session || disposed || session.subscription !== subscription) return;
      if (isOverflow(error)) {
        await recover(session);
        return;
      }
      if (isStaleSelector(error)) {
        void restart();
        return;
      }
      publish({ connection: 'lost', error: `${errorCode(error) || 'error'} · ${errorText(error, 'The conversation connection was lost.')}` });
      scheduleHeal();
    }
  };

  const open = async (agent: AgentRef, currentEpoch: number): Promise<boolean> => {
    publish({ phase: 'opening', agent, error: null, awaitingConfirmation: null, restoring: true });
    const opened = await client.conversation.open({ agentHandle: agent.agentHandle });
    if (disposed || currentEpoch !== epoch) return false;
    // Subscribe before the snapshot so no event can fall between them.
    const subscription = await client.conversation.subscribe({ agentHandle: agent.agentHandle, conversationAnchorId: opened.conversationAnchorId });
    if (disposed || currentEpoch !== epoch) {
      await subscription.cancel().catch(() => undefined);
      return false;
    }
    const session: ActiveSession = {
      epoch: currentEpoch,
      agent,
      anchorId: opened.conversationAnchorId,
      subscription,
      pending: [],
      initialized: false,
      recovering: false,
      through: 0n,
    };
    active = session;
    void consume(session);
    await hydrate(session, opened.activeTurnId);
    return true;
  };

  const start = async (appointment: Appointment | null) => {
    // A stopped desk can be started again (React re-mounts effects in development).
    disposed = false;
    lastAppointment = appointment;
    const currentEpoch = ++epoch;
    // Said at once, before anything is awaited: whoever starts next must not
    // mistake an appointment that is being restored for none at all.
    const releasing = releaseActive();
    publish({ ...INITIAL, phase: 'loading', canUseWork: workApi !== null, restoring: appointment !== null });
    await releasing;
    let references: AgentRef[];
    try {
      references = (await client.agents.listReferences()).map(toRef);
    } catch (error) {
      if (currentEpoch === epoch) publish({ phase: 'unavailable', error: errorText(error, 'Agents could not be listed.') });
      return;
    }
    if (disposed || currentEpoch !== epoch) return;
    if (references.length === 0) {
      publish({ phase: 'no-agents', references });
      return;
    }
    const matched = appointment?.binding
      ? references.find((reference) => reference.binding === appointment.binding) ?? null
      : null;
    if (!matched) {
      // Without a Runtime-issued binding the user confirms who is on duty; names are never matched.
      publish({ phase: 'choose', references, awaitingConfirmation: appointment });
      return;
    }
    publish({ references });
    try {
      await open(matched, currentEpoch);
    } catch (error) {
      // The binding matched: this is still the same agent, only their conversation is out of reach.
      if (currentEpoch === epoch) publish({ phase: 'unavailable', unreachable: matched, error: errorCode(error) || errorText(error, 'The conversation could not be opened.') });
    }
  };

  const restart = async () => start(lastAppointment);

  const requireSession = (): ActiveSession | null => (state.phase === 'ready' && active ? active : null);

  const sendWith = async (payload: { text: string; requestId: string; work?: WorkSendInput['work']; routineName?: string }): Promise<SendResult> => {
    const session = requireSession();
    if (!session) return { ok: false, reason: 'not-ready', message: 'The on-duty agent is not connected.' };
    if (state.activeTurnId) return { ok: false, reason: 'busy', message: 'The agent is still replying.' };
    try {
      const base = {
        agentHandle: session.agent.agentHandle,
        conversationAnchorId: session.anchorId,
        requestId: payload.requestId,
        parts: [{ kind: 'text' as const, text: payload.text }],
      };
      const result = payload.work && workApi
        ? await workApi.send({ ...base, work: toSdkWork(payload.work, payload.routineName) })
        : await client.conversation.send(base);
      ownTurns.add(result.turnId);
      if (ownTurns.size > 200) ownTurns.delete(ownTurns.values().next().value!);
      if (!state.activeTurnId) publish({ activeTurnId: result.turnId });
      return { ok: true, turnId: result.turnId, scope: { agentHandle: session.agent.agentHandle, conversationAnchorId: session.anchorId } };
    } catch (error) {
      if (isBusy(error)) return { ok: false, reason: 'busy', message: 'The agent is busy with another conversation turn.' };
      if (isStaleSelector(error)) void restart();
      return { ok: false, reason: 'failed', message: errorText(error, 'The message could not be sent.') };
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    start,
    appoint: async (agentHandle) => {
      const reference = state.references.find((candidate) => candidate.agentHandle === agentHandle);
      if (!reference) return null;
      const currentEpoch = ++epoch;
      await releaseActive();
      try {
        const opened = await open(reference, currentEpoch);
        if (!opened) return null;
        // From now on a reconnect that has to look everyone up again restores
        // this agent (by binding), never the one appointed before.
        lastAppointment = { displayName: reference.displayName, avatarUrl: reference.avatarUrl, binding: reference.binding, appointedAt: new Date().toISOString() };
        return reference;
      } catch (error) {
        if (currentEpoch === epoch) publish({ phase: 'choose', error: errorText(error, 'The conversation could not be opened.') });
        return null;
      }
    },
    refreshReferences: async () => {
      try {
        const references = (await client.agents.listReferences()).map(toRef);
        publish({ references, ...(state.phase === 'no-agents' && references.length > 0 ? { phase: 'choose' as const } : {}) });
      } catch (error) {
        if (isStaleSelector(error)) void restart();
      }
    },
    reconnect: async () => {
      healAttempts = 0;
      await heal();
    },
    runtimeActiveTurn: async () => {
      const session = active;
      if (!session) return undefined;
      try {
        const opened = await client.conversation.open({ agentHandle: session.agent.agentHandle });
        return opened.activeTurnId ?? null;
      } catch {
        return undefined;
      }
    },
    send: (text, requestId) => sendWith({ text, requestId }),
    sendWork: (input) => sendWith({ text: input.text, requestId: input.requestId, work: input.work, ...(input.routineName ? { routineName: input.routineName } : {}) }),
    work: () => workApi,
    interrupt: async (turnId) => {
      const session = requireSession();
      if (!session) return 'failed';
      try {
        await client.conversation.interruptTurn({ agentHandle: session.agent.agentHandle, conversationAnchorId: session.anchorId, expectedTurnId: turnId });
        return 'interrupted';
      } catch (error) {
        return /turn[-_]not[-_]active/iu.test(errorCode(error)) ? 'not-active' : 'failed';
      }
    },
    ownsTurn: (turnId) => turnId !== null && ownTurns.has(turnId),
    readImage: async (artifactId) => {
      const cached = imageUrls.get(artifactId);
      if (cached) return cached;
      const session = requireSession();
      if (!session) return null;
      const artifact = await client.conversation.readArtifact({ agentHandle: session.agent.agentHandle, conversationAnchorId: session.anchorId, artifactId });
      if (!artifact.mimeType.startsWith('image/')) return null;
      const url = URL.createObjectURL(new Blob([artifact.bytes.slice().buffer], { type: artifact.mimeType }));
      imageUrls.set(artifactId, url);
      return url;
    },
    speak: async (messageId, requestId) => {
      const session = requireSession();
      if (!session) return { ok: false, reason: 'not-ready', code: 'agent-not-connected' };
      try {
        const voice = await client.conversation.renderVoice({ agentHandle: session.agent.agentHandle, conversationAnchorId: session.anchorId, messageId, requestId });
        if (voice.status !== 'ready') return { ok: false, reason: 'voice-unavailable', code: voice.message ?? voice.reasonCode };
        const artifact = await client.conversation.readArtifact({ agentHandle: session.agent.agentHandle, conversationAnchorId: session.anchorId, artifactId: voice.artifactId });
        if (!artifact.mimeType.startsWith('audio/')) return { ok: false, reason: 'voice-unavailable', code: artifact.mimeType };
        if (audio) audio.pause();
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        audioUrl = URL.createObjectURL(new Blob([artifact.bytes.slice().buffer], { type: artifact.mimeType }));
        const player = new Audio(audioUrl);
        audio = player;
        const finished = new Promise<void>((resolve) => {
          player.addEventListener('ended', () => resolve(), { once: true });
          player.addEventListener('pause', () => resolve(), { once: true });
          player.addEventListener('error', () => resolve(), { once: true });
        });
        await player.play();
        return { ok: true, finished };
      } catch (error) {
        return { ok: false, reason: 'failed', code: errorCode(error) || errorText(error, 'voice-failed') };
      }
    },
    stopSpeaking: () => {
      if (audio) audio.pause();
    },
    transcribe: async ({ requestId, mimeType, bytes }) => {
      const session = requireSession();
      if (!session) throw new Error('The on-duty agent is not connected.');
      const result = await client.conversation.transcribeVoice({
        agentHandle: session.agent.agentHandle,
        conversationAnchorId: session.anchorId,
        requestId,
        mimeType,
        audioBytes: bytes,
      });
      return result.text;
    },
    dispose: async () => {
      disposed = true;
      if (healTimer) clearTimeout(healTimer);
      healTimer = null;
      epoch += 1;
      await releaseActive();
      if (audio) audio.pause();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
      imageUrls.clear();
    },
  };
}
