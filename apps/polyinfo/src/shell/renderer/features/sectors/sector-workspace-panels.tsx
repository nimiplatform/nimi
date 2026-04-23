import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  buildAnalysisPackage,
  createMarketWebSocket,
  fetchEventBySlug,
  fetchSectorHistory,
  fetchSectorMarkets,
  mergeSectorMarketBatches,
  parsePolymarketEventSlugFromUrl,
  type MarketConnectionState,
} from '@renderer/data/polymarket.js';
import type {
  AnalysisPackage,
  AnalysisPackageMarket,
  AnalystMessage,
  ImportedEventRecord,
  PreparedMarket,
  SectorMarketBatch,
  SectorTag,
  TaxonomyOverlay,
  WindowKey,
} from '@renderer/data/types.js';
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
import { buildEventOutcomeDisplay } from './sector-market-display.js';
import {
  buildEmptyConversationMessage,
  buildManualAnalysisGuardMessage,
} from './sector-workspace-state.js';
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

function ProposalCard({ sectorSlug }: { sectorSlug: string }) {
  const draftProposal = useAppStore((state) => state.chatsBySector[sectorSlug]?.draftProposal ?? null);
  const confirmDraft = useAppStore((state) => state.confirmSectorDraftProposal);
  const dismissDraft = useAppStore((state) => state.dismissSectorDraftProposal);

  if (!draftProposal) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-sky-300/25 bg-sky-300/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-sky-200">Pending Change</p>
          <h3 className="mt-1 text-[13px] font-medium text-white">{draftProposal.title}</h3>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-200">
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
          className="rounded-full bg-sky-300 px-3 py-2 text-xs font-medium text-slate-950"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => dismissDraft(sectorSlug)}
          className="rounded-full bg-white/8 px-3 py-2 text-xs text-slate-300 hover:bg-white/12"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function groupOfficialEvents(markets: PreparedMarket[]) {
  const groups = new Map<string, { id: string; title: string; markets: PreparedMarket[]; staleState: 'active'; staleReason?: string }>();
  for (const market of markets) {
    const key = market.eventId || market.eventTitle;
    const existing = groups.get(key);
    if (existing) {
      existing.markets.push(market);
      continue;
    }
    groups.set(key, {
      id: key,
      title: market.eventTitle,
      markets: [market],
      staleState: 'active',
    });
  }
  return [...groups.values()];
}

const INITIAL_VISIBLE_EVENT_COUNT = 18;
const VISIBLE_EVENT_INCREMENT = 18;
const INITIAL_SECTOR_EVENT_PAGE_COUNT = 2;

type MarketBoardPanelProps = {
  sectorId: string;
  activeOfficialSector: SectorTag | null;
  activeSectorMeta: { id: string; label: string; description: string } | null;
  activeImportedEvents: ImportedEventRecord[];
  activeImportedMarkets: PreparedMarket[];
  isCustomSector: boolean;
  marketDataRequested: boolean;
  activeWindow: WindowKey;
  overlay: TaxonomyOverlay;
  onRequestMarketData: () => void;
  onAnalysisReadyChange: (ready: boolean) => void;
  onConnectionStatusChange: (status: MarketConnectionState) => void;
  analysisPackageRef: { current: AnalysisPackage | null };
};

