import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReference,
  NimiLocalAppClient,
  NimiLocalAppConversationEvent,
  NimiLocalAppConversationInputPart,
  NimiLocalAppConversationMessage,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationCanonicalMessage } from '../types.js';

export type AppConversationEntryStatus =
  | 'idle'
  | 'loading-references'
  | 'select-reference'
  | 'opening'
  | 'ready'
  | 'failed'
  | 'stale'
  | 'disposed';

export type AppConversationEntryClient = Pick<NimiLocalAppClient, 'agents' | 'conversation'>;

export type AppConversationEntryState = Readonly<{
  status: AppConversationEntryStatus;
  references: readonly NimiLocalAppAgentReference[];
  selectedReference: NimiLocalAppAgentReference | null;
  conversationAnchorId: string | null;
  throughSequence: string | null;
  activeTurnId: string | null;
  truncatedBefore: boolean;
  messages: readonly ConversationCanonicalMessage[];
  pendingAttachment: AppConversationPendingAttachment | null;
  recording: boolean;
  error: string | null;
  actionError: string | null;
}>;

export type AppConversationPendingAttachment = Readonly<{
  artifactId: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  displayName: string | null;
}>;

export type AppConversationHostPlaybackInput = Readonly<{
  conversationAnchorId: string;
  messageId: string;
  mimeType: string;
  bytes: Uint8Array;
}>;

export type AppConversationHostUnavailable = Readonly<{
  status: 'unavailable';
  reasonCode: string;
  message: string | null;
}>;

export type AppConversationHostImagePickResult = AppConversationHostUnavailable | Readonly<{
  status: 'selected';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  displayName?: string;
  bytes: Uint8Array;
}>;

export type AppConversationHostRecordingResult = AppConversationHostUnavailable | Readonly<{
  status: 'recording';
}> | Readonly<{
  status: 'recorded';
  mimeType: string;
  bytes: Uint8Array;
}>;

export type AppConversationHostPreviewResult = AppConversationHostUnavailable | Readonly<{
  status: 'ready';
  previewHandle: string;
  mediaUrl: string;
}>;

export type AppConversationHostPlaybackResult = AppConversationHostUnavailable | Readonly<{
  status: 'playing';
}>;

/**
 * Host mechanics receive no Agent identity or authorization material. Runtime
 * still owns upload, transcription, artifact reads, and voice rendering.
 */
export type AppConversationHostPort = Readonly<{
  playback: Readonly<{
    play: (input: AppConversationHostPlaybackInput) => Promise<AppConversationHostPlaybackResult>;
    stop: () => Promise<void>;
  }>;
  preview: Readonly<{
    materialize: (input: Readonly<{
      mimeType: string;
      bytes: Uint8Array;
    }>) => Promise<AppConversationHostPreviewResult>;
    release: (input: Readonly<{ previewHandle: string }>) => Promise<void>;
  }>;
  attachments: Readonly<{
    pickImage: () => Promise<AppConversationHostImagePickResult>;
  }>;
  voiceInput: Readonly<{
    record: () => Promise<AppConversationHostRecordingResult>;
    cancel: () => Promise<void>;
  }>;
}>;

export type AppConversationVoicePlaybackResult =
  | Readonly<{ status: 'played' }>
  | Readonly<{
      status: 'unavailable';
      reasonCode: string;
      message: string | null;
    }>;

export type AppConversationTranscriptionResult = AppConversationHostUnavailable | Readonly<{
  status: 'recording';
}> | Readonly<{
  status: 'transcribed';
  text: string;
}>;

