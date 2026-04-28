import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
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
  ImportedEventCachedPayload,
  ImportedEventRecord,
  PreparedMarket,
  SectorMarketBatch,
  SectorTag,
  TaxonomyOverlay,
  WindowKey,
} from '@renderer/data/types.js';
import { buildEventOutcomeDisplay } from './sector-market-display.js';
import {
  formatCompactMoney,
  formatDelta,
  formatProbability,
  getDeltaTone,
  groupOfficialEvents,
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
export { AnalystSidebar } from './sector-workspace-analyst-sidebar.js';
