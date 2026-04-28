import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { AnalysisPackage, AnalystMessage, TaxonomyOverlay, WindowKey } from '@renderer/data/types.js';
import {
  loadTextGenerateRouteOptions,
  resolveTextGenerateRouteStatus,
  summarizeRuntimeBinding,
} from '@renderer/data/runtime-routes.js';
import {
  buildAnalystSystemPrompt,
  buildSnapshotFromAssistantMessage,
  extractDraftProposal,
} from './sector-analyst.js';
import { buildEmptyConversationMessage } from './sector-workspace-state.js';
import { streamSectorAnalyst } from './sector-analyst-runtime.js';
import { ProposalCard, createMessage, isStaleRuntimeBridgeError } from './sector-workspace-panel-helpers.js';

type AnalystSidebarProps = {
  sectorId: string;
  sectorLabel: string;
  activeWindow: WindowKey;
  marketDataRequested: boolean;
  analysisReady: boolean;
  overlay: TaxonomyOverlay;
  analysisPackageRef: { current: AnalysisPackage | null };
};
export const AnalystSidebar = memo(function AnalystSidebar({
  sectorId,
  sectorLabel,
  activeWindow,
  marketDataRequested,
  analysisReady,
  overlay,
  analysisPackageRef,
}: AnalystSidebarProps) {
  const auth = useAppStore((state) => state.auth);
  const aiConfig = useAppStore((state) => state.aiConfig);
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const ensureSectorThread = useAppStore((state) => state.ensureSectorThread);
  const chatState = useAppStore((state) => state.chatsBySector[sectorId]);
  const setSectorDraftText = useAppStore((state) => state.setSectorDraftText);
  const upsertSectorMessage = useAppStore((state) => state.upsertSectorMessage);
  const setSectorStreaming = useAppStore((state) => state.setSectorStreaming);
  const setSectorError = useAppStore((state) => state.setSectorError);
  const setSectorDraftProposal = useAppStore((state) => state.setSectorDraftProposal);
  const resetSectorConversation = useAppStore((state) => state.resetSectorConversation);
  const recordAnalysisSnapshot = useAppStore((state) => state.recordAnalysisSnapshot);
  const [streamingAssistant, setStreamingAssistant] = useState<AnalystMessage | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    ensureSectorThread(sectorId, `${sectorLabel} Analyst`);
  }, [ensureSectorThread, sectorId, sectorLabel]);
  useEffect(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setStreamingAssistant(null);
  }, [sectorId]);
  const conversation = chatState?.messages ?? [];
  const isStreaming = chatState?.isStreaming ?? false;
  const chatError = chatState?.error ?? null;
  const draftText = chatState?.draftText ?? '';
  const routeOptionsQuery = useQuery({
    queryKey: ['polyinfo', 'sector-route-options', sectorId, JSON.stringify(aiConfig.capabilities.selectedBindings['text.generate'] || null)],
    queryFn: () => loadTextGenerateRouteOptions({ aiConfig, runtimeDefaults }),
    staleTime: 30_000,
    retry: false,
  });
  const routeStatus = resolveTextGenerateRouteStatus({
    aiConfig,
    runtimeDefaults,
    routeOptions: routeOptionsQuery.data,
    authStatus: auth.status,
  });
  const bindingSummary = routeStatus.ready
    ? summarizeRuntimeBinding(routeStatus.binding)
    : {
      title: routeStatus.title,
      detail: routeStatus.detail,
      ready: routeStatus.ready,
    };
  const routeNotice = routeOptionsQuery.isError
    ? `运行配置读取失败：${routeOptionsQuery.error instanceof Error ? routeOptionsQuery.error.message : 'unknown error'}`
    : !routeStatus.ready
      ? routeStatus.detail
      : null;
  useEffect(() => {
    if (!routeStatus.ready || !isStaleRuntimeBridgeError(chatError)) {
      return;
    }
    setSectorError(sectorId, null);
  }, [chatError, routeStatus.ready, sectorId, setSectorError]);
  const visibleConversation = useMemo(
    () => (streamingAssistant ? [...conversation, streamingAssistant] : conversation),
    [conversation, streamingAssistant],
  );
  const emptyConversationMessage = buildEmptyConversationMessage({
    sectorLabel,
    marketDataRequested,
    analysisReady,
    loadingMarketData: marketDataRequested && !analysisReady,
  });
  const sendPrompt = useCallback(async (prompt: string) => {
    const analysisPackage = analysisPackageRef.current;
    if (!routeOptionsQuery.data || !routeStatus.ready || !routeStatus.binding) {
      const blockedMessage = routeOptionsQuery.isError
        ? `运行配置读取失败：${routeOptionsQuery.error instanceof Error ? routeOptionsQuery.error.message : 'unknown error'}`
        : routeStatus.detail;
      setSectorError(sectorId, blockedMessage);
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }
    const userMessage = createMessage('user', trimmed);
    const streamingId = `assistant-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const streamingCreatedAt = Date.now();
    upsertSectorMessage(sectorId, userMessage);
    setSectorStreaming(sectorId, true);
    setSectorError(sectorId, null);
    setSectorDraftProposal(sectorId, null);
    setSectorDraftText(sectorId, '');
    setStreamingAssistant({
      id: streamingId,
      role: 'assistant',
      content: '',
      createdAt: streamingCreatedAt,
      status: 'streaming',
    });
    const nextConversation = [...conversation, userMessage];
    let assistantText = '';
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    try {
      const result = await streamSectorAnalyst({
        binding: routeStatus.binding,
        signal: abortController.signal,
        subjectUserId: auth.user?.id || undefined,
        systemPrompt: buildAnalystSystemPrompt({
          sectorLabel,
          sectorSlug: sectorId,
          window: activeWindow,
          package: analysisPackage,
          taxonomy: overlay,
        }),
        prompt: nextConversation.map((message) => `${message.role === 'assistant' ? 'Analyst' : 'User'}: ${message.content}`).join('\n\n'),
        onTextDelta: (delta) => {
          assistantText += delta;
          setStreamingAssistant({
            id: streamingId,
            role: 'assistant',
            content: assistantText,
            createdAt: streamingCreatedAt,
            status: 'streaming',
          });
        },
      });
      assistantText = result.text || assistantText;
      const extracted = extractDraftProposal(assistantText);
      const completedAssistantMessage: AnalystMessage = {
        id: streamingId,
        role: 'assistant',
        content: extracted.content,
        createdAt: streamingCreatedAt,
        status: 'complete',
      };
      upsertSectorMessage(sectorId, completedAssistantMessage);
      setStreamingAssistant(null);
      if (extracted.proposal) {
        setSectorDraftProposal(sectorId, extracted.proposal);
      }
      if (analysisPackage) {
        const snapshot = buildSnapshotFromAssistantMessage({
          sectorSlug: sectorId,
          sectorLabel,
          window: activeWindow,
          message: completedAssistantMessage,
        });
        if (snapshot) {
          recordAnalysisSnapshot(sectorId, snapshot);
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        const stoppedAssistantMessage: AnalystMessage = {
          id: streamingId,
          role: 'assistant',
          content: assistantText || '已停止本次生成。',
          createdAt: streamingCreatedAt,
          status: 'complete',
        };
        upsertSectorMessage(sectorId, stoppedAssistantMessage);
        setStreamingAssistant(null);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failedAssistantMessage: AnalystMessage = {
        id: streamingId,
        role: 'assistant',
        content: assistantText || '分析失败，当前没有拿到可用结果。',
        createdAt: streamingCreatedAt,
        status: 'error',
        error: message,
      };
      upsertSectorMessage(sectorId, failedAssistantMessage);
      setStreamingAssistant(null);
      setSectorError(sectorId, message);
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setSectorStreaming(sectorId, false);
    }
  }, [
    activeWindow,
    analysisPackageRef,
    auth.user?.id,
    conversation,
    overlay,
    recordAnalysisSnapshot,
    routeOptionsQuery.data,
    routeOptionsQuery.error,
    routeOptionsQuery.isError,
    routeStatus.binding,
    routeStatus.detail,
    routeStatus.ready,
    sectorId,
    sectorLabel,
    setSectorDraftProposal,
    setSectorDraftText,
    setSectorError,
    setSectorStreaming,
    upsertSectorMessage,
  ]);
  return (
    <aside className="polyinfo-surface flex min-h-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b polyinfo-hairline px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_18px_rgba(45,212,191,0.45)]" />
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">Sector Analyst</p>
        </div>
        <span className="rounded-lg bg-white/[0.045] px-3 py-1 text-[11px] text-slate-400">
          {sectorLabel}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-md bg-white/[0.045] px-2.5 py-1.5 text-slate-300">
              {bindingSummary.title}
            </span>
            <span className="rounded-md bg-white/[0.045] px-2.5 py-1.5 text-slate-300">
              {marketDataRequested ? 'REST prices' : 'prices not loaded'}
            </span>
            <button
              type="button"
              onClick={() => {
                streamAbortRef.current?.abort();
                streamAbortRef.current = null;
                setStreamingAssistant(null);
                resetSectorConversation(sectorId);
              }}
              className="rounded-md bg-white/[0.045] px-2.5 py-1.5 text-slate-300 hover:bg-white/[0.08]"
            >
              Reset
            </button>
          </div>
          <p className="border-l border-teal-300/35 pl-3 text-[12px] leading-5 text-slate-400">
            根据当前盘口变化，判断 core issue 和 narrative 是否需要调整。
          </p>
          {routeNotice ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              {routeNotice}
              <div className="mt-3">
                <Link to="/runtime" className="rounded-lg bg-white/[0.08] px-3 py-2 text-xs text-slate-100">
                  打开 Runtime 页面
                </Link>
              </div>
            </div>
          ) : null}
          <ProposalCard sectorSlug={sectorId} />
          {chatError ? (
            <div className="rounded-xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-rose-100">
              {chatError}
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 border-t polyinfo-hairline px-4 py-4">
          {visibleConversation.length === 0 ? (
            <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto text-sm text-slate-500">
              {emptyConversationMessage}
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              {visibleConversation.map((message) => (
                <div
                  key={message.id}
                  className={`border-l py-1 pl-4 pr-1 text-[13px] leading-6 ${
                    message.role === 'assistant'
                      ? 'border-white/15 text-slate-100'
                      : 'border-teal-300/55 bg-teal-300/[0.035] text-teal-50'
                  }`}
                >
                  <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    {message.role === 'assistant' ? 'Analyst' : 'You'}
                  </p>
                  <p className="whitespace-pre-wrap break-words">
                    {message.content || (message.status === 'streaming' ? '…' : '')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t polyinfo-hairline p-4">
          <textarea
            value={draftText}
            onChange={(event) => setSectorDraftText(sectorId, event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-3 text-[13px] text-white outline-none placeholder:text-slate-500 focus:border-teal-300/50"
            placeholder="Query logic / propose changes..."
          />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={isStreaming || !draftText.trim() || !routeStatus.ready}
              onClick={() => {
                void sendPrompt(draftText);
              }}
              className="flex-1 rounded-lg bg-teal-300 px-4 py-3 text-sm font-medium text-slate-950 hover:bg-teal-200 disabled:opacity-50"
            >
              {isStreaming ? '分析中…' : 'Send'}
            </button>
            <button
              type="button"
              disabled={!isStreaming}
              onClick={() => {
                streamAbortRef.current?.abort();
              }}
              className="rounded-lg bg-white/[0.08] px-4 py-3 text-sm text-slate-200 disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
});
