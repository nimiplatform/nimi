import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import { buildSectorPath } from '@renderer/app-shell/workspace-routes.js';
import {
  buildAnalysisPackage,
  buildImportedEventRecord,
  fetchEventBySlug,
  fetchSectorHistory,
  fetchSectorMarkets,
  mergeSectorMarketBatches,
  parsePolymarketEventSlugFromUrl,
} from '@renderer/data/polymarket.js';
import type {
  AnalysisPackage,
  AnalystMessage,
  ImportedEventCachedPayload,
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
} from './sector-workspace-state.js';
import { streamSectorAnalyst } from './sector-analyst-runtime.js';
import {
  ProposalCard,
  createMessage,
  formatCompactMoney,
  formatDelta,
  formatProbability,
  getDeltaTone,
  groupOfficialEvents,
  isStaleRuntimeBridgeError,
  summarizeEventLogic,
  type OfficialEventCard,
} from './sector-workspace-panel-helpers.js';

const INITIAL_VISIBLE_EVENT_COUNT = 18;
const VISIBLE_EVENT_INCREMENT = 18;
const INITIAL_SECTOR_EVENT_PAGE_COUNT = 2;

function buildPayloadFromOfficialEvent(event: OfficialEventCard): ImportedEventCachedPayload {
  return {
    sourceEventId: event.sourceEventId,
    slug: event.eventSlug || event.sourceEventId,
    title: event.title,
    endDate: event.markets.find((market) => market.endDate)?.endDate,
    markets: event.markets,
  };
}

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
  analysisPackageRef,
}: MarketBoardPanelProps) {
  const navigate = useNavigate();
  const upsertImportedEvent = useAppStore((state) => state.upsertImportedEvent);
  const removeImportedEvent = useAppStore((state) => state.removeImportedEvent);
  const customSectors = useAppStore((state) => state.customSectors);
  const addCustomSector = useAppStore((state) => state.addCustomSector);
  const setActiveWindow = useAppStore((state) => state.setActiveWindow);

  const [visibleEventCount, setVisibleEventCount] = useState(INITIAL_VISIBLE_EVENT_COUNT);
  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [addMenuEventId, setAddMenuEventId] = useState<string | null>(null);
  const [eventAddMessage, setEventAddMessage] = useState<string | null>(null);
  const [appendedOfficialBatches, setAppendedOfficialBatches] = useState<SectorMarketBatch[]>([]);
  const [isLoadingMoreEvents, setIsLoadingMoreEvents] = useState(false);
  const lastAnalysisReadyRef = useRef(false);
  useEffect(() => {
    setVisibleEventCount(INITIAL_VISIBLE_EVENT_COUNT);
    setImportUrl('');
    setImportError(null);
    setImportMessage(null);
    setIsImporting(false);
    setAddMenuEventId(null);
    setEventAddMessage(null);
    setAppendedOfficialBatches([]);
    setIsLoadingMoreEvents(false);
  }, [sectorId]);
  const customSectorList = useMemo(
    () => Object.values(customSectors).sort((left, right) => left.title.localeCompare(right.title)),
    [customSectors],
  );
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
      liveByTokenId: {},
    });
  }, [
    activeSectorMeta,
    activeWindow,
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
  const addOfficialEventToSector = useCallback((event: OfficialEventCard, targetSectorId: string) => {
    const targetSector = customSectors[targetSectorId];
    if (!targetSector) {
      return;
    }
    const payload = buildPayloadFromOfficialEvent(event);
    upsertImportedEvent(targetSectorId, buildImportedEventRecord({
      sectorId: targetSectorId,
      sourceUrl: `https://polymarket.com/event/${payload.slug}`,
      payload,
    }));
    setAddMenuEventId(null);
    setEventAddMessage(`已加入 ${targetSector.title}`);
  }, [customSectors, upsertImportedEvent]);
  const createSectorAndAddOfficialEvent = useCallback((event: OfficialEventCard) => {
    const title = event.title.trim() || 'New custom sector';
    const targetSectorId = addCustomSector(title);
    const payload = buildPayloadFromOfficialEvent(event);
    upsertImportedEvent(targetSectorId, buildImportedEventRecord({
      sectorId: targetSectorId,
      sourceUrl: `https://polymarket.com/event/${payload.slug}`,
      payload,
    }));
    setAddMenuEventId(null);
    setEventAddMessage(`已创建并加入 ${title}`);
    navigate(buildSectorPath(targetSectorId));
  }, [addCustomSector, navigate, upsertImportedEvent]);
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b polyinfo-hairline px-5 py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-teal-200/60">Market Movements</p>
          <p className="mt-1 text-[13px] text-slate-500">盘口变化 / REST price snapshots</p>
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
            className="rounded-xl bg-teal-300 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-teal-200 disabled:opacity-50"
          >
            {loadingMarketData ? 'Loading…' : marketDataRequested ? 'Refresh Prices' : 'Load Prices'}
          </button>
          <div className="flex rounded-xl border border-white/10 bg-white/[0.035] p-1">
            {(['24h', '48h', '7d'] as const).map((window) => (
              <button
                key={window}
                type="button"
                onClick={() => setActiveWindow(window)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  activeWindow === window ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {window}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="border-b polyinfo-hairline bg-slate-950/20 px-5 py-3 text-sm text-slate-400">
        {boardModeMessage}
        {eventAddMessage ? (
          <span className="ml-3 text-teal-200">{eventAddMessage}</span>
        ) : null}
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
          <div className="hidden border-b polyinfo-hairline px-5 py-3 text-[11px] uppercase tracking-[0.14em] text-slate-500 xl:grid xl:grid-cols-[1.4fr_1.25fr_0.45fr_1fr] xl:gap-4">
            <span>事件 (Event)</span>
            <span>选项概率 (Top 5)</span>
            <span>总成交量</span>
            <span>映射逻辑 (Logic Node)</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleEventCards.map((event) => {
              const eventMarkets = 'cachedEventPayload' in event ? event.cachedEventPayload.markets : event.markets;
              const eventVolume = eventMarkets.reduce((sum, market) => sum + market.volumeNum, 0);
              const logic = summarizeEventLogic({
                eventMarkets,
                analysisMarketsById,
                overlay,
              });
              const outcomeDisplay = buildEventOutcomeDisplay(eventMarkets, analysisMarketsById);
              return (
                <div key={event.id} className="border-b polyinfo-hairline last:border-b-0">
                  <div className="grid gap-4 px-5 py-5 xl:grid-cols-[1.4fr_1.25fr_0.45fr_1fr]">
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <h3
                            className="max-w-full break-words text-[1.02rem] font-semibold leading-[1.55] text-white xl:text-[1.06rem]"
                          title={event.title}
                        >
                          {event.title}
                        </h3>
                        <div className="relative shrink-0">
                        {'sourceUrl' in event ? (
                          <button
                            type="button"
                            onClick={() => removeImportedEvent(sectorId, event.id)}
                            className="rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] text-slate-300 hover:bg-rose-400/12 hover:text-rose-100"
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Add ${event.title} to custom sector`}
                            title="Add to custom sector"
                            onClick={() => {
                              setEventAddMessage(null);
                              if (customSectorList.length === 0) {
                                createSectorAndAddOfficialEvent(event);
                                return;
                              }
                              setAddMenuEventId((current) => (current === event.id ? null : event.id));
                            }}
                            className="rounded-lg bg-white/[0.06] px-2 py-1 text-[13px] font-semibold text-slate-300 hover:bg-teal-300/12 hover:text-teal-100"
                          >
                            +
                          </button>
                        )}
                        {!('sourceUrl' in event) && addMenuEventId === event.id ? (
                          <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-white/10 bg-slate-950 p-2 shadow-2xl">
                            <p className="px-2 pb-2 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                              Add to custom sector
                            </p>
                            <div className="max-h-52 space-y-1 overflow-y-auto">
                              {customSectorList.map((targetSector) => (
                                <button
                                  key={targetSector.id}
                                  type="button"
                                  onClick={() => addOfficialEventToSector(event, targetSector.id)}
                                  className="w-full rounded-lg px-2 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.08]"
                                >
                                  {targetSector.title}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => createSectorAndAddOfficialEvent(event)}
                              className="mt-2 w-full rounded-lg border border-teal-300/25 px-2 py-2 text-left text-xs text-teal-100 hover:bg-teal-300/10"
                            >
                              New custom sector
                            </button>
                          </div>
                        ) : null}
                        </div>
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
                          <div key={item.marketId} className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
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
                                  <p className={`text-[11px] font-semibold ${getDeltaTone(item.delta)}`}>
                                    {formatDelta(item.delta)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[13px] font-medium text-slate-300">
                      ${formatCompactMoney(eventVolume)}
                    </div>
                    <div className="border-l border-white/8 pl-4 text-[12px] text-slate-400">
                      <p className="text-teal-200">N:: {logic.narrativeTitle ?? '待选择'}</p>
                      <p className="mt-2 truncate">V:: {logic.coreIssueTitle ?? '待选择'}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            {!isCustomSector && (visibleEventCount < eventCards.length || hasMoreOfficialEvents) ? (
              <div className="border-t polyinfo-hairline px-5 py-4">
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
                  className="w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-sm text-slate-200 hover:bg-white/[0.06] disabled:opacity-50"
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
        <div className="border-t polyinfo-hairline px-5 py-4">
          <div className="flex gap-2">
            <input
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
              placeholder="Polymarket URL to import..."
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-white outline-none focus:border-teal-300/50"
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
                  upsertImportedEvent(sectorId, buildImportedEventRecord({
                    sectorId,
                    sourceUrl: importUrl.trim(),
                    payload,
                  }));
                  setImportMessage(`已加入 ${payload.title}`);
                  setImportUrl('');
                } catch (error) {
                  setImportError(error instanceof Error ? error.message : String(error));
                  setImportMessage(null);
                } finally {
                  setIsImporting(false);
                }
              }}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              Import
            </button>
          </div>
          {importError ? <p className="mt-2 text-xs text-rose-200">{importError}</p> : null}
          {importMessage ? <p className="mt-2 text-xs text-teal-200">{importMessage}</p> : null}
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
