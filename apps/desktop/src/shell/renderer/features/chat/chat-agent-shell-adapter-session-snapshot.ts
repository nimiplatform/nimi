import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  NimiLocalAppAgentHandle,
} from '@nimiplatform/sdk/app';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

import type { AgentLocalThreadSummary } from '../../bridge/runtime-bridge/types';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { bundleQueryKey } from './chat-agent-shell-core';
import { useAgentVisibleProjectionStore } from './chat-agent-visible-projection-context.js';
import type { AuthStatus } from '../../app-shell/providers/app-store';
import {
  createCanonicalConversationMediaReader,
  type CanonicalConversationProjection,
  observeLocalAppConversation,
} from '@nimiplatform/kit/features/chat/headless';
import { materializeCanonicalConversationBundle } from './chat-agent-canonical-conversation-projection.js';

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

export type AgentRuntimeSessionHydrationState = {
  readonly controlState: import('@nimiplatform/sdk/app').NimiLocalAppConversationState | null;
  /** The conversation has history that has not been read yet. */
  readonly loading: boolean;
  readonly error: Error | null;
  readonly retry: () => void;
  readonly mediaReadError: 'failed' | 'retrying' | null;
  readonly retryMedia: () => void;
};

type HydrationOutcome = {
  readonly key: string;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: Error | null;
  readonly mediaReadError: 'failed' | 'retrying' | null;
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
  const mediaRef = useRef<{ key: string; reader: ReturnType<typeof createCanonicalConversationMediaReader> } | null>(null);
  const [outcome, setOutcome] = useState<HydrationOutcome | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [control, setControl] = useState<{key:string;value:import('@nimiplatform/sdk/app').NimiLocalAppConversationState}|null>(null);
  const retry = useCallback(() => { setAttempt(current=>current+1); }, []);
  const currentKey = hydrationKey(input);
  const retryMedia = useCallback(() => {
    if (mediaRef.current?.key === currentKey) mediaRef.current.reader.retryFailed();
  }, [currentKey]);

  useEffect(() => {
    let cancelled = false;
    const thread = input.selectedThreadRecord;
    const conversationAnchorId = normalizeText(input.activeConversationAnchorId);
    const agentHandle = normalizeText(thread?.targetSnapshot.agentHandle) as NimiLocalAppAgentHandle;
    const key = hydrationKey(input);
    if (!key || !thread) {
      return () => { cancelled = true; };
    }

    activeKeyRef.current = key;
    setOutcome((current) => (current?.key === key && current.status !== 'error'
      ? current
      : { key, status: 'loading', error: null, mediaReadError: null }));
    const conversation = bindings.sdk.conversation();
    let projection: CanonicalConversationProjection | null = null;
    const media = createCanonicalConversationMediaReader({
      conversation,
      scope: { agentHandle, conversationAnchorId },
      onChange: () => publish(),
    });
    mediaRef.current = { key, reader: media };
    const publish = (connectionReady = false): void => {
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
      const mediaReadError = media.getReadError();
      setOutcome((current) => {
        // Reloading optional bytes cannot claim the Conversation reconnected.
        if (!connectionReady && current?.key === key && current.status === 'error') {
          return current.mediaReadError === mediaReadError ? current : { ...current, mediaReadError };
        }
        return current?.key === key && current.status === 'ready' && current.mediaReadError === mediaReadError
          ? current : { key, status: 'ready', error: null, mediaReadError };
      });
    };

    const observation = observeLocalAppConversation({
      conversation,
      scope: { agentHandle, conversationAnchorId },
      onProjection: (value) => { projection = value; publish(true); },
      onStatus: (status, error) => {
        if (cancelled || activeKeyRef.current !== key || status !== 'error') return;
        setOutcome({ key, status: 'error', error: error instanceof Error ? error : new Error(String(error)), mediaReadError: media.getReadError() });
        input.onRuntimeError?.(error);
        logRendererEvent({ level: 'warn', area: 'agent-chat-shell', message: 'action:host-error',
          details: input.buildHostErrorDetails(error, 'hydrate-canonical-agent-conversation', { threadId: thread.id, conversationAnchorId }),
        });
      },
    });

    return () => {
      cancelled = true;
      media.close();
      if (mediaRef.current?.reader === media) mediaRef.current = null;
      if (activeKeyRef.current === key) activeKeyRef.current = null;
      observation.close();
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
    mediaReadError: settled?.mediaReadError ?? null,
    retryMedia,
  };
}