export type AppConversationEntrySession = Readonly<{
  getState: () => AppConversationEntryState;
  observe: (observer: (state: AppConversationEntryState) => void) => () => void;
  loadReferences: () => Promise<void>;
  selectReference: (agentHandle: NimiLocalAppAgentHandle) => Promise<void>;
  clearSelection: () => Promise<void>;
  send: (input: Readonly<{
    requestId: string;
    parts: readonly NimiLocalAppConversationInputPart[];
  }>) => Promise<void>;
  interrupt: () => Promise<void>;
  pickAttachment: () => Promise<AppConversationPendingAttachment | AppConversationHostUnavailable>;
  clearAttachment: () => void;
  recordAndTranscribe: (input: Readonly<{
    requestId: string;
  }>) => Promise<AppConversationTranscriptionResult>;
  playVoice: (input: Readonly<{
    messageId: string;
    requestId: string;
  }>) => Promise<AppConversationVoicePlaybackResult>;
  dispose: () => Promise<void>;
}>;

type ActiveEntrySession = {
  readonly epoch: number;
  readonly reference: NimiLocalAppAgentReference;
  readonly conversationAnchorId: string;
  readonly subscription: Awaited<ReturnType<NimiLocalAppClient['conversation']['subscribe']>>;
  readonly pendingEvents: NimiLocalAppConversationEvent[];
  readonly previews: Map<string, Extract<AppConversationHostPreviewResult, { status: 'ready' }>>;
  initialized: boolean;
  throughSequence: bigint;
};

const EMPTY_STATE: AppConversationEntryState = Object.freeze({
  status: 'idle',
  references: Object.freeze([]),
  selectedReference: null,
  conversationAnchorId: null,
  throughSequence: null,
  activeTurnId: null,
  truncatedBefore: false,
  messages: Object.freeze([]),
  pendingAttachment: null,
  recording: false,
  error: null,
  actionError: null,
});

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