export const MarketBoardPanel = memo(function MarketBoardPanel({
  sectorId,
  activeOfficialSector,
  activeSectorMeta,
  activeImportedEvents,
  activeImportedMarkets,
  isCustomSector,
  marketDataRequested,
  activeWindow,
  overlay,
  onRequestMarketData,
  onAnalysisReadyChange,
  onConnectionStatusChange,
  analysisPackageRef,
}: MarketBoardPanelProps) {
  const upsertImportedEvent = useAppStore((state) => state.upsertImportedEvent);
  const removeImportedEvent = useAppStore((state) => state.removeImportedEvent);
  const setActiveWindow = useAppStore((state) => state.setActiveWindow);

  const [liveByTokenId, setLiveByTokenId] = useState<Record<string, { bestBid?: number; bestAsk?: number; lastTradePrice?: number }>>({});
  const [connectionStatus, setConnectionStatus] = useState<MarketConnectionState>('closed');
  const [visibleEventCount, setVisibleEventCount] = useState(INITIAL_VISIBLE_EVENT_COUNT);
  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [appendedOfficialBatches, setAppendedOfficialBatches] = useState<SectorMarketBatch[]>([]);
  const [isLoadingMoreEvents, setIsLoadingMoreEvents] = useState(false);
  const lastAnalysisReadyRef = useRef(false);

  useEffect(() => {
    setVisibleEventCount(INITIAL_VISIBLE_EVENT_COUNT);
    setImportUrl('');
    setImportError(null);
    setIsImporting(false);
    setLiveByTokenId({});
    setConnectionStatus('closed');
    setAppendedOfficialBatches([]);
    setIsLoadingMoreEvents(false);
  }, [sectorId]);

  const marketsQuery = useQuery({
    queryKey: ['polyinfo', 'official-sector-markets', sectorId, INITIAL_SECTOR_EVENT_PAGE_COUNT],
    queryFn: () => fetchSectorMarkets(activeOfficialSector!, { pageCount: INITIAL_SECTOR_EVENT_PAGE_COUNT }),
    enabled: Boolean(activeOfficialSector),
    staleTime: 30 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  const officialMarketBatch = useMemo(
    () => mergeSectorMarketBatches([marketsQuery.data ?? { markets: [], hasMore: false }, ...appendedOfficialBatches]),
    [appendedOfficialBatches, marketsQuery.data],
  );
  const marketInventory = activeOfficialSector ? officialMarketBatch.markets : activeImportedMarkets;
  const hasMoreOfficialEvents = Boolean(activeOfficialSector && officialMarketBatch.hasMore);
  const marketInventoryKey = useMemo(
    () => marketInventory.map((market) => market.id).join(','),
    [marketInventory],
  );

  const historiesQuery = useQuery({
    queryKey: ['polyinfo', 'histories', sectorId, marketInventoryKey],
    queryFn: () => fetchSectorHistory(marketInventory),
    enabled: marketInventory.length > 0 && marketDataRequested,
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
  const historyWindowReady = marketDataRequested && historiesQuery.isSuccess;

  useEffect(() => {
    if (!marketDataRequested) {
      setConnectionStatus('closed');
      setLiveByTokenId({});
      return;
    }
    if (marketInventory.length === 0) {
      setConnectionStatus('closed');
      return;
    }
    const cleanup = createMarketWebSocket(
      marketInventory.map((market) => market.yesTokenId),
      (next) => {
        startTransition(() => {
          setLiveByTokenId(next);
        });
      },
      setConnectionStatus,
    );
    return cleanup;
  }, [marketDataRequested, marketInventory]);

  useEffect(() => {
    onConnectionStatusChange(connectionStatus);
  }, [connectionStatus, onConnectionStatusChange]);

  const deferredLiveByTokenId = useDeferredValue(liveByTokenId);
  const analysisPackage = useMemo(() => {
    if (!activeSectorMeta || !historyWindowReady || marketInventory.length === 0) {
      return null;
    }
    return buildAnalysisPackage({
      tag: {
        id: activeSectorMeta.id,
        label: activeSectorMeta.label,
        slug: sectorId,
      },
      window: activeWindow,
      overlay,
      markets: marketInventory,
      histories: historiesQuery.data ?? {},
      liveByTokenId: deferredLiveByTokenId,
    });
  }, [
    activeSectorMeta,
    activeWindow,
    deferredLiveByTokenId,
    historyWindowReady,
    historiesQuery.data,
    marketInventory,
    overlay,
    sectorId,
  ]);

  useEffect(() => {
    analysisPackageRef.current = analysisPackage;
    const nextReady = Boolean(analysisPackage);
    if (lastAnalysisReadyRef.current !== nextReady) {
      lastAnalysisReadyRef.current = nextReady;
      onAnalysisReadyChange(nextReady);
    }
  }, [analysisPackage, analysisPackageRef, onAnalysisReadyChange]);

  const analysisMarketsById = useMemo(
    () => new Map((analysisPackage?.markets ?? []).map((market) => [market.id, market])),
    [analysisPackage],
  );
  const officialEventCards = useMemo(() => groupOfficialEvents(marketInventory), [marketInventory]);
  const eventCards = isCustomSector ? activeImportedEvents : officialEventCards;
  const visibleEventCards = isCustomSector ? eventCards : eventCards.slice(0, visibleEventCount);
  const loadingBoard = Boolean(activeOfficialSector) && marketsQuery.isLoading;
  const loadingMarketData = marketDataRequested && historiesQuery.isFetching;
  const hasBoardError = marketsQuery.isError || historiesQuery.isError;
  const boardModeMessage = marketDataRequested
    ? loadingMarketData
      ? '正在准备这一批事件的历史价格。完成后切换 24h / 48h / 7d 都只会复用这一次结果。'
      : historyWindowReady
        ? '历史价格已经就绪。现在切换 24h / 48h / 7d 只会在本地重算，不会重新请求。'
        : '历史价格还没准备完成。你可以稍等，或者手动再试一次。'
    : '当前先展示事件和实时快照。只有你点击 Load Prices 后，才会加载历史价格进入分析模式。';

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-white/8 bg-slate-950/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Market Movements</p>
          <p className="mt-1 text-[13px] text-slate-500">盘口变化 / Real-time Order Flow</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              onRequestMarketData();
              if (marketDataRequested && activeOfficialSector) {
                setAppendedOfficialBatches([]);
                setVisibleEventCount(INITIAL_VISIBLE_EVENT_COUNT);
                void marketsQuery.refetch();
              }
              if (marketDataRequested) {
                void historiesQuery.refetch();
              }
            }}
            disabled={loadingMarketData || marketInventory.length === 0}
            className="rounded-full bg-sky-300 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {loadingMarketData ? 'Loading…' : marketDataRequested ? 'Refresh Prices' : 'Load Prices'}
          </button>
          <div className="flex rounded-lg border border-white/8 bg-white/[0.03] p-1">
            {(['24h', '48h', '7d'] as const).map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => setActiveWindow(window)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  activeWindow === window ? 'bg-sky-300 text-slate-950' : 'text-slate-300'
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="border-b border-white/8 px-5 py-3 text-sm text-slate-400">
        {boardModeMessage}
      </div>

      {loadingBoard ? (
        <div className="px-5 py-6 text-sm text-slate-400">正在读取这个 sector 的 event 列表…</div>
      ) : hasBoardError ? (
        <div className="px-5 py-6 text-sm text-rose-100">
          {marketsQuery.isError
            ? `盘口读取失败：${marketsQuery.error instanceof Error ? marketsQuery.error.message : 'unknown error'}`
            : `历史窗口读取失败：${historiesQuery.error instanceof Error ? historiesQuery.error.message : 'unknown error'}`}
        </div>
      ) : eventCards.length === 0 ? (
        <div className="px-5 py-6 text-sm text-slate-500">
          {isCustomSector ? '这个自建 sector 还没有导入 event。' : '当前官方 sector 暂时没有可用 event。'}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="hidden border-b border-white/8 px-5 py-3 text-[11px] uppercase tracking-[0.16em] text-slate-500 xl:grid xl:grid-cols-[1.25fr_1.95fr_92px] xl:gap-5">
            <span>事件 (Event)</span>
            <span>选项概率 (Top 5)</span>
            <span>总成交量</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleEventCards.map((event) => {
              const eventMarkets = 'cachedEventPayload' in event ? event.cachedEventPayload.markets : event.markets;
              const eventVolume = eventMarkets.reduce((sum, market) => sum + market.volumeNum, 0);
              const outcomeDisplay = buildEventOutcomeDisplay(eventMarkets, analysisMarketsById);

              return (
                <div key={event.id} className="border-b border-white/8 last:border-b-0">
                  <div className="grid gap-5 px-5 py-5 xl:grid-cols-[1.25fr_1.95fr_92px]">
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <h3
                          className="max-w-full break-words text-[1.02rem] font-semibold leading-[1.55] text-white xl:text-[1.08rem]"
                          title={event.title}
                        >
                          {event.title}
                        </h3>
                        {'sourceUrl' in event ? (
                          <button
                            type="button"
                            onClick={() => removeImportedEvent(sectorId, event.id)}
                            className="rounded-full bg-white/[0.05] px-2 py-1 text-[11px] text-slate-300 hover:bg-rose-400/12 hover:text-rose-100"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                      {'sourceUrl' in event ? (
                        <p className="mt-2 truncate text-[11px] text-slate-500">{event.sourceUrl}</p>
                      ) : null}
                      {event.staleReason ? (
                        <p className="mt-2 text-xs text-slate-500">{event.staleReason}</p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      {outcomeDisplay.map((item) => {
                        return (
                          <div key={item.marketId} className="rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <p
                                className="min-w-0 flex-1 break-words text-[13px] font-medium leading-5 text-slate-200"
                                title={item.label}
                              >
                                {item.label}
                              </p>
                              <div className="shrink-0 text-right">
                                <p className="text-sm font-semibold text-white">
                                  {formatProbability(item.probability)}
                                </p>
                                {typeof item.delta === 'number' ? (
                                  <p className={`text-[11px] font-medium ${getDeltaTone(item.delta)}`}>
                                    {formatDelta(item.delta)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="text-right text-[13px] font-medium text-slate-300">
                      ${formatCompactMoney(eventVolume)}
                    </div>
                  </div>
                </div>
              );
            })}
            {!isCustomSector && (visibleEventCount < eventCards.length || hasMoreOfficialEvents) ? (
              <div className="border-t border-white/8 px-5 py-4">
                <button
                  type="button"
                  onClick={async () => {
                    if (visibleEventCount < eventCards.length) {
                      setVisibleEventCount((current) => current + VISIBLE_EVENT_INCREMENT);
                      return;
                    }
                    if (!activeOfficialSector || !officialMarketBatch.nextCursor || isLoadingMoreEvents) {
                      return;
                    }
                    setIsLoadingMoreEvents(true);
                    try {
                      const nextBatch = await fetchSectorMarkets(activeOfficialSector, {
                        afterCursor: officialMarketBatch.nextCursor,
                        pageCount: 1,
                      });
                      setAppendedOfficialBatches((current) => [...current, nextBatch]);
                      setVisibleEventCount((current) => current + VISIBLE_EVENT_INCREMENT);
                    } finally {
                      setIsLoadingMoreEvents(false);
                    }
                  }}
                  disabled={isLoadingMoreEvents}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200 hover:bg-white/[0.06] disabled:opacity-50"
                >
                  {visibleEventCount < eventCards.length
                    ? `继续展开已加载事件 (${Math.min(VISIBLE_EVENT_INCREMENT, eventCards.length - visibleEventCount)})`
                    : isLoadingMoreEvents
                      ? '正在读取更多事件…'
                      : '继续从上游读取更多事件'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {isCustomSector ? (
        <div className="border-t border-white/8 px-5 py-4">
          <div className="flex gap-2">
            <input
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
              placeholder="Polymarket URL to import..."
              className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none"
            />
            <button
              type="button"
              disabled={isImporting}
              onClick={async () => {
                const slug = parsePolymarketEventSlugFromUrl(importUrl);
                if (!slug) {
                  setImportError('URL 解析失败，请直接粘贴 Polymarket event 链接。');
                  return;
                }
                setIsImporting(true);
                setImportError(null);
                try {
                  const payload = await fetchEventBySlug(slug);
                  const now = Date.now();
                  upsertImportedEvent(sectorId, {
                    id: `imported-${payload.sourceEventId}`,
                    sectorId,
                    sourceUrl: importUrl.trim(),
                    sourceEventId: payload.sourceEventId,
                    title: payload.title,
                    cachedEventPayload: payload,
                    lastValidatedAt: now,
                    staleState: 'active',
                    createdAt: now,
                    updatedAt: now,
                  });
                  setImportUrl('');
                } catch (error) {
                  setImportError(error instanceof Error ? error.message : String(error));
                } finally {
                  setIsImporting(false);
                }
              }}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              Import
            </button>
          </div>
          {importError ? <p className="mt-2 text-xs text-rose-200">{importError}</p> : null}
        </div>
      ) : null}
    </section>
  );
});

type AnalystSidebarProps = {
  sectorId: string;
  sectorLabel: string;
  activeWindow: WindowKey;
  marketDataRequested: boolean;
  analysisReady: boolean;
  connectionStatus: MarketConnectionState;
  analysisPackageRef: { current: AnalysisPackage | null };
};

export const AnalystSidebar = memo(function AnalystSidebar({
  sectorId,
  sectorLabel,
  activeWindow,
  marketDataRequested,
  analysisReady,
  connectionStatus,
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
    if (!analysisPackage) {
      setSectorError(sectorId, buildManualAnalysisGuardMessage({
        sectorLabel,
        windowLabel: activeWindow,
      }));
      return;
    }
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
      const snapshot = buildSnapshotFromAssistantMessage({
        sectorSlug: sectorId,
        sectorLabel,
        window: activeWindow,
        message: completedAssistantMessage,
      });
      if (snapshot) {
        recordAnalysisSnapshot(sectorId, snapshot);
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
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/60">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-400" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">Sector Analyst (Online)</p>
        </div>
        <span className="rounded-full bg-white/[0.04] px-3 py-1 text-[11px] text-slate-400">
          {sectorLabel}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-300">
              {bindingSummary.title}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-300">
              {connectionStatus}
            </span>
            <button
              type="button"
              onClick={() => {
                streamAbortRef.current?.abort();
                streamAbortRef.current = null;
                setStreamingAssistant(null);
                resetSectorConversation(sectorId);
              }}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-300 hover:bg-white/[0.08]"
            >
              Reset
            </button>
          </div>

          <p className="text-[12px] leading-5 text-slate-400">
            根据当前盘口变化，判断 core issue 和 narrative 是否需要调整。
          </p>

          {routeNotice ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
              {routeNotice}
              <div className="mt-3">
                <Link to="/runtime" className="rounded-full bg-white/[0.08] px-3 py-2 text-xs text-slate-100">
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

        <div className="min-h-0 flex-1 border-t border-white/8 px-4 py-4">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/8 bg-white/[0.02] p-3">
            {visibleConversation.length === 0 ? (
              <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto text-sm text-slate-500">
                {emptyConversationMessage}
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                {visibleConversation.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-2xl border px-3 py-3 text-[13px] leading-6 ${
                      message.role === 'assistant'
                        ? 'border-white/8 bg-white/[0.04] text-slate-100'
                        : 'border-sky-300/25 bg-sky-300/10 text-sky-50'
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
        </div>

        <div className="border-t border-white/8 p-4">
          <textarea
            value={draftText}
            onChange={(event) => setSectorDraftText(sectorId, event.target.value)}
            rows={4}
            className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-3 text-[13px] text-white outline-none placeholder:text-slate-500 focus:border-sky-300/50"
            placeholder="Query logic / propose changes..."
          />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={isStreaming || !draftText.trim() || !routeStatus.ready}
              onClick={() => {
                void sendPrompt(draftText);
              }}
              className="flex-1 rounded-full bg-sky-300 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {isStreaming ? '分析中…' : 'Send'}
            </button>
            <button
              type="button"
              disabled={!isStreaming}
              onClick={() => {
                streamAbortRef.current?.abort();
              }}
              className="rounded-full bg-white/[0.08] px-4 py-3 text-sm text-slate-200 disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
});
