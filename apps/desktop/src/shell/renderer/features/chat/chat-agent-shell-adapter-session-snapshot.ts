import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { createNimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type {
  AgentLocalThreadBundle,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  bundleQueryKey,
} from './chat-agent-shell-core';
import { hydrateAgentThreadBundleFromRuntimeSessionSnapshot } from './chat-agent-session-hydration';
import { useAgentVisibleProjectionStore } from './chat-agent-visible-projection-context.js';
import type { AuthStatus } from '../../app-shell/providers/app-store';

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
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function elapsedMs(startedAt: number, now: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

export function useAgentRuntimeSessionSnapshotHydration(
  input: UseAgentRuntimeSessionSnapshotHydrationInput,
): void {
  const bindings = useDesktopRendererBindings();
  const visibleProjections = useAgentVisibleProjectionStore();
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
    const snapshotStartedAt = bindings.clock.now();
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
    const runtimeAgent = createDesktopRuntimeAgentSessionSnapshotClient(bindings.sdk);
    void runtimeAgent.turns.getSessionSnapshot({
      localAgentRef,
      ownerUserId: thread.ownerUserId,
      runtimeSourceRef: thread.runtimeSourceRef,
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
          costMs: elapsedMs(snapshotStartedAt, bindings.clock.now()),
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
          nowMs: bindings.clock.now(),
        });
        if (!hydratedBundle) {
          return;
        }
        input.queryClient.setQueryData(bundleQueryKey(thread.id), hydratedBundle);
        visibleProjections.set(thread.id, hydratedBundle);
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
    bindings,
    input.activeLocalAgentRef,
    input.activeConversationAnchorId,
    input.authStatus,
    input.buildHostErrorDetails,
    input.bundleError,
    input.isBundleLoading,
    input.queryClient,
    input.selectedThreadRecord,
    input.submittingThreadId,
  ]);
}

function createDesktopRuntimeAgentSessionSnapshotClient(
  sdk: ReturnType<typeof useDesktopRendererBindings>['sdk'],
) {
  return createNimiRuntimeAgentConsumeClient({
    runtime: { agents: sdk.runtime().agents },
    runtimeAppId: sdk.appId(),
  });
}
