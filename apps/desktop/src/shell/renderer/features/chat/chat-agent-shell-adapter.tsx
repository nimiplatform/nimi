import {
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CanonicalDrawerSection,
  CanonicalComposer,
  createReadyConversationSetupState,
  type ChatComposerSubmitInput,
} from '@nimiplatform/nimi-kit/features/chat';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import {
  type AgentLocalDraftRecord,
  type AgentLocalMessageRecord,
  type AgentLocalTargetSnapshot,
  type AgentLocalThreadBundle,
  type AgentLocalThreadRecord,
  type AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { randomIdV11, type RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import {
  findAgentConversationThreadByAgentId,
  getAgentTargetDisplaySummary,
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
  toConversationMessageViewModel,
  toConversationThreadSummary,
} from './chat-agent-thread-model';
import {
  streamChatAgentRuntime,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import { resolveAiConversationRouteReadiness } from './chat-ai-route-readiness';
import type { AgentConversationSelection } from './chat-shell-types';
import { ChatSettingsPanel } from './chat-settings-panel';
import { ChatTargetSelector } from './chat-target-selector';
import {
  createReasoningMessageContentRenderer,
  RuntimeStreamFooter,
  useConversationStreamState,
} from './chat-runtime-stream-ui';
import {
  feedStreamEvent,
  getStreamState,
  startStream,
  STREAM_TEXT_TOTAL_TIMEOUT_MS,
} from '../turns/stream-controller';

type SocialSnapshot = Awaited<ReturnType<typeof dataSync.loadSocialSnapshot>>;

type UseAgentConversationModeHostInput = {
  authStatus: 'bootstrapping' | 'anonymous' | 'authenticated';
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  selection: AgentConversationSelection;
  lastSelectedThreadId: string | null;
  setSelection: (selection: AgentConversationSelection) => void;
};

const THREADS_QUERY_KEY = ['chat-agent-threads'];
const TARGETS_QUERY_KEY = ['chat-agent-friends'];

function bundleQueryKey(threadId: string): readonly ['chat-agent-thread-bundle', string] {
  return ['chat-agent-thread-bundle', threadId];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sortThreadSummaries(threads: readonly AgentLocalThreadSummary[]): AgentLocalThreadSummary[] {
  return [...threads].sort((left, right) => {
    const timeDelta = right.updatedAtMs - left.updatedAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function upsertThreadSummary(
  threads: readonly AgentLocalThreadSummary[],
  nextThread: AgentLocalThreadSummary,
): AgentLocalThreadSummary[] {
  const filtered = threads.filter((thread) => thread.id !== nextThread.id);
  filtered.push(nextThread);
  return sortThreadSummaries(filtered);
}

function replaceMessage(
  messages: readonly AgentLocalMessageRecord[],
  nextMessage: AgentLocalMessageRecord,
): AgentLocalMessageRecord[] {
  const filtered = messages.filter((message) => message.id !== nextMessage.id);
  filtered.push(nextMessage);
  return [...filtered].sort((left, right) => {
    const timeDelta = left.createdAtMs - right.createdAtMs;
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}

function upsertBundleDraft(
  bundle: AgentLocalThreadBundle | null | undefined,
  draft: AgentLocalDraftRecord | null,
): AgentLocalThreadBundle | null | undefined {
  if (!bundle) {
    return bundle;
  }
  return {
    ...bundle,
    draft,
  };
}

function createEmptyBundle(thread: AgentLocalThreadRecord): AgentLocalThreadBundle {
  return {
    thread,
    messages: [],
    draft: null,
  };
}

function toErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || fallback);
}

function normalizeReasoningText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isEmptyPendingAssistantMessage(message: ReturnType<typeof toConversationMessageViewModel>): boolean {
  if (message.role !== 'assistant' || message.status !== 'pending') {
    return false;
  }
  return !message.text.trim() && !normalizeReasoningText(message.metadata?.reasoningText) && !message.error;
}

function ChatAgentTargetRail(input: {
  target: AgentLocalTargetSnapshot;
}) {
  const { t } = useTranslation();
  const navigateToProfile = useAppStore((state) => state.navigateToProfile);
  const navigateToWorld = useAppStore((state) => state.navigateToWorld);
  const detailQuery = useQuery({
    queryKey: ['agent-chat-target-detail', input.target.agentId],
    queryFn: async () => dataSync.loadAgentDetails(input.target.agentId),
    enabled: Boolean(input.target.agentId),
  });

  const profile = detailQuery.data;
  const displayName = String(profile?.displayName || input.target.displayName).trim() || input.target.displayName;
  const handle = String(profile?.handle || input.target.handle).trim() || input.target.handle;
  const bio = String(profile?.bio || input.target.bio || '').trim() || null;
  const worldId = String(profile?.worldId || input.target.worldId || '').trim() || null;
  const worldName = String(profile?.worldName || input.target.worldName || '').trim() || null;

  return (
    <div className="space-y-4">
      <CanonicalDrawerSection title={t('Chat.agentTarget', { defaultValue: 'Agent target' })}>
        <div>
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {displayName}
          </div>
          <div className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            @{handle}
          </div>
        </div>
        {bio ? (
          <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">
            {bio}
          </p>
        ) : null}
        <div className="space-y-1 text-xs text-[var(--nimi-text-muted)]">
          {worldName ? <div>{worldName}</div> : null}
          {input.target.ownershipType ? <div>{input.target.ownershipType}</div> : null}
        </div>
      </CanonicalDrawerSection>
      <CanonicalDrawerSection title={t('Chat.agentActions', { defaultValue: 'Actions' })}>
        <Button
          tone="secondary"
          size="sm"
          fullWidth
          onClick={() => navigateToProfile(input.target.agentId, 'agent-detail')}
        >
          {t('Chat.agentOpenProfile', { defaultValue: 'Open agent profile' })}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          fullWidth
          disabled={!worldId}
          onClick={() => {
            if (worldId) {
              navigateToWorld(worldId);
            }
          }}
        >
          {t('Chat.agentOpenWorld', { defaultValue: 'Open world' })}
        </Button>
      </CanonicalDrawerSection>
    </div>
  );
}

export function useAgentConversationModeHost(
  input: UseAgentConversationModeHostInput,
): DesktopConversationModeHost {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [submittingThreadId, setSubmittingThreadId] = useState<string | null>(null);
  const currentDraftTextRef = useRef('');
  const creatingThreadForAgentIdRef = useRef<string | null>(null);
  const reportHostError = useCallback((error: unknown) => {
    setStatusBanner({
      kind: 'error',
      message: toErrorMessage(error),
    });
  }, [setStatusBanner]);

  const setSelection = useCallback((selection: AgentConversationSelection) => {
    if (
      input.selection.threadId === selection.threadId
      && input.selection.agentId === selection.agentId
      && input.selection.targetId === selection.targetId
    ) {
      return;
    }
    input.setSelection(selection);
  }, [input]);

  const targetsQuery = useQuery({
    queryKey: [...TARGETS_QUERY_KEY, input.authStatus],
    queryFn: async (): Promise<AgentLocalTargetSnapshot[]> => {
      const snapshot = await dataSync.loadSocialSnapshot() as SocialSnapshot;
      return toAgentFriendTargetsFromSocialSnapshot(snapshot);
    },
    enabled: input.authStatus === 'authenticated',
  });

  const targets = useMemo(
    () => targetsQuery.data || [],
    [targetsQuery.data],
  );
  const targetByAgentId = useMemo(
    () => new Map(targets.map((target) => [target.agentId, target])),
    [targets],
  );

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: () => chatAgentStoreClient.listThreads(),
    enabled: input.authStatus === 'authenticated',
  });
  const threads = useMemo(
    () => sortThreadSummaries(threadsQuery.data || []),
    [threadsQuery.data],
  );

  const activeThreadId = useMemo(
    () => resolveAgentConversationActiveThreadId({
      threads,
      selectionThreadId: input.selection.threadId,
      selectionAgentId: input.selection.agentId,
      lastSelectedThreadId: input.lastSelectedThreadId,
    }),
    [input.lastSelectedThreadId, input.selection.agentId, input.selection.threadId, threads],
  );

  const selectedThreadRecord = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || null,
    [activeThreadId, threads],
  );
  const selectedTarget = useMemo(
    () => targetByAgentId.get(input.selection.agentId || '') || null,
    [input.selection.agentId, targetByAgentId],
  );
  const activeTarget = selectedThreadRecord?.targetSnapshot || selectedTarget || null;

  const agentRouteReadiness = useMemo(
    () => resolveAiConversationRouteReadiness({ runtimeConfigState: input.runtimeConfigState }),
    [input.runtimeConfigState],
  );
  const agentRouteReady = agentRouteReadiness.status === 'ready';

  const bundleQuery = useQuery({
    queryKey: activeThreadId ? bundleQueryKey(activeThreadId) : ['chat-agent-thread-bundle', 'inactive'],
    queryFn: () => chatAgentStoreClient.getThreadBundle(activeThreadId as string),
    enabled: Boolean(activeThreadId),
  });
  const bundle = bundleQuery.data || null;
  const messages = useMemo(
    () => (bundle?.messages || [])
      .map((message: AgentLocalMessageRecord) => toConversationMessageViewModel(message))
      .filter((message) => !isEmptyPendingAssistantMessage(message)),
    [bundle?.messages],
  );
  const streamState = useConversationStreamState(activeThreadId);
  const isBundleLoading = Boolean(activeThreadId) && bundleQuery.isPending && !bundle;

  const setupState = useMemo(() => {
    if (input.authStatus !== 'authenticated') {
      return {
        mode: 'agent' as const,
        status: 'setup-required' as const,
        issues: [{ code: 'agent-contract-unavailable' as const, detail: 'Sign in to use Agent mode' }],
        primaryAction: {
          kind: 'sign-in' as const,
          returnToMode: 'agent' as const,
        },
      };
    }
    if (!activeTarget) {
      return createReadyConversationSetupState('agent');
    }
    if (agentRouteReady) {
      return createReadyConversationSetupState('agent');
    }
    const agentIssues = agentRouteReadiness.setupState.issues;
    const agentAction = agentRouteReadiness.setupState.primaryAction
      ? { ...agentRouteReadiness.setupState.primaryAction, returnToMode: 'agent' as const }
      : {
        kind: 'open-settings' as const,
        targetId: 'runtime-overview' as const,
        returnToMode: 'agent' as const,
      };
    return {
      mode: 'agent' as const,
      status: 'setup-required' as const,
      issues: agentIssues,
      primaryAction: agentAction,
    };
  }, [activeTarget, agentRouteReady, agentRouteReadiness.setupState, input.authStatus]);

  const composerReady = setupState.status === 'ready'
    && !isBundleLoading
    && !bundleQuery.error;

  const setThreadsCache = useCallback((updater: (current: AgentLocalThreadSummary[]) => AgentLocalThreadSummary[]) => {
    queryClient.setQueryData<AgentLocalThreadSummary[]>(THREADS_QUERY_KEY, (current) => {
      const safeCurrent = Array.isArray(current) ? current : [];
      return updater(safeCurrent);
    });
  }, [queryClient]);

  const setBundleCache = useCallback((
    threadId: string,
    updater: (current: AgentLocalThreadBundle | null | undefined) => AgentLocalThreadBundle | null | undefined,
  ) => {
    queryClient.setQueryData<AgentLocalThreadBundle | null>(bundleQueryKey(threadId), (current) => updater(current));
  }, [queryClient]);

  const syncSelectionToThread = useCallback((thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null) => {
    if (!thread) {
      setSelection({
        threadId: null,
        agentId: null,
        targetId: null,
      });
      return;
    }
    setSelection({
      threadId: thread.id,
      agentId: thread.agentId,
      targetId: thread.agentId,
    });
  }, [setSelection]);

  useEffect(() => {
    currentDraftTextRef.current = bundle?.draft?.text || '';
  }, [bundle?.draft?.text, bundle?.draft?.updatedAtMs]);

  const persistDraftForThread = useCallback(async (threadId: string | null) => {
    const normalizedThreadId = normalizeText(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const nextText = currentDraftTextRef.current;
    if (nextText.trim()) {
      const draft = await chatAgentStoreClient.putDraft({
        threadId: normalizedThreadId,
        text: nextText,
        updatedAtMs: Date.now(),
      });
      setBundleCache(
        normalizedThreadId,
        (current: AgentLocalThreadBundle | null | undefined) => upsertBundleDraft(current, draft) || current,
      );
      return;
    }
    await chatAgentStoreClient.deleteDraft(normalizedThreadId);
    setBundleCache(
      normalizedThreadId,
      (current: AgentLocalThreadBundle | null | undefined) => upsertBundleDraft(current, null) || current,
    );
  }, [setBundleCache]);

  const createOrRestoreThreadForTarget = useCallback(async (target: AgentLocalTargetSnapshot) => {
    const existingThread = findAgentConversationThreadByAgentId(threads, target.agentId);
    if (existingThread) {
      syncSelectionToThread(existingThread);
      return existingThread;
    }
    const timestampMs = Date.now();
    try {
      const thread = await chatAgentStoreClient.createThread({
        id: randomIdV11('agent-thread'),
        agentId: target.agentId,
        title: target.displayName,
        createdAtMs: timestampMs,
        updatedAtMs: timestampMs,
        lastMessageAtMs: null,
        archivedAtMs: null,
        targetSnapshot: target,
      });
      setThreadsCache((current) => upsertThreadSummary(current, thread));
      queryClient.setQueryData(bundleQueryKey(thread.id), createEmptyBundle(thread));
      currentDraftTextRef.current = '';
      syncSelectionToThread(thread);
      return thread;
    } catch (error) {
      if (toErrorMessage(error).includes('duplicate primary key or unique value')) {
        const refreshedThreads = await chatAgentStoreClient.listThreads();
        queryClient.setQueryData(THREADS_QUERY_KEY, refreshedThreads);
        const restored = findAgentConversationThreadByAgentId(refreshedThreads, target.agentId);
        if (restored) {
          syncSelectionToThread(restored);
          return restored;
        }
      }
      throw error;
    }
  }, [queryClient, setThreadsCache, syncSelectionToThread, threads]);

  useEffect(() => {
    if (!threadsQuery.isSuccess) {
      return;
    }
    if (input.selection.threadId && !threads.some((thread) => thread.id === input.selection.threadId) && !input.selection.agentId) {
      syncSelectionToThread(null);
      return;
    }
    if (!input.selection.threadId && selectedThreadRecord) {
      syncSelectionToThread(selectedThreadRecord);
    }
  }, [
    input.selection.agentId,
    input.selection.threadId,
    selectedThreadRecord,
    syncSelectionToThread,
    threads,
    threadsQuery.isSuccess,
  ]);

  useEffect(() => {
    if (!targetsQuery.isSuccess || !threadsQuery.isSuccess) {
      return;
    }
    const selectedAgentId = normalizeText(input.selection.agentId);
    if (!selectedAgentId) {
      return;
    }
    const target = targetByAgentId.get(selectedAgentId) || null;
    if (!target) {
      if (!findAgentConversationThreadByAgentId(threads, selectedAgentId)) {
        syncSelectionToThread(null);
      }
      return;
    }
    if (findAgentConversationThreadByAgentId(threads, selectedAgentId)) {
      return;
    }
    if (creatingThreadForAgentIdRef.current === selectedAgentId) {
      return;
    }
    creatingThreadForAgentIdRef.current = selectedAgentId;
    void createOrRestoreThreadForTarget(target)
      .catch(reportHostError)
      .finally(() => {
        if (creatingThreadForAgentIdRef.current === selectedAgentId) {
          creatingThreadForAgentIdRef.current = null;
        }
      });
  }, [
    createOrRestoreThreadForTarget,
    input.selection.agentId,
    reportHostError,
    syncSelectionToThread,
    targetByAgentId,
    targetsQuery.isSuccess,
    threads,
    threadsQuery.isSuccess,
  ]);

  const handleSelectThread = useCallback((threadId: string) => {
    if (!threadId || threadId === activeThreadId || submittingThreadId) {
      return;
    }
    const nextThread = threads.find((thread) => thread.id === threadId) || null;
    if (!nextThread) {
      return;
    }
    void (async () => {
      await persistDraftForThread(activeThreadId);
      currentDraftTextRef.current = '';
      syncSelectionToThread(nextThread);
    })().catch(reportHostError);
  }, [activeThreadId, persistDraftForThread, reportHostError, submittingThreadId, syncSelectionToThread, threads]);

  const handleSelectAgent = useCallback((agentId: string | null) => {
    if (submittingThreadId) {
      return;
    }
    void (async () => {
      await persistDraftForThread(activeThreadId);
      currentDraftTextRef.current = '';
      const normalizedAgentId = normalizeText(agentId);
      if (!normalizedAgentId) {
        syncSelectionToThread(null);
        return;
      }
      const target = targetByAgentId.get(normalizedAgentId);
      if (!target) {
        throw new Error(t('Chat.agentTargetMissing', {
          defaultValue: 'The selected agent friend is no longer available.',
        }));
      }
      await createOrRestoreThreadForTarget(target);
    })().catch(reportHostError);
  }, [
    activeThreadId,
    createOrRestoreThreadForTarget,
    persistDraftForThread,
    reportHostError,
    submittingThreadId,
    syncSelectionToThread,
    t,
    targetByAgentId,
  ]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!activeThreadId || !selectedThreadRecord || !activeTarget) {
      throw new Error(t('Chat.agentSubmitMissingThread', {
        defaultValue: 'Select an agent friend before sending a message.',
      }));
    }
    if (!agentRouteReady) {
      throw new Error(t('Chat.agentSubmitRouteUnavailable', {
        defaultValue: 'A local or cloud runtime route is required before sending a message.',
      }));
    }
    const submittedText = text.trim();
    if (!submittedText) {
      return;
    }
    const userMessageId = randomIdV11('agent-message-user');
    const assistantMessageId = randomIdV11('agent-message-assistant');
    const createdAtMs = Date.now();
    const userMessage: AgentLocalMessageRecord = {
      id: userMessageId,
      threadId: activeThreadId,
      role: 'user',
      status: 'complete',
      contentText: submittedText,
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: null,
      createdAtMs,
      updatedAtMs: createdAtMs,
    };
    const assistantPlaceholder: AgentLocalMessageRecord = {
      id: assistantMessageId,
      threadId: activeThreadId,
      role: 'assistant',
      status: 'pending',
      contentText: '',
      reasoningText: null,
      error: null,
      traceId: null,
      parentMessageId: userMessageId,
      createdAtMs: createdAtMs + 1,
      updatedAtMs: createdAtMs + 1,
    };

    currentDraftTextRef.current = submittedText;
    setSubmittingThreadId(activeThreadId);
    let streamedText = '';
    let streamedReasoningText = '';
    let runtimeTraceId: string | null = null;
    let promptTraceId = '';

    try {
      await chatAgentStoreClient.deleteDraft(activeThreadId);
      setBundleCache(activeThreadId, (current) => upsertBundleDraft(current, null) || current);

      await chatAgentStoreClient.createMessage(userMessage);
      await chatAgentStoreClient.createMessage(assistantPlaceholder);
      setBundleCache(activeThreadId, (current) => {
        const base = current || createEmptyBundle({
          ...selectedThreadRecord,
          createdAtMs,
        });
        return {
          ...base,
          messages: replaceMessage(
            replaceMessage(base.messages, userMessage),
            assistantPlaceholder,
          ),
          draft: null,
        };
      });

      const abortController = startStream(activeThreadId, STREAM_TEXT_TOTAL_TIMEOUT_MS);
      const runtimeResult = await streamChatAgentRuntime({
        agentId: activeTarget.agentId,
        prompt: submittedText,
        threadId: activeThreadId,
        routeResult: null,
        runtimeConfigState: input.runtimeConfigState,
        runtimeFields: input.runtimeFields,
        signal: abortController.signal,
      });
      promptTraceId = runtimeResult.promptTraceId;
      for await (const part of runtimeResult.stream) {
        if (part.type === 'reasoning-delta') {
          streamedReasoningText += part.text;
          feedStreamEvent(activeThreadId, {
            type: 'reasoning_delta',
            textDelta: part.text,
          });
          continue;
        }
        if (part.type === 'delta') {
          streamedText += part.text;
          feedStreamEvent(activeThreadId, {
            type: 'text_delta',
            textDelta: part.text,
          });
          continue;
        }
        if (part.type === 'finish') {
          runtimeTraceId = String(part.trace.traceId || promptTraceId || '').trim() || null;
          feedStreamEvent(activeThreadId, { type: 'done', usage: part.usage });
          continue;
        }
        if (part.type === 'error') {
          runtimeTraceId = String(part.error.traceId || runtimeTraceId || promptTraceId || '').trim() || null;
          feedStreamEvent(activeThreadId, {
            type: 'error',
            message: part.error.message,
            reasonCode: part.error.reasonCode,
            traceId: runtimeTraceId || undefined,
          });
          throw part.error;
        }
      }
      const completedState = getStreamState(activeThreadId);
      const finalText = completedState.partialText || streamedText;
      const finalReasoningText = completedState.partialReasoningText || streamedReasoningText;
      const assistantMessage = await chatAgentStoreClient.updateMessage({
        id: assistantMessageId,
        status: 'complete',
        contentText: finalText,
        reasoningText: finalReasoningText || null,
        error: null,
        traceId: runtimeTraceId || promptTraceId || null,
        updatedAtMs: Date.now(),
      });
      const updatedThread = await chatAgentStoreClient.updateThreadMetadata({
        id: selectedThreadRecord.id,
        title: selectedThreadRecord.title,
        updatedAtMs: Date.now(),
        lastMessageAtMs: assistantMessage.updatedAtMs,
        archivedAtMs: selectedThreadRecord.archivedAtMs,
        targetSnapshot: activeTarget,
      });
      setThreadsCache((current) => upsertThreadSummary(current, updatedThread));
      setBundleCache(activeThreadId, (current) => {
        const base = current || createEmptyBundle(updatedThread);
        return {
          ...base,
          thread: updatedThread,
          messages: replaceMessage(base.messages, assistantMessage),
          draft: null,
        };
      });
      currentDraftTextRef.current = '';
      syncSelectionToThread(updatedThread);
    } catch (error) {
      const streamSnapshot = getStreamState(activeThreadId);
      const partialText = streamSnapshot.partialText || streamedText;
      const partialReasoningText = streamSnapshot.partialReasoningText || streamedReasoningText;
      const runtimeError = streamSnapshot.cancelSource === 'user'
        ? {
          code: 'OPERATION_ABORTED',
          message: t('Chat.agentGenerationStopped', { defaultValue: 'Generation stopped.' }),
        }
        : toChatAgentRuntimeError(error);
      if (streamSnapshot.phase === 'waiting' || streamSnapshot.phase === 'streaming') {
        feedStreamEvent(activeThreadId, {
          type: 'error',
          message: runtimeError.message,
          reasonCode: runtimeError.code,
          traceId: streamSnapshot.traceId || runtimeTraceId || promptTraceId || undefined,
        });
      }
      const draft = await chatAgentStoreClient.putDraft({
        threadId: activeThreadId,
        text: submittedText,
        updatedAtMs: Date.now(),
      });
      setBundleCache(activeThreadId, (current) => upsertBundleDraft(current, draft) || current);
      try {
        const assistantError = await chatAgentStoreClient.updateMessage({
          id: assistantMessageId,
          status: 'error',
          contentText: partialText,
          reasoningText: partialReasoningText || null,
          error: runtimeError,
          traceId: streamSnapshot.traceId || runtimeTraceId || promptTraceId || null,
          updatedAtMs: Date.now(),
        });
        setBundleCache(activeThreadId, (current) => {
          const base = current || createEmptyBundle({
            ...selectedThreadRecord,
            createdAtMs,
          });
          return {
            ...base,
            messages: replaceMessage(
              replaceMessage(base.messages, userMessage),
              assistantError,
            ),
            draft,
          };
        });
      } catch {
        setBundleCache(activeThreadId, (current) => {
          const base = current || createEmptyBundle({
            ...selectedThreadRecord,
            createdAtMs,
          });
          return {
            ...base,
            messages: replaceMessage(base.messages, userMessage),
            draft,
          };
        });
      }
      currentDraftTextRef.current = submittedText;
      throw new Error(runtimeError.message, {
        cause: error,
      });
    } finally {
      setSubmittingThreadId(null);
    }
  }, [
    activeTarget,
    activeThreadId,
    agentRouteReady,
    input.runtimeConfigState,
    input.runtimeFields,
    selectedThreadRecord,
    setBundleCache,
    setThreadsCache,
    syncSelectionToThread,
    t,
  ]);

  const adapter = useMemo(() => ({
    mode: 'agent' as const,
    setupState,
    threadAdapter: {
      listThreads: () => threads.map((thread) => toConversationThreadSummary(thread)),
      listMessages: (threadId: string) => (
        bundle && bundle.thread.id === threadId
          ? messages
          : []
      ),
    },
    composerAdapter: composerReady
      ? {
        submit: async (composerInput: ChatComposerSubmitInput<unknown>) => {
          await handleSubmit(composerInput.text);
        },
        disabled: Boolean(submittingThreadId),
        disabledReason: submittingThreadId
          ? t('Chat.agentSending', { defaultValue: 'Waiting for agent response…' })
          : null,
        placeholder: t('Chat.agentComposerPlaceholder', { defaultValue: 'Talk to this agent…' }),
      }
      : null,
  }), [bundle, composerReady, handleSubmit, messages, setupState, submittingThreadId, t, threads]);

  const characterData = useMemo(() => {
    if (!activeTarget) {
      return { name: t('Chat.agentTitle', { defaultValue: 'Agent Chat' }), avatarFallback: 'A' };
    }
    return {
      avatarUrl: null,
      avatarFallback: (activeTarget.displayName || 'A').charAt(0).toUpperCase(),
      name: activeTarget.displayName || 'Agent',
      handle: activeTarget.handle ? `@${activeTarget.handle}` : null,
      bio: activeTarget.bio || null,
      presenceLabel: activeTarget.worldName || t('Chat.mode.agent', { defaultValue: 'Agent' }),
      presenceBusy: false,
      theme: {
        roomSurface: 'linear-gradient(180deg, rgba(250,252,252,0.98), rgba(244,247,248,0.96))',
        roomAura: 'linear-gradient(135deg,rgba(255,255,255,0.9),rgba(236,253,245,0.78))',
        accentSoft: 'rgba(16,185,129,0.20)',
        accentStrong: '#10b981',
        border: 'rgba(16,185,129,0.34)',
        text: '#065f46',
      },
      badges: [
        ...(activeTarget.worldName ? [{ label: activeTarget.worldName, variant: 'default' as const }] : []),
        ...(activeTarget.ownershipType ? [{ label: activeTarget.ownershipType, variant: 'new' as const }] : []),
      ],
    };
  }, [activeTarget, t]);
  const targetSummaries = useMemo(
    () => targets.map((target) => ({
      id: target.agentId,
      source: 'agent' as const,
      canonicalSessionId: findAgentConversationThreadByAgentId(threads, target.agentId)?.id || target.agentId,
      title: target.displayName,
      handle: target.handle ? `@${target.handle}` : null,
      bio: target.bio || null,
      avatarUrl: target.avatarUrl || null,
      avatarFallback: target.displayName.charAt(0).toUpperCase() || 'A',
      previewText: null,
      updatedAt: null,
      unreadCount: 0,
      status: 'active' as const,
      isOnline: null,
      metadata: {
        worldName: target.worldName,
        ownershipType: target.ownershipType,
      },
    })),
    [targets, threads],
  );
  const canonicalMessages = useMemo(
    () => messages.map((message) => ({
      id: message.id,
      sessionId: activeThreadId || activeTarget?.agentId || 'agent',
      targetId: activeTarget?.agentId || '',
      source: 'agent' as const,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      status: message.status,
      error: message.error,
      kind: 'text' as const,
      metadata: message.metadata,
    })),
    [activeTarget?.agentId, activeThreadId, messages],
  );
  const reasoningLabel = t('Chat.reasoningLabel', { defaultValue: 'Thought process' });
  const renderMessageContent = useMemo(
    () => createReasoningMessageContentRenderer(reasoningLabel),
    [reasoningLabel],
  );
  const footerContent = useMemo<ReactNode>(() => {
    if (!activeThreadId) {
      return null;
    }
    return (
      <RuntimeStreamFooter
        chatId={activeThreadId}
        assistantName={characterData.name}
        assistantAvatarUrl={characterData.avatarUrl || null}
        assistantKind="agent"
        streamState={streamState}
        stopLabel={t('ChatTimeline.stopGenerating', 'Stop generating')}
        interruptedLabel={t('ChatTimeline.streamInterrupted', 'Response interrupted')}
        reasoningLabel={reasoningLabel}
      />
    );
  }, [activeThreadId, characterData.avatarUrl, characterData.name, reasoningLabel, streamState, t]);
  const pendingFirstBeat = Boolean(
    streamState
    && streamState.phase === 'waiting'
    && !streamState.partialText
    && !streamState.partialReasoningText,
  );

  return useMemo<DesktopConversationModeHost>(() => ({
    mode: 'agent',
    availability: {
      mode: 'agent',
      label: 'Agent',
      enabled: true,
      badge: threads.length > 0 ? threads.length : null,
      disabledReason: null,
    },
    adapter,
    activeThreadId,
    targets: targetSummaries,
    selectedTargetId: input.selection.agentId || activeTarget?.agentId || null,
    onSelectTarget: handleSelectAgent,
    messages: canonicalMessages,
    characterData,
    settingsContent: (
      <ChatSettingsPanel
        headerSlot={(
          <CanonicalDrawerSection title={t('Chat.agentSelectLabel', { defaultValue: 'Agent friend' })}>
            <ChatTargetSelector
              options={targets.map((target) => ({
                id: target.agentId,
                label: target.displayName,
                handle: target.handle,
              }))}
              value={input.selection.agentId || null}
              onChange={handleSelectAgent}
              placeholder={t('Chat.agentSelectPlaceholder', { defaultValue: 'Select an agent friend' })}
              disabled={targetsQuery.isPending || Boolean(submittingThreadId)}
            />
          </CanonicalDrawerSection>
        )}
      />
    ),
    settingsDrawerTitle: t('Chat.settingsTitle', { defaultValue: 'Settings' }),
    settingsDrawerSubtitle: t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' }),
    transcriptProps: {
      loading: isBundleLoading,
      error: bundleQuery.error ? toErrorMessage(bundleQuery.error) : null,
      emptyEyebrow: 'Agent',
      emptyTitle: t('Chat.agentTranscriptEmptyTitle', { defaultValue: 'Start the local agent conversation' }),
      emptyDescription: t('Chat.agentTranscriptEmpty', { defaultValue: 'Send a message to start the local agent conversation.' }),
      loadingLabel: t('Chat.agentTranscriptLoading', { defaultValue: 'Loading local agent conversation…' }),
      footerContent,
      renderMessageContent,
      pendingFirstBeat,
    },
    stagePanelProps: {
      footerContent,
      renderMessageContent,
      pendingFirstBeat,
    },
    composerContent: (
      adapter.composerAdapter ? (
        <CanonicalComposer
          key={`${activeThreadId || 'none'}:${bundle?.draft?.updatedAtMs || 0}`}
          adapter={adapter.composerAdapter}
          initialText={bundle?.draft?.text || ''}
          disabled={Boolean(submittingThreadId)}
          placeholder={t('Chat.agentComposerPlaceholder', { defaultValue: 'Talk to this agent…' })}
          onInputCaptureText={(text) => {
            currentDraftTextRef.current = text;
          }}
        />
      ) : null
    ),
    profileContent: activeTarget ? <ChatAgentTargetRail target={activeTarget} /> : null,
    profileDrawerTitle: t('Chat.profileTitle', { defaultValue: 'Profile' }),
    profileDrawerSubtitle: t('Chat.agentProfileSubtitle', { defaultValue: 'Relationship, memory, and target details.' }),
    onSelectThread: handleSelectThread,
    renderEmptyState: () => {
      if (targetsQuery.error) {
        return (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-[var(--nimi-status-danger)]">
            {toErrorMessage(targetsQuery.error)}
          </div>
        );
      }
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
            {targets.length > 0
              ? t('Chat.agentEmptyTitle', { defaultValue: 'Choose an agent friend' })
              : t('Chat.agentNoTargetsTitle', { defaultValue: 'No agent friends yet' })}
          </h2>
          <p className="max-w-[420px] text-sm text-[var(--nimi-text-muted)]">
            {targets.length > 0
              ? t('Chat.agentEmptyDescription', {
                defaultValue: 'Pick one of your agent friends from the left. Each agent keeps a single desktop-owned local conversation.',
              })
              : t('Chat.agentNoTargetsDescription', {
                defaultValue: 'Agent mode only uses your current agent friends as local chat targets.',
              })}
          </p>
        </div>
      );
    },
    renderSetupDescription: () => {
      return t('Chat.agentRouteRequired', {
        defaultValue: 'Agent mode requires a local or cloud runtime route. Configure one in runtime settings.',
      });
    },
    renderThreadMeta: (thread) => {
      const sourceThread = threads.find((item) => item.id === thread.id) || null;
      return (
        <span className="truncate text-[11px] text-[var(--nimi-text-muted)]">
          {sourceThread ? getAgentTargetDisplaySummary(sourceThread.targetSnapshot) : ''}
        </span>
      );
    },
  }), [
    activeTarget,
    activeThreadId,
    adapter,
    bundle?.draft?.text,
    bundle?.draft?.updatedAtMs,
    bundleQuery.error,
    canonicalMessages,
    handleSelectAgent,
    handleSelectThread,
    handleSubmit,
    input.selection.agentId,
    isBundleLoading,
    footerContent,
    pendingFirstBeat,
    renderMessageContent,
    submittingThreadId,
    t,
    targetSummaries,
    targets,
    targetsQuery.error,
    targetsQuery.isPending,
    threads,
  ]);
}
