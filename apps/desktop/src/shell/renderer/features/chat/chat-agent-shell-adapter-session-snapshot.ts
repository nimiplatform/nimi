import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type {
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import {
  bundleQueryKey,
  THREADS_QUERY_KEY,
  upsertThreadSummary,
} from './chat-agent-shell-core';
import { hydrateAgentThreadBundleFromRuntimeSessionSnapshot } from './chat-agent-session-hydration';
import { setAgentVisibleProjection } from './chat-agent-visible-projection-store';

type AuthStatus = 'bootstrapping' | 'anonymous' | 'authenticated';

type RuntimeHostErrorDetailsBuilder = (
  error: unknown,
  action?: string,
  extra?: Record<string, unknown>,
) => Record<string, unknown>;

type UseAgentRuntimeSessionSnapshotHydrationInput = {
  activeLocalAgentRef: string | null | undefined;
  activeConversationAnchorId: string | null;
  authStatus: AuthStatus;
  buildHostErrorDetails: RuntimeHostErrorDetailsBuilder;
  bundleError: Error | null;
  isBundleLoading: boolean;
  queryClient: QueryClient;
  selectedThreadRecord: AgentLocalThreadSummary | null;
  submittingThreadId: string | null;
  threads: readonly AgentLocalThreadSummary[];
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

export function useAgentRuntimeSessionSnapshotHydration(
  input: UseAgentRuntimeSessionSnapshotHydrationInput,
): void {
  const lastRuntimeSessionSnapshotRequestKeyRef = useRef<string | null>(null);
  const pendingRuntimeSessionSnapshotRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const thread = input.selectedThreadRecord;
    const localAgentRef = normalizeText(input.activeLocalAgentRef || thread?.localAgentRef);
    const conversationAnchorId = normalizeText(input.activeConversationAnchorId);
    if (
      input.authStatus !== 'authenticated'
      || !thread
      || !localAgentRef
      || !conversationAnchorId
      || input.isBundleLoading
      || Boolean(input.bundleError)
      || input.submittingThreadId === thread.id
    ) {
      return () => {
        cancelled = true;
      };
    }
    const currentBundleAtRequest = input.queryClient.getQueryData<AgentLocalThreadBundle | null>(
      bundleQueryKey(thread.id),
    );
    const knownMessages = currentBundleAtRequest?.messages || [];
    const lastKnownMessage = knownMessages[knownMessages.length - 1] || null;
    const snapshotRequestKey = [
      localAgentRef,
      conversationAnchorId,
      thread.id,
      thread.updatedAtMs,
      thread.lastMessageAtMs || '',
      knownMessages.length,
      normalizeText(lastKnownMessage?.id),
      normalizeText(lastKnownMessage?.status),
    ].join('|');
    if (
      pendingRuntimeSessionSnapshotRequestKeyRef.current === snapshotRequestKey
      || lastRuntimeSessionSnapshotRequestKeyRef.current === snapshotRequestKey
    ) {
      logRendererEvent({
        level: 'info',
        area: 'agent-chat-shell-latency',
        message: 'action:desktop_runtime_agent_session_snapshot_request_deduped',
        details: {
          counter: 'desktop_runtime_agent_session_snapshot_request_deduped_total',
          value: 1,
          threadId: thread.id,
          conversationAnchorId,
          localAgentRef,
        },
      });
      return () => {
        cancelled = true;
      };
    }
    pendingRuntimeSessionSnapshotRequestKeyRef.current = snapshotRequestKey;
    const snapshotStartedAt = nowMs();
    logRendererEvent({
      level: 'info',
      area: 'agent-chat-shell-latency',
      message: 'action:desktop_runtime_agent_session_snapshot_request_total',
      details: {
        counter: 'desktop_runtime_agent_session_snapshot_request_total',
        value: 1,
        threadId: thread.id,
        conversationAnchorId,
        localAgentRef,
        submittingThreadId: input.submittingThreadId || null,
      },
    });
    void getPlatformClient().runtime.agent.turns.getSessionSnapshot({
      localAgentRef,
      ownerUserId: thread.ownerUserId,
      realmAgentId: thread.realmAgentId,
      conversationAnchorId,
    })
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        logRendererEvent({
          level: 'info',
          area: 'agent-chat-shell-latency',
          message: 'phase:desktop.runtime_agent.session_snapshot_request_ms',
          costMs: elapsedMs(snapshotStartedAt),
          details: {
            stage: 'desktop.runtime_agent.session_snapshot_request_ms',
            threadId: thread.id,
            conversationAnchorId,
            localAgentRef,
            transcriptMessageCount: Array.isArray(snapshot?.transcript) ? snapshot.transcript.length : null,
            hasActiveTurn: Boolean(snapshot?.activeTurn),
            hasLastTurn: Boolean(snapshot?.lastTurn),
            hasPendingFollowUp: Boolean(snapshot?.pendingFollowUp),
          },
        });
        const currentBundle = input.queryClient.getQueryData<AgentLocalThreadBundle | null>(
          bundleQueryKey(thread.id),
        );
        const hydratedBundle = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
          thread,
          bundle: currentBundle,
          conversationAnchorId,
          snapshot,
          nowMs: Date.now(),
        });
        if (!hydratedBundle) {
          return;
        }
        input.queryClient.setQueryData(bundleQueryKey(thread.id), hydratedBundle);
        setAgentVisibleProjection(thread.id, hydratedBundle);
        input.queryClient.setQueryData(THREADS_QUERY_KEY, (current: typeof input.threads | undefined) => (
          upsertThreadSummary(current || [], hydratedBundle.thread)
        ));
        lastRuntimeSessionSnapshotRequestKeyRef.current = snapshotRequestKey;
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-shell',
          message: 'action:host-error',
          details: input.buildHostErrorDetails(error, 'hydrate-runtime-agent-session', {
            threadId: thread.id,
            conversationAnchorId,
            localAgentRef,
          }),
        });
      })
      .finally(() => {
        if (pendingRuntimeSessionSnapshotRequestKeyRef.current === snapshotRequestKey) {
          pendingRuntimeSessionSnapshotRequestKeyRef.current = null;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    input.activeLocalAgentRef,
    input.activeConversationAnchorId,
    input.authStatus,
    input.buildHostErrorDetails,
    input.bundleError,
    input.isBundleLoading,
    input.queryClient,
    input.selectedThreadRecord,
    input.submittingThreadId,
    input.threads,
  ]);
}
