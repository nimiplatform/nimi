import { extractNimiErrorFields } from '@nimiplatform/kit/core/sdk-contract';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient, NimiLocalAppConversationEvent } from '@nimiplatform/kit/core/sdk-contract';
import { reduceCanonicalConversationEvent, seedCanonicalConversationProjection, type CanonicalConversationProjection } from './local-app-conversation-projection.js';
import { isLocalAppConversationAccessDenied } from './local-app-conversation-access.js';

export type LocalAppConversationScope = {
  agentHandle: NimiLocalAppAgentHandle;
  conversationAnchorId: string;
};
export type LocalAppConversationObservation = {
  refresh(): Promise<void>;
  invalidateAccess(error: unknown): void;
  close(): void;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
// @nimi-authority: rule.nimi.runtime.agent-participation.r176
/** Observes one owner Conversation. Reconnecting never sends or interrupts a turn. */
export function observeLocalAppConversation(input: {
  conversation: Pick<NimiLocalAppConversationClient, 'subscribe' | 'snapshot'>;
  scope: LocalAppConversationScope;
  onProjection: (projection: CanonicalConversationProjection) => void;
  onStatus?: (status: 'loading' | 'ready' | 'error', error?: unknown) => void;
}): LocalAppConversationObservation {
  let closed = false;
  let epoch = 0;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => Promise<void> = async () => {};
  let refresh: (() => Promise<void>) | null = null;
  let accessDenied = false;
  let clearProjection = () => {};

  const invalidateAccess = (error: unknown): void => {
    if (closed || accessDenied || !isLocalAppConversationAccessDenied(error)) return;
    accessDenied = true;
    epoch += 1;
    clearTimeout(timer);
    refresh = null;
    clearProjection();
    const retire = cancel;
    cancel = async () => {};
    void retire().catch(() => undefined);
    input.onStatus?.('error', error);
  };

  const connect = async (explicitRefresh = false) => {
    if (closed || (accessDenied && !explicitRefresh)) return;
    if (explicitRefresh) accessDenied = false;
    const generation = ++epoch;
    const current = () => !closed && epoch === generation;
    await cancel().catch(() => undefined);
    if (!current()) return;
    input.onStatus?.('loading');
    let projection: CanonicalConversationProjection | null = null;
    let hydrating: Promise<void> | null = null;
    let terminalRefreshRequested = false;
    const buffered: NimiLocalAppConversationEvent[] = [];
    clearProjection = () => { projection = null; buffered.length = 0; terminalRefreshRequested = false; };
    const publish = () => {
      if (current() && projection) {
        input.onProjection(projection);
        if (current()) input.onStatus?.('ready');
      }
    };
    const applyEvent = (event: NimiLocalAppConversationEvent): boolean => {
      const reduced = reduceCanonicalConversationEvent(projection!, event);
      if (reduced.status === 'stale') return false;
      retries = 0;
      projection = reduced.projection;
      if (event.type === 'turn-failed' || event.type === 'turn-interrupted') terminalRefreshRequested = true;
      return true;
    };
    const refreshAfterTerminal = () => {
      if (!current() || hydrating || !terminalRefreshRequested) return;
      // Eligibility comes from the owner, but this read must not stop live
      // state/text events or tear down their healthy subscription on failure.
      void hydrate().catch((error) => {
        if (current() && isLocalAppConversationAccessDenied(error)) invalidateAccess(error);
        // Keep the known projection without claiming the read succeeded or
        // changing connection health. Initial/explicit reads still report errors.
      });
    };
    const hydrate = (): Promise<void> => {
      if (hydrating) return hydrating;
      const readStartSequence = projection?.throughSequence ?? '0';
      terminalRefreshRequested = false;
      hydrating = (async () => {
        const snapshot = await input.conversation.snapshot(input.scope);
        if (!current()) return;
        if (snapshot.conversationAnchorId !== input.scope.conversationAnchorId) {
          throw new Error('Conversation snapshot belongs to a different conversation.');
        }
        // Accept owner fields from this read even if live events have advanced.
        // Replay that read's newer events before publishing; an older-than-start
        // snapshot cannot reconstruct the existing projection and is ignored.
        if (!projection || BigInt(snapshot.throughSequence) >= BigInt(readStartSequence)) {
          projection = seedCanonicalConversationProjection(snapshot);
          terminalRefreshRequested = false;
          for (const event of buffered.splice(0)) applyEvent(event);
        }
        publish();
      })().catch(error => {
        if (current() && isLocalAppConversationAccessDenied(error)) invalidateAccess(error);
        throw error;
      }).finally(() => {
        buffered.length = 0;
        hydrating = null;
        // A terminal applied during this read needs one subsequent owner read.
        // This also covers events that arrived between publish and finally.
        refreshAfterTerminal();
      });
      return hydrating;
    };
    try {
      const subscription = await input.conversation.subscribe(input.scope);
      if (!current()) { await subscription.cancel(); return; }
      cancel = () => subscription.cancel();
      refresh = hydrate;
      const pump = (async () => {
        for await (const event of subscription) {
          if (!current()) return;
          if (event.conversationAnchorId !== input.scope.conversationAnchorId) {
            throw new Error('Conversation event belongs to a different conversation.');
          }
          if (!projection) { buffered.push(event); continue; }
          if (!applyEvent(event)) continue;
          if (hydrating) buffered.push(event);
          publish();
          refreshAfterTerminal();
        }
        if (current()) throw Object.assign(new Error('Conversation connection ended.'), { retryable: true });
      })();
      // Attach both rejection handlers immediately; a failed snapshot must not
      // leave an unobserved rejecting pump or a second active subscription.
      await Promise.all([hydrate(), pump]);
    } catch (error) {
      if (!current()) return;
      if (isLocalAppConversationAccessDenied(error)) { invalidateAccess(error); return; }
      const failedEpoch = ++epoch;
      refresh = null;
      await cancel().catch(() => undefined);
      if (closed || epoch !== failedEpoch) return;
      input.onStatus?.('error', error);
      if (extractNimiErrorFields(error).retryable === true && retries < 3) {
        timer = setTimeout(() => { void connect(); }, [100, 500, 1500][retries++]!);
      }
    }
  };
  void connect();
  return {
    invalidateAccess,
    async refresh() {
      if (closed) return;
      if (refresh) {
        const generation = epoch;
        try { await refresh(); } catch (error) {
          if (!closed && epoch === generation) {
            if (isLocalAppConversationAccessDenied(error)) invalidateAccess(error);
            else input.onStatus?.('error', error);
          }
        }
      } else {
        clearTimeout(timer);
        retries = 0;
        void connect(true);
      }
    },
    close() {
      closed = true;
      epoch++;
      clearTimeout(timer);
      refresh = null;
      clearProjection();
      void cancel().catch(() => undefined);
    },
  };
}

/** Preview failures remain local to the artifact; text projection never waits. */
export function createCanonicalConversationMediaReader(input: {
  conversation: Pick<NimiLocalAppConversationClient, 'readArtifact'>;
  scope: LocalAppConversationScope;
  onChange: () => void;
  onAccessDenied?: (error: unknown) => void;
}) {
  type Preview = { mediaUrl: string | null; mimeType: string | null };
  const resolved = new Map<string, Preview>();
  const pending = new Set<string>();
  const queued: string[] = [];
  let active = 0;
  let closed = false;
  const empty: Preview = { mediaUrl: null, mimeType: null };
  const close = () => { closed = true; queued.length = 0; resolved.clear(); pending.clear(); };
  const read = async (artifactId: string): Promise<Preview> => {
    try {
      const artifact = await input.conversation.readArtifact({ ...input.scope, artifactId });
      if (closed) return empty;
      let binary = '';
      for (let i = 0; i < artifact.bytes.length; i += 8192) {
        binary += String.fromCharCode(...artifact.bytes.subarray(i, i + 8192));
      }
      return { mediaUrl: `data:${artifact.mimeType};base64,${btoa(binary)}`, mimeType: artifact.mimeType };
    } catch (error) {
      if (!closed && isLocalAppConversationAccessDenied(error)) { close(); input.onAccessDenied?.(error); }
      return empty;
    }
  };
  const pump = () => {
    while (!closed && active < 4 && queued.length) {
      const artifactId = queued.shift()!;
      active++;
      void read(artifactId).then(value => {
        if (!closed) { pending.delete(artifactId); resolved.set(artifactId, value); input.onChange(); }
      }).finally(() => { active--; pump(); });
    }
  };
  return {
    get(artifactId: string): Preview {
      if (closed) return empty;
      const value = resolved.get(artifactId);
      if (value) return value;
      if (!pending.has(artifactId)) { pending.add(artifactId); queued.push(artifactId); pump(); }
      return empty;
    },
    getReadError(): 'failed' | 'retrying' | null {
      let failed = false;
      for (const [artifactId, preview] of resolved) {
        if (preview.mediaUrl) continue;
        if (pending.has(artifactId)) return 'retrying';
        failed = true;
      }
      return failed ? 'failed' : null;
    },
    retryFailed() {
      if (closed) return;
      let added = false;
      for (const [artifactId, preview] of resolved) {
        if (preview.mediaUrl || pending.has(artifactId)) continue;
        pending.add(artifactId);
        queued.push(artifactId);
        added = true;
      }
      if (added) { pump(); input.onChange(); }
    },
    close,
  };
}
