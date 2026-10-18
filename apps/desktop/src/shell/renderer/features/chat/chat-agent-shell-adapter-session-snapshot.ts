import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/sdk/app';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import type { AgentLocalThreadSummary } from '../../bridge/runtime-bridge/types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { bundleQueryKey } from './chat-agent-shell-core';
import { useAgentVisibleProjectionStore } from './chat-agent-visible-projection-context.js';
import type { AuthStatus } from '../../app-shell/providers/app-store';
import {
  createCanonicalConversationMediaReader,
  materializeCanonicalConversationBundle,
  reduceCanonicalConversationEvent,
  seedCanonicalConversationProjection,
  type CanonicalConversationProjection,
} from './chat-agent-canonical-conversation-projection.js';

type RuntimeHostErrorDetailsBuilder = (
  error: unknown,
  action?: string,
  extra?: Record<string, unknown>,
) => Record<string, unknown>;

type UseAgentRuntimeSessionSnapshotHydrationInput = {
  activeAgentHandle: string | null | undefined;
  activeConversationAnchorId: string | null;
  authStatus: AuthStatus;
  buildHostErrorDetails: RuntimeHostErrorDetailsBuilder;
  onRuntimeError?: (error: unknown) => void;
  queryClient: QueryClient;
  selectedThreadRecord: AgentLocalThreadSummary | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function compareEvents(
  left: NimiLocalAppConversationEvent,
  right: NimiLocalAppConversationEvent,
): number {
  const leftSequence = BigInt(left.sequence);
  const rightSequence = BigInt(right.sequence);
  return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
}

export type AgentRuntimeSessionHydrationState = {
  readonly controlState: import('@nimiplatform/sdk/app').NimiLocalAppConversationState | null;
  /** The conversation has history that has not been read yet. */
  readonly loading: boolean;
  readonly error: Error | null;
  readonly retry: () => void;
};

type HydrationOutcome = {
  readonly key: string;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: Error | null;
};

function hydrationKey(input: UseAgentRuntimeSessionSnapshotHydrationInput): string | null {
  const thread = input.selectedThreadRecord;
  const conversationAnchorId = normalizeText(input.activeConversationAnchorId);
  const agentHandle = normalizeText(thread?.targetSnapshot.agentHandle);
  if (input.authStatus !== 'authenticated' || !thread || !conversationAnchorId || !agentHandle
    || agentHandle !== normalizeText(input.activeAgentHandle)) {
    return null;
  }
  return [agentHandle, conversationAnchorId, thread.id].join('|');
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r175
// @nimi-authority: rule.nimi.desktop.agent-projection.r029
export function useAgentRuntimeSessionSnapshotHydration(
  input: UseAgentRuntimeSessionSnapshotHydrationInput,
): AgentRuntimeSessionHydrationState {
  const bindings = useDesktopRendererBindings();
  const visibleProjections = useAgentVisibleProjectionStore();
  const activeKeyRef = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<HydrationOutcome | null>(null);
  const reconnects = useRef({key:'', count:0});
  const [attempt, setAttempt] = useState(0);
  const [control, setControl] = useState<{key:string;value:import('@nimiplatform/sdk/app').NimiLocalAppConversationState}|null>(null);
  const retry = useCallback(() => { reconnects.current.count=0; setAttempt(current=>current+1); }, []);
  const currentKey = hydrationKey(input);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelSubscription: () => Promise<void> = async () => {};
    const thread = input.selectedThreadRecord;
    const conversationAnchorId = normalizeText(input.activeConversationAnchorId);
    const agentHandle = normalizeText(thread?.targetSnapshot.agentHandle) as NimiLocalAppAgentHandle;
    const key = hydrationKey(input);
    if (!key || !thread) {
      return () => { cancelled = true; };
    }

    activeKeyRef.current = key;
    if(reconnects.current.key!==key) reconnects.current={key,count:0};
    setOutcome((current) => (current?.key === key && current.status !== 'error'
      ? current
      : { key, status: 'loading', error: null }));
    const conversation = bindings.sdk.conversation();
    const bufferedEvents: NimiLocalAppConversationEvent[] = [];
    let projection: CanonicalConversationProjection | null = null;
    let resyncing = false;
    let serial = Promise.resolve();

    const media = createCanonicalConversationMediaReader({
      conversation,
      thread,
      conversationAnchorId,
      onChange: () => publish(),
    });
    const publish: () => void = () => {
      if (!projection || cancelled || activeKeyRef.current !== key) return;
      const bundle = materializeCanonicalConversationBundle({
        media,
        thread,
        projection,
        nowMs: bindings.clock.now(),
      });
      if (cancelled || activeKeyRef.current !== key) return;
      input.queryClient.setQueryData(bundleQueryKey(thread.id), bundle);
      setControl(current => current?.key === key && current.value === projection!.state ? current : {key,value:projection!.state});
      visibleProjections.set(thread.id, bundle);
      setOutcome((current) => (current?.key === key && current.status === 'ready'
        ? current
        : { key, status: 'ready', error: null }));
    };

    const authoritativeResync = async () => {
      if (resyncing || cancelled) return;
      resyncing = true;
      try {
        let gapResyncCount = 0;
        while (!cancelled && activeKeyRef.current === key) {
          // The subscription is already active. Events arriving while this
          // snapshot is read remain buffered until the authoritative sequence
          // barrier has been installed.
          const snapshot = await conversation.snapshot({ agentHandle, conversationAnchorId });
          if (cancelled || activeKeyRef.current !== key) return;
          projection = seedCanonicalConversationProjection(snapshot);
          let gap = false;
          do {
            const pending = bufferedEvents.splice(0).sort(compareEvents);
            for (const event of pending) {
              const reduced = reduceCanonicalConversationEvent(projection, event);
              if (reduced.status === 'gap') {
                bufferedEvents.push(event);
                gap = true;
                continue;
              }
              projection = reduced.projection;
            }
            if (!gap) await publish();
            // Text projection never waits for preview bytes. Media completion
            // reprojects the current state through the same scoped publisher.
          } while (!gap && bufferedEvents.length > 0);
          if (!gap) return;
          gapResyncCount += 1;
          if (gapResyncCount >= 3) {
            throw new Error('Canonical Conversation remained non-contiguous after authoritative resync.');
          }
          projection = null;
        }
      } finally {
        resyncing = false;
      }
    };

    const acceptEvent = async (event: NimiLocalAppConversationEvent) => {
      if (cancelled || event.conversationAnchorId !== conversationAnchorId) return;
      if (!projection || resyncing) {
        bufferedEvents.push(event);
        return;
      }
      const reduced = reduceCanonicalConversationEvent(projection, event);
      if (reduced.status === 'gap') {
        bufferedEvents.push(event);
        projection = null;
        await authoritativeResync();
        return;
      }
      if (reduced.status === 'stale') return;
      projection = reduced.projection;
      reconnects.current.count=0;
      await publish();
      if (event.type === 'turn-failed' || event.type === 'turn-interrupted') await authoritativeResync();
    };

    void (async () => {
      const subscription = await conversation.subscribe({ agentHandle, conversationAnchorId });
      cancelSubscription = subscription.cancel;
      const eventPump = (async () => {
        for await (const event of subscription) {
          if (cancelled) return;
          serial = serial.then(() => acceptEvent(event));
          await serial;
        }
      })();
      await authoritativeResync();
      await eventPump;
      if (!cancelled) throw Object.assign(new Error('Conversation connection ended. Reconnecting does not resend your message.'), {retryable:true});
    })().catch((error) => {
      if (cancelled) return;
      void cancelSubscription().catch(() => undefined);
      if (extractNimiErrorFields(error).retryable === true && reconnects.current.key === key && reconnects.current.count < 3) {
        const delay=[100,500,1500][reconnects.current.count++]!;
        reconnectTimer=setTimeout(() => {if(!cancelled && activeKeyRef.current===key) setAttempt(value=>value+1);},delay);
      }
      setOutcome({ key, status: 'error' , error: error instanceof Error ? error : new Error(String(error)) });
      input.onRuntimeError?.(error);
      logRendererEvent({
        level: 'warn',
        area: 'agent-chat-shell',
        message: 'action:host-error',
        details: input.buildHostErrorDetails(error, 'hydrate-canonical-agent-conversation', {
          threadId: thread.id,
          conversationAnchorId,
        }),
      });
    });

    return () => {
      cancelled = true;
      if(reconnectTimer!==null) clearTimeout(reconnectTimer);
      media.close();
      if (activeKeyRef.current === key) activeKeyRef.current = null;
      void cancelSubscription().catch(() => undefined);
    };
  }, [
    bindings.clock,
    bindings.sdk,
    input.activeAgentHandle,
    input.activeConversationAnchorId,
    input.authStatus,
    input.buildHostErrorDetails,
    input.onRuntimeError,
    input.queryClient,
    input.selectedThreadRecord,
    visibleProjections,
    attempt,
  ]);

  const settled = outcome?.key === currentKey ? outcome : null;
  return {
    controlState: control?.key === currentKey ? control.value : null,
    loading: currentKey !== null && settled?.status !== 'ready' && settled?.status !== 'error',
    error: currentKey !== null && settled?.status === 'error' ? settled.error : null,
    retry,
  };
}
