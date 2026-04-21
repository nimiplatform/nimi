import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { streamPlatformChatResponse } from '@nimiplatform/nimi-kit/features/chat/runtime';
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
  buildAnalystSystemPrompt,
  buildSnapshotFromAssistantMessage,
  extractDraftProposal,
} from './sector-analyst.js';

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatCompactMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
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
  const { sectorSlug = '' } = useParams<{ sectorSlug: string }>();
  const [input, setInput] = useState('');
  const [liveByTokenId, setLiveByTokenId] = useState<Record<string, { bestBid?: number; bestAsk?: number; lastTradePrice?: number }>>({});
  const [connectionStatus, setConnectionStatus] = useState<MarketConnectionState>('connecting');
  const autoAnalyzeRef = useRef<string>('');

  const activeWindow = useAppStore((state) => state.activeWindow);
  const setActiveWindow = useAppStore((state) => state.setActiveWindow);
  const ensureSectorTaxonomy = useAppStore((state) => state.ensureSectorTaxonomy);
  const taxonomy = useAppStore((state) => state.taxonomyBySector[sectorSlug]);
  const chatState = useAppStore((state) => state.chatsBySector[sectorSlug]);
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
    () => (tagsQuery.data ?? []).find((tag) => tag.slug === sectorSlug),
    [sectorSlug, tagsQuery.data],
  );

  useEffect(() => {
    if (sectorSlug) {
      ensureSectorTaxonomy(sectorSlug);
    }
  }, [ensureSectorTaxonomy, sectorSlug]);

  const marketsQuery = useQuery({
    queryKey: ['polyinfo', 'markets', activeTag?.id],
    queryFn: () => fetchSectorMarkets(activeTag!),
    enabled: Boolean(activeTag),
    refetchInterval: 2 * 60 * 1000,
    staleTime: 30 * 1000,
  });

  const historiesQuery = useQuery({
    queryKey: ['polyinfo', 'histories', activeTag?.id, activeWindow, (marketsQuery.data ?? []).map((market) => market.id).join(',')],
    queryFn: () => fetchSectorHistory(marketsQuery.data ?? [], activeWindow),
    enabled: Boolean(activeTag) && (marketsQuery.data?.length ?? 0) > 0,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
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
  }, [marketsQuery.data]);

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

  const leadMoves = useMemo(
    () => [...(analysisPackage?.markets ?? [])]
      .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
      .slice(0, 6),
    [analysisPackage],
  );

  const sendPrompt = useCallback(async (prompt: string) => {
    if (!analysisPackage || !activeTag) {
      return;
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    const userMessage = createMessage('user', trimmed);
    const assistantMessage = createMessage('assistant', '', `assistant-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
    upsertSectorMessage(sectorSlug, userMessage);
    upsertSectorMessage(sectorSlug, assistantMessage);
    setSectorStreaming(sectorSlug, true);
    setSectorError(sectorSlug, null);
    setSectorDraftProposal(sectorSlug, null);

    const nextConversation = [...conversation, userMessage];
    let assistantText = '';

    try {
      const result = await streamPlatformChatResponse({
        model: 'auto',
        route: 'cloud',
        system: buildAnalystSystemPrompt({
          sectorLabel: activeTag.label,
          sectorSlug: activeTag.slug,
          window: activeWindow,
          package: analysisPackage,
        }),
        input: nextConversation.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        metadata: {
          surfaceId: 'polyinfo',
          callerId: 'polyinfo.sector-analyst',
          extra: JSON.stringify({
            sectorSlug: activeTag.slug,
            window: activeWindow,
            marketCount: analysisPackage.markets.length,
          }),
        },
      }, {
        onDelta: (text) => {
          assistantText += text;
          upsertSectorMessage(sectorSlug, {
            ...assistantMessage,
            content: assistantText,
            status: 'streaming',
          });
        },
      });

      const extracted = extractDraftProposal(result.text || assistantText);
      const completedAssistantMessage: AnalystMessage = {
        ...assistantMessage,
        content: extracted.content,
        status: 'complete',
      };
      upsertSectorMessage(sectorSlug, completedAssistantMessage);
      if (extracted.proposal) {
        setSectorDraftProposal(sectorSlug, extracted.proposal);
      }
      const snapshot = buildSnapshotFromAssistantMessage({
        sectorSlug: activeTag.slug,
        sectorLabel: activeTag.label,
        window: activeWindow,
        message: completedAssistantMessage,
      });
      if (snapshot) {
        recordAnalysisSnapshot(sectorSlug, snapshot);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      upsertSectorMessage(sectorSlug, {
        ...assistantMessage,
        content: assistantText || '分析失败，当前没有拿到可用结果。',
        status: 'error',
        error: message,
      });
      setSectorError(sectorSlug, message);
    } finally {
      setSectorStreaming(sectorSlug, false);
    }
  }, [
    activeTag,
    activeWindow,
    analysisPackage,
    conversation,
    recordAnalysisSnapshot,
    sectorSlug,
    setSectorDraftProposal,
    setSectorError,
    setSectorStreaming,
    upsertSectorMessage,
  ]);

  useEffect(() => {
    if (!analysisPackage || !activeTag || isStreaming || conversation.length > 0) {
      return;
    }
    const autoKey = `${activeTag.slug}:${activeWindow}`;
    if (autoAnalyzeRef.current === autoKey) {
      return;
    }
    autoAnalyzeRef.current = autoKey;
    void sendPrompt(`请基于当前 ${activeWindow} 窗口，先给出这个 sector 的最新判断。`);
  }, [activeTag, activeWindow, analysisPackage, conversation.length, isStreaming, sendPrompt]);

  if (tagsQuery.isLoading) {
    return (
      <div className="rounded-md border border-white/10 bg-slate-950/55 p-6 text-sm text-slate-300">
        正在读取 Polymarket 板块列表…
      </div>
    );
  }

  if (!sectorSlug) {
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
  const loadingBoard = !hasBoardError && (marketsQuery.isLoading || historiesQuery.isLoading || !analysisPackage);
  const topVolume = analysisPackage?.markets.reduce((sum, market) => sum + market.volumeNum, 0) ?? 0;
  const top24hVolume = analysisPackage?.markets.reduce((sum, market) => sum + market.volume24hr, 0) ?? 0;

  return (
    <div className="grid min-h-[760px] grid-cols-[320px_minmax(0,1fr)_380px] gap-4">
      <section className="rounded-md border border-white/10 bg-slate-950/55 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-sky-300/80">Sector</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{activeTag.label}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              当前板块直接继承 Polymarket 前台分类。下面这些 narrative 和 core variable 是你自己的分析结构。
            </p>
          </div>
          <ConnectionBadge status={connectionStatus} />
        </div>

        <div className="mt-6 grid gap-3">
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tracked markets</p>
            <p className="mt-2 text-lg font-semibold text-white">{analysisPackage?.markets.length ?? 0}</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Total volume</p>
            <p className="mt-2 text-lg font-semibold text-white">${formatCompactMoney(topVolume)}</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">24h volume</p>
            <p className="mt-2 text-lg font-semibold text-white">${formatCompactMoney(top24hVolume)}</p>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Narratives</p>
          <div className="mt-3 space-y-3">
            {overlay.narratives.length === 0 ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-3 text-sm text-slate-400">
                还没有 narrative。可以直接在右侧聊天里让分析师提出一个。
              </div>
            ) : overlay.narratives.map((narrative) => {
              const marketCount = analysisPackage?.markets.filter((market) => market.narrativeId === narrative.id).length ?? 0;
              return (
                <div key={narrative.id} className="rounded-md border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-white">{narrative.title}</h3>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                      {marketCount} mkts
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{narrative.definition}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Core Variables</p>
          <div className="mt-3 space-y-3">
            {overlay.coreVariables.length === 0 ? (
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-3 text-sm text-slate-400">
                还没有 core variable。可以在右侧聊天里让分析师先提一个版本。
              </div>
            ) : overlay.coreVariables.map((item) => {
              const marketCount = analysisPackage?.markets.filter((market) => market.coreVariableIds.includes(item.id)).length ?? 0;
              return (
                <div key={item.id} className="rounded-md border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-white">{item.title}</h3>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
                      {marketCount} mkts
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{item.definition}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-slate-950/55 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Market Board</p>
            <h2 className="mt-1 text-lg font-semibold text-white">当前盘口变化</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              系统只负责整理盘口、窗口和权重。真正的结论在右侧由分析师基于这些事实给出。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['24h', '48h', '7d'] as const).map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => setActiveWindow(window)}
                className={`rounded-md px-3 py-2 text-xs transition-colors ${
                  window === activeWindow ? 'bg-sky-400 text-slate-950' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        </div>

        {loadingBoard ? (
          <div className="mt-6 rounded-md border border-white/8 bg-white/[0.03] p-6 text-sm text-slate-400">
            正在准备这个板块的历史窗口和实时盘口…
          </div>
        ) : hasBoardError ? (
          <div className="mt-6 rounded-md border border-rose-400/20 bg-rose-400/10 p-6 text-sm text-rose-100">
            {marketsQuery.isError
              ? `盘口读取失败：${marketsQuery.error instanceof Error ? marketsQuery.error.message : 'unknown error'}`
              : `历史窗口读取失败：${historiesQuery.error instanceof Error ? historiesQuery.error.message : 'unknown error'}`}
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Lead movers</p>
                <p className="mt-2 text-sm text-white">{leadMoves.length}</p>
              </div>
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Narratives touched</p>
                <p className="mt-2 text-sm text-white">
                  {new Set((analysisPackage?.markets ?? []).map((market) => market.narrativeId).filter(Boolean)).size}
                </p>
              </div>
              <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Core variables touched</p>
                <p className="mt-2 text-sm text-white">
                  {new Set((analysisPackage?.markets ?? []).flatMap((market) => market.coreVariableIds)).size}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Tracked Markets</p>
                <p className="text-xs text-slate-500">
                  共 {analysisPackage?.markets.length ?? 0} 个盘口，以下按成交量排序
                </p>
              </div>
              <div className="mt-3 max-h-[860px] space-y-3 overflow-y-auto pr-1">
                {(analysisPackage?.markets ?? []).map((market) => (
                  <div key={market.id} className="rounded-md border border-white/8 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium text-white">{market.question}</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {market.eventTitle} | {market.narrativeTitle ?? '未归类'} | vol ${formatCompactMoney(market.volumeNum)}
                        </p>
                        {market.coreVariableTitles.length > 0 ? (
                          <p className="mt-2 text-xs leading-5 text-slate-400">
                            {market.coreVariableTitles.join(' / ')}
                          </p>
                        ) : null}
                      </div>
                      <WeightBadge tier={market.weightTier} />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-md bg-slate-950/70 p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Start</p>
                        <p className="mt-2 text-sm text-white">{formatProbability(market.windowStartProbability)}</p>
                      </div>
                      <div className="rounded-md bg-slate-950/70 p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Current</p>
                        <p className="mt-2 text-sm text-white">{formatProbability(market.currentProbability)}</p>
                      </div>
                      <div className="rounded-md bg-slate-950/70 p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Delta</p>
                        <p className={`mt-2 text-sm ${market.delta >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                          {formatDelta(market.delta)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="flex min-h-0 flex-col rounded-md border border-white/10 bg-slate-950/55 p-4">
        <div className="border-b border-white/8 pb-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sector Analyst</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{activeTag.label} Analyst</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            这里的分析师已经自动读取当前 sector 的结构、窗口和盘口变化。你可以直接问，也可以要求它提出结构修改。
          </p>
        </div>

        <ProposalCard sectorSlug={sectorSlug} />

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
                onClick={() => setInput(prompt)}
                className="rounded-md bg-white/[0.04] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.08]"
              >
                {prompt}
              </button>
            ))}
          </div>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={5}
            className="w-full rounded-md border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-sky-300/50"
            placeholder="直接问这个板块的分析师，或者要求新增 / 修改 / 停用结构。"
          />
          <button
            type="button"
            disabled={isStreaming || !analysisPackage || !input.trim()}
            onClick={() => {
              const prompt = input;
              setInput('');
              void sendPrompt(prompt);
            }}
            className="mt-3 w-full rounded-md bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {isStreaming ? '分析中…' : 'Send'}
          </button>
        </div>
      </section>
    </div>
  );
}