function parseSequence(value: string): bigint | null {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function freezeState(state: AppConversationEntryState): AppConversationEntryState {
  return Object.freeze({
    ...state,
    references: Object.freeze([...state.references]),
    messages: Object.freeze([...state.messages]),
  });
}

function projectCommittedMessage(input: {
  readonly reference: NimiLocalAppAgentReference;
  readonly conversationAnchorId: string;
  readonly message: NimiLocalAppConversationMessage;
  readonly mediaUrl?: string;
}): ConversationCanonicalMessage {
  const text = input.message.parts.find((part) => part.kind === 'text');
  const image = input.message.parts.find((part) => part.kind === 'artifact-ref');
  const metadata = image
    ? Object.freeze({
        conversationAnchorId: input.conversationAnchorId,
        turnId: input.message.turnId,
        artifactId: image.artifactId,
        mediaKind: image.mediaKind,
        mimeType: image.mimeType,
        displayName: image.displayName,
        ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
      })
    : Object.freeze({
        conversationAnchorId: input.conversationAnchorId,
        turnId: input.message.turnId,
      });
  return Object.freeze({
    id: input.message.messageId,
    sessionId: input.conversationAnchorId,
    targetId: input.reference.agentHandle,
    source: 'agent' as const,
    role: input.message.role,
    text: text?.text ?? image?.displayName ?? '',
    // Canonical Conversation does not project wall-clock message time. An
    // empty value keeps the reusable shell from inventing one.
    createdAt: '',
    status: 'complete' as const,
    kind: image ? 'image' as const : 'text' as const,
    senderName: input.message.role === 'assistant'
      ? input.reference.displayName
      : null,
    senderAvatarUrl: input.message.role === 'assistant'
      ? input.reference.avatarUrl
      : null,
    senderKind: input.message.role === 'assistant' ? 'agent' as const : null,
    metadata,
  });
}

function replaceCommittedMessage(
  messages: readonly ConversationCanonicalMessage[],
  message: ConversationCanonicalMessage,
): readonly ConversationCanonicalMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return Object.freeze([...messages, message]);
  return Object.freeze(messages.map((candidate, candidateIndex) => (
    candidateIndex === index ? message : candidate
  )));
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r176
export function createAppConversationEntrySession(input: Readonly<{
  client: AppConversationEntryClient;
  hostPort: AppConversationHostPort;
}>): AppConversationEntrySession {
  let state = EMPTY_STATE;
  let epoch = 0;
  let active: ActiveEntrySession | null = null;
  let disposed = false;
  const observers = new Set<(state: AppConversationEntryState) => void>();

  const publish = (next: AppConversationEntryState) => {
    state = freezeState(next);
    observers.forEach((observer) => observer(state));
  };

  const publishActionError = (error: unknown, fallback: string) => {
    if (disposed) return;
    publish({ ...state, actionError: errorMessage(error, fallback) });
  };

  const releaseHostMechanics = async (session: ActiveEntrySession): Promise<void> => {
    const releases = [
      Promise.resolve().then(() => input.hostPort.playback.stop()),
      Promise.resolve().then(() => input.hostPort.voiceInput.cancel()),
      ...Array.from(session.previews.values(), (preview) => (
        Promise.resolve().then(() => input.hostPort.preview.release({ previewHandle: preview.previewHandle }))
      )),
    ];
    session.previews.clear();
    const results = await Promise.allSettled(releases);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (rejected && !disposed) {
      publishActionError(rejected.reason, 'Host media mechanics could not be released.');
    }
  };

  const releaseActive = async (): Promise<void> => {
    const previous = active;
    active = null;
    if (!previous) return;
    let cancelError: unknown = null;
    try {
      await previous.subscription.cancel();
    } catch (error) {
      cancelError = error;
    }
    await releaseHostMechanics(previous);
    if (cancelError) throw cancelError;
  };

  const markSessionFailure = (
    session: ActiveEntrySession,
    status: 'failed' | 'stale',
    message: string,
  ) => {
    if (active !== session || disposed) return;
    active = null;
    epoch += 1;
    publish({
      ...state,
      status,
      conversationAnchorId: null,
      throughSequence: null,
      activeTurnId: null,
      truncatedBefore: false,
      messages: Object.freeze([]),
      pendingAttachment: null,
      recording: false,
      error: message,
      actionError: null,
    });
    void session.subscription.cancel().catch(() => {});
    void releaseHostMechanics(session);
  };

  const materializeCommittedMessage = async (
    session: ActiveEntrySession,
    message: NimiLocalAppConversationMessage,
  ): Promise<ConversationCanonicalMessage | null> => {
    const image = message.parts.find((part) => part.kind === 'artifact-ref');
    if (!image) {
      return projectCommittedMessage({
        reference: session.reference,
        conversationAnchorId: session.conversationAnchorId,
        message,
      });
    }
    const artifact = await input.client.conversation.readArtifact({
      agentHandle: session.reference.agentHandle,
      conversationAnchorId: session.conversationAnchorId,
      artifactId: image.artifactId,
    });
    if (active !== session || session.epoch !== epoch || disposed) return null;
    if (artifact.artifactId !== image.artifactId
      || artifact.mimeType !== image.mimeType
      || !artifact.mimeType.startsWith('image/')
      || artifact.bytes.byteLength === 0) {
      throw new Error('Committed Conversation image artifact is invalid.');
    }
    const preview = await input.hostPort.preview.materialize({
      mimeType: artifact.mimeType,
      bytes: artifact.bytes,
    });
    if (preview.status === 'unavailable') {
      throw new Error(preview.message || preview.reasonCode);
    }
    const previewHandleValid = typeof preview.previewHandle === 'string' && Boolean(preview.previewHandle.trim());
    const mediaUrlValid = typeof preview.mediaUrl === 'string'
      && Boolean(preview.mediaUrl.trim())
      && preview.mediaUrl.trim() === preview.mediaUrl;
    if (!previewHandleValid || !mediaUrlValid) {
      if (previewHandleValid) {
        await input.hostPort.preview.release({ previewHandle: preview.previewHandle }).catch(() => {});
      }
      throw new Error('Host image preview materialization is invalid.');
    }
    if (active !== session || session.epoch !== epoch || disposed) {
      await input.hostPort.preview.release({ previewHandle: preview.previewHandle }).catch(() => {});
      return null;
    }
    const previous = session.previews.get(message.messageId);
    if (previous) {
      await input.hostPort.preview.release({ previewHandle: previous.previewHandle }).catch((error) => {
        publishActionError(error, 'Previous Host image preview could not be released.');
      });
    }
    session.previews.set(message.messageId, preview);
    return projectCommittedMessage({
      reference: session.reference,
      conversationAnchorId: session.conversationAnchorId,
      message,
      mediaUrl: preview.mediaUrl,
    });
  };

  const applyEvent = async (
    session: ActiveEntrySession,
    event: NimiLocalAppConversationEvent,
  ): Promise<boolean> => {
    if (event.conversationAnchorId !== session.conversationAnchorId) {
      markSessionFailure(session, 'stale', 'Conversation event no longer belongs to the active session.');
      return false;
    }
    const eventSequence = parseSequence(event.sequence);
    if (eventSequence === null) {
      markSessionFailure(session, 'stale', 'Conversation event sequence is invalid.');
      return false;
    }
    if (eventSequence <= session.throughSequence) return true;
    if (eventSequence !== session.throughSequence + 1n) {
      markSessionFailure(session, 'stale', 'Conversation event sequence has a gap. Reload the current Agent.');
      return false;
    }
    let messages = state.messages;
    let activeTurnId = state.activeTurnId;
    if (event.type === 'message-committed') {
      if (event.message.turnId !== event.turnId) {
        markSessionFailure(session, 'stale', 'Conversation message linkage is invalid.');
        return false;
      }
      try {
        const projected = await materializeCommittedMessage(session, event.message);
        if (!projected) return false;
        messages = replaceCommittedMessage(messages, projected);
      } catch (error) {
        markSessionFailure(
          session,
          'failed',
          errorMessage(error, 'Committed Conversation image could not be materialized.'),
        );
        return false;
      }
    } else if (event.type === 'turn-accepted' || event.type === 'turn-started') {
      activeTurnId = event.turnId;
    } else if (
      (event.type === 'turn-completed'
        || event.type === 'turn-failed'
        || event.type === 'turn-interrupted')
      && activeTurnId === event.turnId
    ) {
      activeTurnId = null;
    }
    session.throughSequence = eventSequence;
    publish({
      ...state,
      status: 'ready',
      throughSequence: event.sequence,
      activeTurnId,
      messages,
      error: null,
    });
    return true;
  };

  const consumeEvents = async (session: ActiveEntrySession): Promise<void> => {
    try {
      for await (const event of session.subscription) {
        if (active !== session || disposed) return;
        if (!session.initialized) {
          session.pendingEvents.push(event);
          continue;
        }
        if (!await applyEvent(session, event)) return;
      }
      if (active === session && !disposed) {
        markSessionFailure(session, 'failed', 'Conversation subscription ended before the session was closed.');
      }
    } catch (error) {
      if (active === session && !disposed) {
        markSessionFailure(
          session,
          'failed',
          errorMessage(error, 'Conversation subscription is unavailable.'),
        );
      }
    }
  };

  const loadReferences = async () => {
    if (disposed) return;
    const currentEpoch = ++epoch;
    publish({
      ...EMPTY_STATE,
      status: 'loading-references',
    });
    try {
      await releaseActive();
      if (disposed || currentEpoch !== epoch) return;
      const references = await input.client.agents.listReferences();
      if (disposed || currentEpoch !== epoch) return;
      publish({
        ...EMPTY_STATE,
        status: 'select-reference',
        references,
      });
    } catch (error) {
      if (disposed || currentEpoch !== epoch) return;
      publish({
        ...EMPTY_STATE,
        status: 'failed',
        error: errorMessage(error, 'Current Agents could not be loaded.'),
      });
    }
  };

  const selectReference = async (agentHandle: NimiLocalAppAgentHandle) => {
    if (disposed) return;
    const reference = state.references.find((candidate) => candidate.agentHandle === agentHandle) ?? null;
    const currentEpoch = ++epoch;
    publish({
      ...state,
      status: 'opening',
      selectedReference: reference,
      conversationAnchorId: null,
      throughSequence: null,
      activeTurnId: null,
      truncatedBefore: false,
      messages: Object.freeze([]),
      pendingAttachment: null,
      recording: false,
      error: reference ? null : 'Selected Agent reference is no longer current.',
      actionError: null,
    });
    try {
      await releaseActive();
      if (disposed || currentEpoch !== epoch) return;
      if (!reference) {
        publish({
          ...state,
          status: 'stale',
          selectedReference: null,
          error: 'Selected Agent reference is no longer current.',
        });
        return;
      }
      const opened = await input.client.conversation.open({ agentHandle: reference.agentHandle });
      if (disposed || currentEpoch !== epoch) return;
      const scope = {
        agentHandle: reference.agentHandle,
        conversationAnchorId: opened.conversationAnchorId,
      } as const;
      // Subscribe first so no event can fall between open and snapshot.
      const subscription = await input.client.conversation.subscribe(scope);
      if (disposed || currentEpoch !== epoch) {
        await subscription.cancel();
        return;
      }
      const session: ActiveEntrySession = {
        epoch: currentEpoch,
        reference,
        conversationAnchorId: opened.conversationAnchorId,
        subscription,
        pendingEvents: [],
        previews: new Map(),
        initialized: false,
        throughSequence: 0n,
      };
      active = session;
      void consumeEvents(session);
      const snapshot = await input.client.conversation.snapshot(scope);
      if (active !== session || disposed || currentEpoch !== epoch) return;
      if (snapshot.conversationAnchorId !== session.conversationAnchorId) {
        markSessionFailure(session, 'stale', 'Conversation snapshot no longer belongs to the active session.');
        return;
      }
      const throughSequence = parseSequence(snapshot.throughSequence);
      if (throughSequence === null) {
        markSessionFailure(session, 'stale', 'Conversation snapshot high-water is invalid.');
        return;
      }
      let messages: readonly ConversationCanonicalMessage[];
      try {
        const messageIds = new Set<string>();
        const projectedMessages: ConversationCanonicalMessage[] = [];
        for (const message of snapshot.messages) {
          if (messageIds.has(message.messageId)) {
            throw new Error('Canonical Conversation snapshot contains duplicate committed messages.');
          }
          messageIds.add(message.messageId);
          const projected = await materializeCommittedMessage(session, message);
          if (!projected) return;
          projectedMessages.push(projected);
        }
        messages = Object.freeze(projectedMessages);
      } catch (error) {
        markSessionFailure(session, 'failed', errorMessage(error, 'Conversation snapshot is invalid.'));
        return;
      }
      session.throughSequence = throughSequence;
      const snapshotActiveTurn = snapshot.turns.find((turn) => turn.status === 'active')?.turnId
        ?? opened.activeTurnId;
      publish({
        status: 'ready',
        references: state.references,
        selectedReference: reference,
        conversationAnchorId: session.conversationAnchorId,
        throughSequence: snapshot.throughSequence,
        activeTurnId: snapshotActiveTurn,
        truncatedBefore: snapshot.truncatedBefore,
        messages,
        pendingAttachment: null,
        recording: false,
        error: null,
        actionError: null,
      });
      for (let index = 0; index < session.pendingEvents.length; index += 1) {
        if (active !== session || !await applyEvent(session, session.pendingEvents[index])) return;
      }
      session.pendingEvents.length = 0;
      session.initialized = true;
    } catch (error) {
      if (disposed || currentEpoch !== epoch) return;
      const session = active;
      if (session?.epoch === currentEpoch) {
        markSessionFailure(session, 'failed', errorMessage(error, 'Conversation session is unavailable.'));
        return;
      }
      publish({
        ...state,
        status: 'failed',
        conversationAnchorId: null,
        throughSequence: null,
        activeTurnId: null,
        truncatedBefore: false,
        messages: Object.freeze([]),
        pendingAttachment: null,
        recording: false,
        error: errorMessage(error, 'Conversation session is unavailable.'),
        actionError: null,
      });
    }
  };

  const requireReadySession = (): ActiveEntrySession => {
    if (!active || state.status !== 'ready' || !state.selectedReference
      || state.conversationAnchorId !== active.conversationAnchorId) {
      throw new Error('Conversation session is not ready.');
    }
    return active;
  };

  const send = async (sendInput: Readonly<{
    requestId: string;
    parts: readonly NimiLocalAppConversationInputPart[];
  }>) => {
    let session: ActiveEntrySession | null = null;
    try {
      session = requireReadySession();
      publish({ ...state, actionError: null });
      await input.client.conversation.send({
        agentHandle: session.reference.agentHandle,
        conversationAnchorId: session.conversationAnchorId,
        requestId: sendInput.requestId,
        parts: sendInput.parts,
      });
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before send completed.');
      }
      const pendingArtifactId = state.pendingAttachment?.artifactId;
      if (pendingArtifactId && sendInput.parts.some((part) => (
        part.kind === 'artifact-ref' && part.artifactId === pendingArtifactId
      ))) {
        publish({ ...state, pendingAttachment: null });
      }
    } catch (error) {
      if (!session || (active === session && session.epoch === epoch)) {
        publishActionError(error, 'Message could not be sent.');
      }
      throw error;
    }
  };

  const interrupt = async () => {
    let session: ActiveEntrySession | null = null;
    try {
      session = requireReadySession();
      publish({ ...state, actionError: null });
      await input.client.conversation.interruptTurn({
        agentHandle: session.reference.agentHandle,
        conversationAnchorId: session.conversationAnchorId,
      });
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before interrupt completed.');
      }
    } catch (error) {
      if (!session || (active === session && session.epoch === epoch)) {
        publishActionError(error, 'Conversation could not be interrupted.');
      }
      throw error;
    }
  };

  const pickAttachment = async (): Promise<AppConversationPendingAttachment | AppConversationHostUnavailable> => {
    let session: ActiveEntrySession | null = null;
    try {
      session = requireReadySession();
      publish({ ...state, actionError: null });
      const picked = await input.hostPort.attachments.pickImage();
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before attachment selection completed.');
      }
      if (picked.status === 'unavailable') {
        publish({
          ...state,
          actionError: picked.message || picked.reasonCode,
        });
        return picked;
      }
      const uploaded = await input.client.conversation.uploadAttachment({
        agentHandle: session.reference.agentHandle,
        conversationAnchorId: session.conversationAnchorId,
        mimeType: picked.mimeType,
        ...(picked.displayName ? { displayName: picked.displayName } : {}),
        bytes: picked.bytes,
      });
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before attachment upload completed.');
      }
      const pendingAttachment = Object.freeze({
        artifactId: uploaded.artifactId,
        mimeType: picked.mimeType,
        displayName: picked.displayName ?? null,
      });
      publish({ ...state, pendingAttachment, actionError: null });
      return pendingAttachment;
    } catch (error) {
      if (!session || (active === session && session.epoch === epoch)) {
        publishActionError(error, 'Image attachment is unavailable.');
      }
      throw error;
    }
  };

  const clearAttachment = () => {
    if (disposed || state.pendingAttachment === null) return;
    publish({ ...state, pendingAttachment: null });
  };

  const recordAndTranscribe = async (recordInput: Readonly<{
    requestId: string;
  }>): Promise<AppConversationTranscriptionResult> => {
    let session: ActiveEntrySession | null = null;
    try {
      session = requireReadySession();
      publish({ ...state, actionError: null });
      const recorded = await input.hostPort.voiceInput.record();
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before voice recording completed.');
      }
      if (recorded.status === 'unavailable') {
        publish({ ...state, recording: false, actionError: recorded.message || recorded.reasonCode });
        return recorded;
      }
      if (recorded.status === 'recording') {
        publish({ ...state, recording: true, actionError: null });
        return recorded;
      }
      publish({ ...state, recording: false, actionError: null });
      const transcribed = await input.client.conversation.transcribeVoice({
        agentHandle: session.reference.agentHandle,
        conversationAnchorId: session.conversationAnchorId,
        requestId: recordInput.requestId,
        mimeType: recorded.mimeType,
        audioBytes: recorded.bytes,
      });
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before voice transcription completed.');
      }
      return Object.freeze({ status: 'transcribed' as const, text: transcribed.text });
    } catch (error) {
      if (!session || (active === session && session.epoch === epoch)) {
        publish({
          ...state,
          recording: false,
          actionError: errorMessage(error, 'Recorded voice transcription is unavailable.'),
        });
      }
      throw error;
    }
  };

  const playVoice = async (voiceInput: Readonly<{
    messageId: string;
    requestId: string;
  }>): Promise<AppConversationVoicePlaybackResult> => {
    let session: ActiveEntrySession | null = null;
    try {
      session = requireReadySession();
      if (!state.messages.some((message) => message.id === voiceInput.messageId)) {
        throw new Error('Voice playback requires a current committed message.');
      }
      publish({ ...state, actionError: null });
      const rendered = await input.client.conversation.renderVoice({
        agentHandle: session.reference.agentHandle,
        conversationAnchorId: session.conversationAnchorId,
        messageId: voiceInput.messageId,
        requestId: voiceInput.requestId,
      });
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before voice render completed.');
      }
      if (rendered.status === 'unavailable') {
        return Object.freeze({
          status: 'unavailable' as const,
          reasonCode: rendered.reasonCode,
          message: rendered.message,
        });
      }
      const artifact = await input.client.conversation.readArtifact({
        agentHandle: session.reference.agentHandle,
        conversationAnchorId: session.conversationAnchorId,
        artifactId: rendered.artifactId,
      });
      if (active !== session || session.epoch !== epoch) {
        throw new Error('Conversation session changed before voice artifact read completed.');
      }
      if (!artifact.mimeType.startsWith('audio/') || artifact.bytes.byteLength === 0) {
        throw new Error('Conversation voice artifact is unavailable.');
      }
      const playback = await input.hostPort.playback.play(Object.freeze({
        conversationAnchorId: session.conversationAnchorId,
        messageId: voiceInput.messageId,
        mimeType: artifact.mimeType,
        bytes: artifact.bytes,
      }));
      if (active !== session || session.epoch !== epoch) {
        await input.hostPort.playback.stop();
        throw new Error('Conversation session changed before voice playback started.');
      }
      if (playback.status === 'unavailable') {
        return Object.freeze({
          status: 'unavailable' as const,
          reasonCode: playback.reasonCode,
          message: playback.message,
        });
      }
      return Object.freeze({ status: 'played' as const });
    } catch (error) {
      if (!session || (active === session && session.epoch === epoch)) {
        publishActionError(error, 'Voice playback is unavailable.');
      }
      throw error;
    }
  };

  const clearSelection = async () => {
    if (disposed) return;
    const currentEpoch = ++epoch;
    const references = state.references;
    publish({
      ...EMPTY_STATE,
      status: 'select-reference',
      references,
    });
    try {
      await releaseActive();
    } catch (error) {
      if (!disposed && currentEpoch === epoch) {
        publish({
          ...EMPTY_STATE,
          status: 'failed',
          references,
          error: errorMessage(error, 'Conversation session could not be closed.'),
        });
      }
    }
  };

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    epoch += 1;
    try {
      await releaseActive();
    } finally {
      publish({ ...EMPTY_STATE, status: 'disposed' });
      observers.clear();
    }
  };

  return Object.freeze({
    getState: () => state,
    observe: (observer: (next: AppConversationEntryState) => void) => {
      if (disposed) return () => {};
      observers.add(observer);
      observer(state);
      return () => observers.delete(observer);
    },
    loadReferences,
    selectReference,
    clearSelection,
    send,
    interrupt,
    pickAttachment,
    clearAttachment,
    recordAndTranscribe,
    playVoice,
    dispose,
  });
}
