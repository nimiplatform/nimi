import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationEvent,
} from '@nimiplatform/sdk/app';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import type { AgentLocalThreadSummary } from '../../bridge/runtime-bridge/types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { getDesktopConversationClient } from '../../infra/sdk/desktop-nimi-client-session.js';
import { bundleQueryKey } from './chat-agent-shell-core';
import { useAgentVisibleProjectionStore } from './chat-agent-visible-projection-context.js';
import type { AuthStatus } from '../../app-shell/providers/app-store';
import {
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
  bundleError: Error | null;
  isBundleLoading: boolean;
  onRuntimeError?: (error: unknown) => void;
  queryClient: QueryClient;
  selectedThreadRecord: AgentLocalThreadSummary | null;
  submittingThreadId: string | null;
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

// @nimi-authority: rule.nimi.runtime.agent-participation.r175
// @nimi-authority: rule.nimi.desktop.agent-projection.r029
export function useAgentRuntimeSessionSnapshotHydration(
  input: UseAgentRuntimeSessionSnapshotHydrationInput,
): void {
  const bindings = useDesktopRendererBindings();
  const visibleProjections = useAgentVisibleProjectionStore();
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cancelSubscription: () => Promise<void> = async () => {};
    const thread = input.selectedThreadRecord;
    const conversationAnchorId = normalizeText(input.activeConversationAnchorId);
    const agentHandle = normalizeText(thread?.targetSnapshot.agentHandle) as NimiLocalAppAgentHandle;
    if (input.authStatus !== 'authenticated' || !thread || !conversationAnchorId || !agentHandle
      || agentHandle !== normalizeText(input.activeAgentHandle)
      || input.isBundleLoading || Boolean(input.bundleError) || input.submittingThreadId === thread.id) {
      return () => { cancelled = true; };
    }

    const key = [agentHandle, conversationAnchorId, thread.id].join('|');
    activeKeyRef.current = key;
    const conversation = getDesktopConversationClient();
    const bufferedEvents: NimiLocalAppConversationEvent[] = [];
    let projection: CanonicalConversationProjection | null = null;
    let resyncing = false;
    let serial = Promise.resolve();

    const publish = async () => {
      if (!projection || cancelled || activeKeyRef.current !== key) return;
      const bundle = await materializeCanonicalConversationBundle({
        conversation,
        thread,
        projection,
        nowMs: bindings.clock.now(),
      });
      if (cancelled || activeKeyRef.current !== key) return;
      input.queryClient.setQueryData(bundleQueryKey(thread.id), bundle);
      visibleProjections.set(thread.id, bundle);
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
            // publish may resolve artifacts asynchronously. Consume any event
            // buffered during that work before exposing the resync as ready.
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
      await publish();
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
    })().catch((error) => {
      if (cancelled) return;
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
      if (activeKeyRef.current === key) activeKeyRef.current = null;
      void cancelSubscription().catch(() => undefined);
    };
  }, [
    bindings.clock,
    input.activeAgentHandle,
    input.activeConversationAnchorId,
    input.authStatus,
    input.buildHostErrorDetails,
    input.bundleError,
    input.isBundleLoading,
    input.onRuntimeError,
    input.queryClient,
    input.selectedThreadRecord,
    input.submittingThreadId,
    visibleProjections,
  ]);
}
