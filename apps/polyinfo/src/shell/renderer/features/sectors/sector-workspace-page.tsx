import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  buildAnalysisPackage,
  createMarketWebSocket,
  fetchSectorHistory,
  fetchSectorMarkets,
  fetchSectorTags,
  type MarketConnectionState,
} from '@renderer/data/polymarket.js';
import type { AnalysisPackage, AnalystMessage, PreparedMarket } from '@renderer/data/types.js';
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
import { streamSectorAnalyst } from './sector-analyst-runtime.js';

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function getDeltaTone(value: number): string {
  if (value > 0) return 'text-emerald-300';
  if (value < 0) return 'text-rose-300';
  return 'text-slate-400';
}

function formatCompactMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

function isStaleRuntimeBridgeError(message: string | null | undefined): boolean {
  const normalized = String(message || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes('tauri-ipc transport is unavailable')
    || normalized.includes('missing window.__tauri__.event.listen')
    || normalized.includes('command open_external_url not found');
}

function createMessage(role: AnalystMessage['role'], content: string, id?: string): AnalystMessage {
  return {
    id: id ?? `${role}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
    status: role === 'assistant' ? 'streaming' : 'complete',
  };
}

function WeightBadge({ tier }: { tier: AnalysisPackage['markets'][number]['weightTier'] }) {
  const label = tier === 'lead' ? '主导' : tier === 'support' ? '辅助' : '观察';
  const tone = tier === 'lead'
    ? 'bg-emerald-400/16 text-emerald-200'
    : tier === 'support'
      ? 'bg-amber-400/16 text-amber-200'
      : 'bg-slate-400/12 text-slate-300';
  return <span className={`rounded-md px-2 py-1 text-[11px] ${tone}`}>{label}</span>;
}

function ConnectionBadge({ status }: { status: MarketConnectionState }) {
  const label = status === 'live'
    ? 'Live'
    : status === 'connecting'
      ? 'Connecting'
      : status === 'reconnecting'
        ? 'Reconnecting'
        : status === 'error'
          ? 'Error'
          : 'Closed';
  const tone = status === 'live'
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
    : status === 'error'
      ? 'border-rose-400/20 bg-rose-400/10 text-rose-200'
      : 'border-white/10 bg-white/[0.03] text-slate-300';
  return (
    <span className={`rounded-md border px-3 py-2 text-xs ${tone}`}>
      {label}
    </span>
  );
}

function ProposalCard({
  sectorSlug,
}: {
  sectorSlug: string;
}) {
  const draftProposal = useAppStore((state) => state.chatsBySector[sectorSlug]?.draftProposal ?? null);
  const confirmDraft = useAppStore((state) => state.confirmSectorDraftProposal);
  const dismissDraft = useAppStore((state) => state.dismissSectorDraftProposal);

  if (!draftProposal) {
    return null;
  }

  return (
    <div className="mt-4 rounded-md border border-sky-300/25 bg-sky-300/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-sky-200">Pending Change</p>
          <h3 className="mt-1 text-sm font-medium text-white">{draftProposal.title}</h3>
        </div>
        <span className="rounded-md bg-white/8 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-200">
          {draftProposal.action}
        </span>
      </div>
      {draftProposal.definition ? (
        <p className="mt-2 text-sm leading-6 text-slate-200">{draftProposal.definition}</p>
      ) : null}
      {draftProposal.note ? (
        <p className="mt-2 text-xs leading-5 text-slate-300">{draftProposal.note}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => confirmDraft(sectorSlug)}
          className="rounded-md bg-sky-300 px-3 py-2 text-xs font-medium text-slate-950"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => dismissDraft(sectorSlug)}
          className="rounded-md bg-white/8 px-3 py-2 text-xs text-slate-300 hover:bg-white/12"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function SectorWorkspacePage() {
  const { rootSlug = '', sectorSlug } = useParams<{ rootSlug: string; sectorSlug?: string }>();
  const activeSectorSlug = sectorSlug ?? rootSlug;
  const [liveByTokenId, setLiveByTokenId] = useState<Record<string, { bestBid?: number; bestAsk?: number; lastTradePrice?: number }>>({});
  const [connectionStatus, setConnectionStatus] = useState<MarketConnectionState>('connecting');
  const [marketDataRequestedBySector, setMarketDataRequestedBySector] = useState<Record<string, boolean>>({});
  const autoAnalyzeRef = useRef<string>('');
  const streamAbortRef = useRef<AbortController | null>(null);

  const activeWindow = useAppStore((state) => state.activeWindow);
  const auth = useAppStore((state) => state.auth);
  const aiConfig = useAppStore((state) => state.aiConfig);
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const setActiveWindow = useAppStore((state) => state.setActiveWindow);
  const ensureSectorTaxonomy = useAppStore((state) => state.ensureSectorTaxonomy);
  const ensureSectorThread = useAppStore((state) => state.ensureSectorThread);
  const taxonomy = useAppStore((state) => state.taxonomyBySector[activeSectorSlug]);
  const chatState = useAppStore((state) => state.chatsBySector[activeSectorSlug]);
  const setSectorDraftText = useAppStore((state) => state.setSectorDraftText);
  const upsertSectorMessage = useAppStore((state) => state.upsertSectorMessage);
  const setSectorStreaming = useAppStore((state) => state.setSectorStreaming);
  const setSectorError = useAppStore((state) => state.setSectorError);
  const setSectorDraftProposal = useAppStore((state) => state.setSectorDraftProposal);
  const recordAnalysisSnapshot = useAppStore((state) => state.recordAnalysisSnapshot);

  const tagsQuery = useQuery({
    queryKey: ['polyinfo', 'sectors'],
    queryFn: () => fetchSectorTags(),
    staleTime: 10 * 60 * 1000,
  });

  const activeTag = useMemo(
    () => (tagsQuery.data ?? []).find((tag) => tag.slug === activeSectorSlug),
    [activeSectorSlug, tagsQuery.data],
  );

  useEffect(() => {
    if (activeSectorSlug) {
      ensureSectorTaxonomy(activeSectorSlug);
    }
  }, [activeSectorSlug, ensureSectorTaxonomy]);

  const marketsQuery = useQuery({
    queryKey: ['polyinfo', 'markets', activeTag?.id],
    queryFn: () => fetchSectorMarkets(activeTag!),
    enabled: Boolean(activeTag),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 30 * 1000,
  });

  const marketDataRequested = marketDataRequestedBySector[activeSectorSlug] ?? false;

  const historiesQuery = useQuery({
    queryKey: ['polyinfo', 'histories', activeTag?.id, (marketsQuery.data ?? []).map((market) => market.id).join(',')],
    queryFn: () => fetchSectorHistory(marketsQuery.data ?? []),
    enabled: Boolean(activeTag) && (marketsQuery.data?.length ?? 0) > 0 && marketDataRequested,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (!marketDataRequested) {
      setConnectionStatus('closed');
      setLiveByTokenId({});
      return;
    }
    const markets = marketsQuery.data ?? [];
    if (markets.length === 0) {
      setConnectionStatus('closed');
      return;
    }
    const cleanup = createMarketWebSocket(
      markets.map((market) => market.yesTokenId),
      (next) => setLiveByTokenId(next),
      setConnectionStatus,
    );
    return cleanup;
  }, [marketDataRequested, marketsQuery.data]);

  const overlay = taxonomy ?? {
    narratives: [],
    coreVariables: [],
    marketMappingOverrides: {},
  };

  const analysisPackage = useMemo(() => {
    if (!activeTag || !marketsQuery.data || !historiesQuery.data) {
      return null;
    }
    return buildAnalysisPackage({
      tag: activeTag,
      window: activeWindow,
      overlay,
      markets: marketsQuery.data,
      histories: historiesQuery.data,
      liveByTokenId,
    });
  }, [activeTag, activeWindow, historiesQuery.data, liveByTokenId, marketsQuery.data, overlay]);

  const conversation = chatState?.messages ?? [];
  const isStreaming = chatState?.isStreaming ?? false;
  const chatError = chatState?.error ?? null;
  const draftText = chatState?.draftText ?? '';
  const marketInventory = marketsQuery.data ?? [];

  const routeOptionsQuery = useQuery({
    queryKey: ['polyinfo', 'sector-route-options', activeSectorSlug, JSON.stringify(aiConfig.capabilities.selectedBindings['text.generate'] || null)],
    queryFn: () => loadTextGenerateRouteOptions({ aiConfig, runtimeDefaults }),
    staleTime: 15_000,
    retry: false,
  });

  const routeStatus = resolveTextGenerateRouteStatus({
    aiConfig,
    runtimeDefaults,
    routeOptions: routeOptionsQuery.data,
    authStatus: auth.status,
  });
  const effectiveBinding = routeStatus.binding;
  const bindingSummary = routeStatus.ready
    ? summarizeRuntimeBinding(effectiveBinding)
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
    ensureSectorThread(activeSectorSlug, activeTag?.label ? `${activeTag.label} Analyst` : undefined);
  }, [activeSectorSlug, activeTag?.label, ensureSectorThread]);

  useEffect(() => {
    if (!routeStatus.ready || !isStaleRuntimeBridgeError(chatError)) {
      return;
    }
    setSectorError(activeSectorSlug, null);
  }, [activeSectorSlug, chatError, routeStatus.ready, setSectorError]);

  const handleLoadMarketData = useCallback(() => {
    setMarketDataRequestedBySector((current) => ({
      ...current,
      [activeSectorSlug]: true,
    }));
    void marketsQuery.refetch();
    void historiesQuery.refetch();
  }, [activeSectorSlug, historiesQuery, marketsQuery]);

  const sendPrompt = useCallback(async (prompt: string) => {
    if (!analysisPackage || !activeTag || !routeOptionsQuery.data || !routeStatus.ready || !routeStatus.binding) {
      const blockedMessage = routeOptionsQuery.isError
        ? `运行配置读取失败：${routeOptionsQuery.error instanceof Error ? routeOptionsQuery.error.message : 'unknown error'}`
        : routeStatus.detail;
      setSectorError(activeSectorSlug, blockedMessage);
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    const userMessage = createMessage('user', trimmed);
    const assistantMessage = createMessage('assistant', '', `assistant-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
    upsertSectorMessage(activeSectorSlug, userMessage);
    upsertSectorMessage(activeSectorSlug, assistantMessage);
    setSectorStreaming(activeSectorSlug, true);
    setSectorError(activeSectorSlug, null);
    setSectorDraftProposal(activeSectorSlug, null);
    setSectorDraftText(activeSectorSlug, '');

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
          sectorLabel: activeTag.label,
          sectorSlug: activeTag.slug,
          window: activeWindow,
          package: analysisPackage,
        }),
        prompt: nextConversation.map((message) => `${message.role === 'assistant' ? 'Analyst' : 'User'}: ${message.content}`).join('\n\n'),
        onTextDelta: (delta) => {
          assistantText += delta;
          upsertSectorMessage(activeSectorSlug, {
            ...assistantMessage,
            content: assistantText,
            status: 'streaming',
          });
        },
      });
      assistantText = result.text || assistantText;

      const extracted = extractDraftProposal(assistantText);
      const completedAssistantMessage: AnalystMessage = {
        ...assistantMessage,
        content: extracted.content,
        status: 'complete',
      };
      upsertSectorMessage(activeSectorSlug, completedAssistantMessage);
      if (extracted.proposal) {
        setSectorDraftProposal(activeSectorSlug, extracted.proposal);
      }
      const snapshot = buildSnapshotFromAssistantMessage({
        sectorSlug: activeTag.slug,
        sectorLabel: activeTag.label,
        window: activeWindow,
        message: completedAssistantMessage,
      });
      if (snapshot) {
        recordAnalysisSnapshot(activeSectorSlug, snapshot);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        upsertSectorMessage(activeSectorSlug, {
          ...assistantMessage,
          content: assistantText || '已停止本次生成。',
          status: 'complete',
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      upsertSectorMessage(activeSectorSlug, {
        ...assistantMessage,
        content: assistantText || '分析失败，当前没有拿到可用结果。',
        status: 'error',
        error: message,
      });
      setSectorError(activeSectorSlug, message);
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setSectorStreaming(activeSectorSlug, false);
    }
  }, [
    activeSectorSlug,
    activeTag,
    activeWindow,
    analysisPackage,
    auth.status,
    auth.user?.id,
    conversation,
    recordAnalysisSnapshot,
    routeOptionsQuery.data,
    routeOptionsQuery.error,
    routeOptionsQuery.isError,
    routeStatus.binding,
    routeStatus.detail,
    routeStatus.ready,
    setSectorDraftProposal,
    setSectorDraftText,
    setSectorError,
    setSectorStreaming,
    upsertSectorMessage,
  ]);

  useEffect(() => {
    if (!marketDataRequested || !analysisPackage || !activeTag || isStreaming || conversation.length > 0 || !routeStatus.ready) {
      return;
    }
    const autoKey = `${activeTag.slug}:${activeWindow}`;
    if (autoAnalyzeRef.current === autoKey) {
      return;
    }
    autoAnalyzeRef.current = autoKey;
    void sendPrompt(`请基于当前 ${activeWindow} 窗口，先给出这个 sector 的最新判断。`);
  }, [activeTag, activeWindow, analysisPackage, conversation.length, isStreaming, marketDataRequested, routeStatus.ready, sendPrompt]);

  if (tagsQuery.isLoading) {
    return (
      <div className="rounded-md border border-white/10 bg-slate-950/55 p-6 text-sm text-slate-300">
        正在读取 Polymarket 板块列表…
      </div>
    );
  }

  if (!rootSlug) {
    return <Navigate to="/" replace />;
  }

  if (!activeTag) {
    return (
      <div className="rounded-md border border-white/10 bg-slate-950/55 p-6 text-sm text-slate-300">
        找不到这个 sector。
      </div>
    );
  }

  const hasBoardError = marketsQuery.isError || historiesQuery.isError;
  const loadingBoard = marketsQuery.isLoading;
  const loadingMarketData = marketDataRequested && historiesQuery.isLoading;
  const topVolume = marketInventory.reduce((sum, market) => sum + market.volumeNum, 0);
  const top24hVolume = marketInventory.reduce((sum, market) => sum + market.volume24hr, 0);
  const latestAnalystText = [...conversation].reverse().find((message) => message.role === 'assistant')?.content ?? '';

  return (
    <div className="min-h-[760px] space-y-6">
      <section className="rounded-md border border-white/10 bg-slate-950/55 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Sector Analysis</p>
            <div className="mt-2 flex items-center gap-3">
              <h2 className="text-2xl font-semibold text-white">{activeTag.label}</h2>
              <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                Active
              </span>
              <ConnectionBadge status={connectionStatus} />
            </div>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-400">
              当前板块直接继承 Polymarket 前台分类。你定义的 narrative 和 core variable 会和盘口变化一起组成这个 sector 的分析框架。
            </p>
          </div>
          <div className="grid min-w-[220px] grid-cols-3 gap-3 text-right">
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Markets</p>
              <p className="mt-2 text-sm font-semibold text-white">{marketInventory.length}</p>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Volume</p>
              <p className="mt-2 text-sm font-semibold text-white">${formatCompactMoney(topVolume)}</p>
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">24h</p>
              <p className="mt-2 text-sm font-semibold text-white">${formatCompactMoney(top24hVolume)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 italic">Core Variables</h3>
            <span className="text-[10px] font-mono text-slate-500">Critical Logic Nodes</span>
          </div>
          <div className="space-y-4">
            {overlay.coreVariables.length === 0 ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-400">
                还没有 core variable。可以直接在下方对话里让分析师先提一个版本。
              </div>
            ) : overlay.coreVariables.map((item) => {
              const marketCount = analysisPackage?.markets.filter((market) => market.coreVariableIds.includes(item.id)).length ?? 0;
              return (
                <div key={item.id} className="rounded-md border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Active Node</p>
                      <h4 className="mt-2 text-sm font-medium text-slate-100">{item.title}</h4>
                      <p className="mt-2 text-[11px] leading-6 text-slate-400 italic">{item.definition}</p>
                    </div>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{marketCount} mkts</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 italic">Active Narratives</h3>
            <span className="text-[10px] font-mono italic text-indigo-300/80">Market Context</span>
          </div>
          <div className="space-y-4">
            {overlay.narratives.length === 0 ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-400">
                还没有 narrative。可以在下方对话里让分析师提出一个。
              </div>
            ) : overlay.narratives.map((narrative) => {
              const marketCount = analysisPackage?.markets.filter((market) => market.narrativeId === narrative.id).length ?? 0;
              return (
                <div key={narrative.id} className="rounded-md border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-medium text-indigo-100">{narrative.title}</h4>
                      <p className="mt-2 text-xs leading-6 text-slate-400">{narrative.definition}</p>
                    </div>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{marketCount} mkts</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-slate-950/55 p-5">
        <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 italic">Market Movements</h3>
            <span className="hidden text-[10px] font-mono text-slate-600 md:inline-block">/ Real-time Order Flow</span>
          </div>
          <div className="flex rounded-md border border-white/8 bg-slate-950/80 p-0.5">
            {(['24h', '48h', '7d'] as const).map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => setActiveWindow(window)}
                className={`rounded px-3 py-1 text-[10px] font-bold uppercase transition-colors ${
                  activeWindow === window
                    ? 'bg-sky-400 text-slate-950'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        </div>

        {loadingBoard ? (
          <div className="mt-5 rounded-md border border-white/8 bg-white/[0.03] p-6 text-sm text-slate-400">
            正在读取这个板块的事件清单…
          </div>
        ) : hasBoardError ? (
          <div className="mt-5 rounded-md border border-rose-400/20 bg-rose-400/10 p-6 text-sm text-rose-100">
            {marketsQuery.isError
              ? `盘口读取失败：${marketsQuery.error instanceof Error ? marketsQuery.error.message : 'unknown error'}`
              : `历史窗口读取失败：${historiesQuery.error instanceof Error ? historiesQuery.error.message : 'unknown error'}`}
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-md border border-white/8 bg-white/[0.02]">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="text-xs text-slate-400">
                {marketDataRequested
                  ? loadingMarketData
                    ? '正在一次性获取历史行情，完成后可直接切换 24h / 48h / 7d。'
                    : '历史行情已经拿到，切换窗口只会复用这一份数据。'
                  : '当前先只展示事件清单。点击右侧按钮后，再统一获取行情和历史窗口。'}
              </p>
              <button
                type="button"
                onClick={handleLoadMarketData}
                disabled={loadingMarketData || marketInventory.length === 0}
                className="rounded-md bg-sky-400 px-3 py-2 text-xs font-medium text-slate-950 disabled:opacity-50"
              >
                {loadingMarketData ? '获取中…' : marketDataRequested ? '刷新行情' : '获取行情'}
              </button>
            </div>
            <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_120px_minmax(0,1.2fr)] gap-4 border-b border-white/8 bg-white/[0.03] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              <span>事件</span>
              <span>概率变化 ({activeWindow})</span>
              <span>成交量</span>
              <span>映射逻辑</span>
            </div>
            <div className="divide-y divide-white/8">
              {marketInventory.map((market) => {
                const analyzedMarket = analysisPackage?.markets.find((item) => item.id === market.id);
                return (
                <div
                  key={market.id}
                  className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_120px_minmax(0,1.2fr)] gap-4 px-4 py-4 text-xs text-slate-300 hover:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-6 text-white">{market.question}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{market.eventTitle}</p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded-md border border-white/8 bg-slate-950/80 px-3 py-2">
                      <span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Start</span>
                      <span className="font-mono text-slate-100">
                        {analyzedMarket ? formatProbability(analyzedMarket.windowStartProbability) : '待加载'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-white/8 bg-slate-950/80 px-3 py-2">
                      <span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Current</span>
                      <span className="font-mono text-slate-100">
                        {analyzedMarket ? formatProbability(analyzedMarket.currentProbability) : '待加载'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-white/8 bg-slate-950/80 px-3 py-2">
                      <span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Delta</span>
                      <span className={`font-mono ${analyzedMarket ? getDeltaTone(analyzedMarket.delta) : 'text-slate-500'}`}>
                        {analyzedMarket ? formatDelta(analyzedMarket.delta) : '待加载'}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="font-mono text-slate-100">${formatCompactMoney(market.volumeNum)}</p>
                    <p className="text-[11px] text-slate-500">24h ${formatCompactMoney(market.volume24hr)}</p>
                    {analyzedMarket ? <WeightBadge tier={analyzedMarket.weightTier} /> : null}
                  </div>
                  <div className="min-w-0 space-y-2">
                    <p className="text-[11px] font-medium text-indigo-100">{analyzedMarket?.narrativeTitle ?? '待加载映射'}</p>
                    {analyzedMarket && analyzedMarket.coreVariableTitles.length > 0 ? (
                      <p className="text-[11px] leading-5 text-slate-400">{analyzedMarket.coreVariableTitles.join(' / ')}</p>
                    ) : (
                      <p className="text-[11px] leading-5 text-slate-500">
                        {analyzedMarket ? '还没有绑定 core variable' : '获取行情后再显示结构映射'}
                      </p>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-md border border-white/10 bg-slate-950/55 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500 italic">Analyst Summary</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                这里保留当前 sector 最近一次分析结论。分析师只使用盘口和你确认过的结构，不会引入新闻。
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-500">{activeWindow}</span>
          </div>
          <div className="mt-5 rounded-md border border-white/8 bg-white/[0.03] p-4">
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">
              {latestAnalystText || (marketDataRequested
                ? '还没有现成结论。发送下面的快捷问题后，这里会显示最新判断。'
                : '先点上面的“获取行情”，拿到当前板块的统一行情后，再开始分析。')}
            </p>
          </div>
        </div>

        <section className="flex min-h-0 flex-col rounded-md border border-white/10 bg-slate-950/55 p-5">
          <div className="border-b border-white/8 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sector Analyst</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{activeTag.label} Analyst</h2>
              </div>
              <div className="flex gap-2 text-[10px] uppercase tracking-[0.16em]">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-slate-300">
                  {bindingSummary.title}
                </span>
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              这里的分析师会自动读取当前 sector 的结构、窗口和盘口变化。模型和连接器只认 Runtime 页面里的统一设置，不再在这里单独维护一套。
            </p>
            {routeNotice ? (
              <p className="mt-2 text-xs leading-6 text-amber-200">{routeNotice}</p>
            ) : null}
            <Link to="/runtime" className="mt-3 inline-flex rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-200">
              打开 Runtime 页面
            </Link>
          </div>

          <ProposalCard sectorSlug={activeSectorSlug} />

          {chatError ? (
            <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">
              {chatError}
            </div>
          ) : null}

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {conversation.map((message) => (
              <div
                key={message.id}
                className={`rounded-md border px-3 py-3 text-sm leading-6 ${
                  message.role === 'assistant'
                    ? 'border-white/8 bg-white/[0.04] text-slate-100'
                    : 'border-sky-300/25 bg-sky-300/10 text-sky-50'
                }`}
              >
                <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                  {message.role === 'assistant' ? 'Analyst' : 'You'}
                </p>
                <p className="whitespace-pre-wrap">{message.content || (message.status === 'streaming' ? '…' : '')}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-white/8 pt-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {[
                `请按 ${activeWindow} 重新分析当前市场在押什么`,
                '我不同意你的判断，请只用盘口再论证一次',
                '新增一个 narrative，专门观察停火博弈',
                '新增一个 core variable，观察短期谈判是否被重新定价',
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setSectorDraftText(activeSectorSlug, prompt)}
                  className="rounded-md bg-white/[0.04] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.08]"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <textarea
              value={draftText}
              onChange={(event) => setSectorDraftText(activeSectorSlug, event.target.value)}
              rows={5}
              className="w-full rounded-md border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-sky-300/50"
              placeholder="直接问这个板块的分析师，或者要求新增 / 修改 / 停用结构。"
            />
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                disabled={isStreaming || !analysisPackage || !draftText.trim() || !routeStatus.ready}
                onClick={() => {
                  void sendPrompt(draftText);
                }}
                className="flex-1 rounded-md bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                {isStreaming ? '分析中…' : 'Send'}
              </button>
              <button
                type="button"
                disabled={!isStreaming}
                onClick={() => {
                  streamAbortRef.current?.abort();
                }}
                className="rounded-md bg-white/8 px-4 py-3 text-sm text-slate-200 disabled:opacity-50"
              >
                停止
              </button>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
