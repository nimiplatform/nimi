import type {
  AnalysisPackage,
  HistoryPoint,
  ImportedEventCachedPayload,
  ImportedEventRecord,
  ImportedEventStaleState,
  PreparedMarket,
  SectorMarketBatch,
  SectorTag,
  TaxonomyOverlay,
  WindowKey,
} from './types.js';
import { hasTauriInvoke, invokeChecked } from '@renderer/bridge';
import { fetchFrontendSectorCatalog } from './frontend-taxonomy.js';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const CLOB_API_BASE = 'https://clob.polymarket.com';

type GammaTagResponse = {
  id: string;
  label: string;
  slug: string;
};

type GammaEventResponse = {
  id: string;
  title: string;
  description?: string;
  slug: string;
  markets?: GammaMarketResponse[];
  tags?: GammaTagResponse[];
};

type GammaEventsKeysetResponse = {
  events?: GammaEventResponse[];
  next_cursor?: string;
};

type GammaMarketResponse = {
  id: string;
  question?: string;
  groupItemTitle?: string;
  conditionId?: string;
  slug?: string;
  description?: string;
  image?: string;
  endDate?: string;
  volumeNum?: number;
  volume24hr?: number;
  liquidityNum?: number;
  spread?: number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  outcomePrices?: string;
  outcomes?: string;
  clobTokenIds?: string;
  active?: boolean;
  closed?: boolean;
  acceptingOrders?: boolean;
  tags?: GammaTagResponse[];
};

type PriceHistoryResponse = {
  history?: Array<{ t?: number; p?: number }>;
};

type BatchPriceHistoryResponse = {
  history?: Record<string, Array<{ t?: number; p?: number }>>;
};

type MarketLiveState = {
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
};

export type MarketConnectionState = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'error';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function parseUnknown<T>(value: unknown): T {
  return value as T;
}

function parseJsonStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseOutcomePrice(value: string | undefined): number | undefined {
  const parsed = parseJsonStringArray(value);
  const first = Number(parsed[0]);
  return Number.isFinite(first) ? first : undefined;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function scoreKeywordMatch(question: string, keywords: string[] | undefined): number {
  if (!keywords?.length) {
    return 0;
  }
  const haystack = ` ${question.toLowerCase()} `;
  return keywords.reduce((score, keyword) => (
    haystack.includes(` ${keyword.toLowerCase()} `) ? score + 2 : score
  ), 0);
}

function scoreRecordMatch(
  question: string,
  record: { title: string; definition: string; keywords?: string[] },
): number {
  const questionTokens = new Set(tokenize(question));
  let score = scoreKeywordMatch(question, record.keywords);
  for (const token of tokenize(`${record.title} ${record.definition}`)) {
    if (questionTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function pickYesTokenId(market: GammaMarketResponse): { yesTokenId?: string; noTokenId?: string } {
  const tokenIds = parseJsonStringArray(market.clobTokenIds);
  return {
    yesTokenId: tokenIds[0],
    noTokenId: tokenIds[1],
  };
}

function convertGammaEventToImportedPayload(event: GammaEventResponse): ImportedEventCachedPayload {
  const markets: PreparedMarket[] = [];
  for (const market of event.markets ?? []) {
    if (!market.active || market.closed || !market.acceptingOrders) {
      continue;
    }
    const tokens = pickYesTokenId(market);
    if (!tokens.yesTokenId) {
      continue;
    }
    markets.push({
      id: String(market.id),
      eventId: String(event.id),
      eventTitle: event.title,
      question: String(market.question || ''),
      groupItemTitle: market.groupItemTitle ? String(market.groupItemTitle).trim() : undefined,
      slug: String(market.slug || market.id),
      active: market.active,
      acceptingOrders: market.acceptingOrders,
      closed: market.closed,
      description: market.description,
      image: market.image,
      endDate: market.endDate,
      volumeNum: Number(market.volumeNum || 0),
      volume24hr: Number(market.volume24hr || 0),
      liquidityNum: Number(market.liquidityNum || 0),
      spread: Number(market.spread || 0),
      bestBid: market.bestBid,
      bestAsk: market.bestAsk,
      lastTradePrice: market.lastTradePrice,
      rawOutcomePrice: parseOutcomePrice(market.outcomePrices),
      yesTokenId: tokens.yesTokenId,
      noTokenId: tokens.noTokenId,
      tags: (event.tags ?? []).map((eventTag) => ({
        id: eventTag.id,
        label: eventTag.label,
        slug: eventTag.slug,
      })),
    });
  }

  return {
    sourceEventId: String(event.id),
    slug: String(event.slug),
    title: event.title,
    description: event.description,
    endDate: event.markets?.find((market) => market.endDate)?.endDate,
    markets,
  };
}

export function parsePolymarketEventSlugFromUrl(input: string): string | null {
  const normalized = String(input || '').trim();
  if (!normalized) {
    return null;
  }
  try {
    const url = new URL(normalized);
    if (!/polymarket\.com$/i.test(url.hostname)) {
      return null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    const eventIndex = segments.findIndex((segment) => segment === 'event');
    const slug = eventIndex === -1 ? segments[segments.length - 1] : segments[eventIndex + 1];
    return slug ? slug.trim() : null;
  } catch {
    return null;
  }
}

export async function fetchEventBySlug(slug: string): Promise<ImportedEventCachedPayload> {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) {
    throw new Error('缺少 event slug');
  }
  const event = hasTauriInvoke()
    ? await invokeChecked(
      'polymarket_event_by_slug',
      { slug: normalizedSlug },
      parseUnknown<GammaEventResponse>,
    )
    : await fetchJson<GammaEventResponse>(`${GAMMA_API_BASE}/events/slug/${encodeURIComponent(normalizedSlug)}`);
  const payload = convertGammaEventToImportedPayload(event);
  if (payload.markets.length === 0) {
    throw new Error('这个 event 当前没有可用市场');
  }
  return payload;
}

export async function validateImportedEventRecord(record: ImportedEventRecord): Promise<ImportedEventRecord> {
  try {
    const payload = await fetchEventBySlug(record.cachedEventPayload.slug);
    const staleState: ImportedEventStaleState = payload.markets.length === 0 ? 'closed' : 'active';
    return {
      ...record,
      title: payload.title,
      cachedEventPayload: payload,
      staleState,
      staleReason: staleState === 'active' ? undefined : '上游 event 当前没有可用市场',
      lastValidatedAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const staleState: ImportedEventStaleState = message.includes('slug not found') ? 'missing' : 'error';
    return {
      ...record,
      staleState,
      staleReason: staleState === 'missing' ? '上游 event 已不存在或 slug 无效' : message,
      lastValidatedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
}

export function computeDisplayPrice(market: PreparedMarket, live?: MarketLiveState): number {
  const bestBid = live?.bestBid ?? market.bestBid;
  const bestAsk = live?.bestAsk ?? market.bestAsk;
  const lastTradePrice = live?.lastTradePrice ?? market.lastTradePrice;

  if (typeof bestBid === 'number' && typeof bestAsk === 'number') {
    const spread = Math.abs(bestAsk - bestBid);
    if (spread > 0.1 && typeof lastTradePrice === 'number') {
      return lastTradePrice;
    }
    return Number(((bestBid + bestAsk) / 2).toFixed(4));
  }

  if (typeof lastTradePrice === 'number') {
    return lastTradePrice;
  }

  if (typeof market.rawOutcomePrice === 'number') {
    return market.rawOutcomePrice;
  }

  return 0;
}

function classifyWeightTier(market: PreparedMarket, ordered: PreparedMarket[]): 'lead' | 'support' | 'watch' {
  const index = ordered.findIndex((item) => item.id === market.id);
  if (index <= 2) return 'lead';
  if (index <= 7) return 'support';
  return 'watch';
}

export async function fetchSectorTags(limit?: number): Promise<SectorTag[]> {
  const sectors = await fetchFrontendSectorCatalog();
  return typeof limit === 'number' ? sectors.slice(0, limit) : sectors;
}

function dedupePreparedMarkets(markets: PreparedMarket[]): PreparedMarket[] {
  return markets.filter((market, index, items) => items.findIndex((item) => item.id === market.id) === index);
}

export function mergeSectorMarketBatches(batches: SectorMarketBatch[]): SectorMarketBatch {
  const mergedMarkets = dedupePreparedMarkets(
    batches.flatMap((batch) => batch.markets),
  ).sort((left, right) => right.volumeNum - left.volumeNum);
  const tailBatch = batches[batches.length - 1];
  return {
    markets: mergedMarkets,
    nextCursor: tailBatch?.nextCursor,
    hasMore: Boolean(tailBatch?.hasMore && tailBatch?.nextCursor),
  };
}

export async function fetchSectorMarkets(
  tag: SectorTag,
  input?: { afterCursor?: string; pageCount?: number },
): Promise<SectorMarketBatch> {
  const events: GammaEventResponse[] = [];
  let afterCursor = input?.afterCursor;
  let nextCursor: string | undefined;
  const pageCount = Math.max(1, input?.pageCount ?? 1);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = hasTauriInvoke()
      ? await invokeChecked(
        'polymarket_events_by_tag_slug',
        { tagSlug: tag.slug, limit: 100, afterCursor },
        parseUnknown<GammaEventsKeysetResponse>,
      )
      : await fetchJson<GammaEventsKeysetResponse>(
        `${GAMMA_API_BASE}/events/keyset?limit=100&tag_slug=${encodeURIComponent(tag.slug)}&closed=false&order=volume_24hr&ascending=false${afterCursor ? `&after_cursor=${encodeURIComponent(afterCursor)}` : ''}`,
      );
    const pageEvents = page.events ?? [];
    events.push(...pageEvents);
    if (!page.next_cursor || pageEvents.length === 0) {
      nextCursor = undefined;
      break;
    }
    nextCursor = page.next_cursor;
    afterCursor = page.next_cursor;
  }

  const flattened: PreparedMarket[] = [];
  for (const event of events) {
    for (const market of event.markets ?? []) {
      if (!market.active || market.closed || !market.acceptingOrders) {
        continue;
      }
      const tokens = pickYesTokenId(market);
      if (!tokens.yesTokenId) {
        continue;
      }
      flattened.push({
        id: String(market.id),
        eventId: String(event.id),
        eventTitle: event.title,
        question: String(market.question || ''),
        groupItemTitle: market.groupItemTitle ? String(market.groupItemTitle).trim() : undefined,
        slug: String(market.slug || market.id),
        active: market.active,
        acceptingOrders: market.acceptingOrders,
        closed: market.closed,
        description: market.description,
        image: market.image,
        endDate: market.endDate,
        volumeNum: Number(market.volumeNum || 0),
        volume24hr: Number(market.volume24hr || 0),
        liquidityNum: Number(market.liquidityNum || 0),
        spread: Number(market.spread || 0),
        bestBid: market.bestBid,
        bestAsk: market.bestAsk,
        lastTradePrice: market.lastTradePrice,
        rawOutcomePrice: parseOutcomePrice(market.outcomePrices),
        yesTokenId: tokens.yesTokenId,
        noTokenId: tokens.noTokenId,
        tags: (event.tags ?? []).map((eventTag) => ({
          id: eventTag.id,
          label: eventTag.label,
          slug: eventTag.slug,
        })),
      });
    }
  }

  return {
    markets: dedupePreparedMarkets(flattened)
      .sort((left, right) => right.volumeNum - left.volumeNum)
      .slice(0, 120),
    nextCursor,
    hasMore: Boolean(nextCursor),
  };
}

function getWindowStartTimestamp(windowKey: WindowKey, nowMs: number): number {
  switch (windowKey) {
    case '24h':
      return nowMs - 24 * 60 * 60 * 1000;
    case '48h':
      return nowMs - 48 * 60 * 60 * 1000;
    case '7d':
      return nowMs - 7 * 24 * 60 * 60 * 1000;
    default:
      return nowMs;
  }
}

export function getWindowStartPrice(history: HistoryPoint[], windowKey: WindowKey, nowMs = Date.now()): number {
  const target = getWindowStartTimestamp(windowKey, nowMs);
  let candidate = history[0]?.price ?? 0;
  for (const point of history) {
    if (point.timestamp <= target) {
      candidate = point.price;
      continue;
    }
    break;
  }
  return candidate;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function getHistoryRequestConfig(): { startTs: number; endTs: number; fidelity: number } {
  const nowMs = Date.now();
  const windowStart = getWindowStartTimestamp('7d', nowMs);
  const windowSpan = nowMs - windowStart;
  const buffer = Math.max(Math.floor(windowSpan * 0.3), 60 * 60 * 1000);
  return {
    startTs: Math.floor((windowStart - buffer) / 1000),
    endTs: Math.floor(nowMs / 1000),
    fidelity: 60,
  };
}

function normalizeHistoryPoints(points: Array<{ t?: number; p?: number }>): HistoryPoint[] {
  return points
    .map((point) => ({
      timestamp: Number(point.t || 0) * 1000,
      price: Number(point.p || 0),
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export async function fetchPriceHistory(tokenId: string): Promise<HistoryPoint[]> {
  const response = await fetchJson<PriceHistoryResponse>(
    `${CLOB_API_BASE}/prices-history?market=${encodeURIComponent(tokenId)}&interval=1w&fidelity=60`,
  );
  return normalizeHistoryPoints(response.history ?? []);
}

export async function fetchSectorHistory(
  markets: PreparedMarket[],
): Promise<Record<string, HistoryPoint[]>> {
  if (markets.length === 0) {
    return {};
  }

  const { startTs, endTs, fidelity } = getHistoryRequestConfig();
  const byTokenId: Record<string, HistoryPoint[]> = {};
  for (const chunk of chunkArray(markets, 20)) {
    const tokenIds = chunk.map((market) => market.yesTokenId);
    const response = hasTauriInvoke()
      ? await invokeChecked(
        'polymarket_batch_prices_history',
        {
          markets: tokenIds,
          interval: 'max',
          fidelity,
          startTs,
          endTs,
        },
        parseUnknown<BatchPriceHistoryResponse>,
      )
      : await fetchJson<BatchPriceHistoryResponse>(`${CLOB_API_BASE}/batch-prices-history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          markets: tokenIds,
          interval: 'max',
          fidelity,
          start_ts: startTs,
          end_ts: endTs,
        }),
      });
    for (const [tokenId, history] of Object.entries(response.history ?? {})) {
      byTokenId[tokenId] = normalizeHistoryPoints(history);
    }
  }

  return Object.fromEntries(
    markets.map((market) => [market.id, byTokenId[market.yesTokenId] ?? []]),
  );
}

function inferMarketContext(
  market: PreparedMarket,
  overlay: TaxonomyOverlay,
): { narrativeId?: string; coreVariableIds: string[] } {
  const question = `${market.question} ${market.eventTitle}`;
  const scoredNarratives = overlay.narratives
    .map((record) => ({
      id: record.id,
      score: scoreRecordMatch(question, record),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const scoredCoreVariables = overlay.coreVariables
    .map((record) => ({
      id: record.id,
      score: scoreRecordMatch(question, record),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((item) => item.id);

  return {
    narrativeId: scoredNarratives[0]?.id,
    coreVariableIds: scoredCoreVariables,
  };
}

export function buildAnalysisPackage(input: {
  tag: SectorTag;
  window: WindowKey;
  overlay: TaxonomyOverlay;
  markets: PreparedMarket[];
  histories: Record<string, HistoryPoint[]>;
  liveByTokenId: Record<string, MarketLiveState>;
}): AnalysisPackage {
  const ordered = [...input.markets].sort((left, right) => right.volumeNum - left.volumeNum);
  return {
    sector: {
      id: input.tag.id,
      label: input.tag.label,
      slug: input.tag.slug,
    },
    window: input.window,
    generatedAt: new Date().toISOString(),
    narratives: input.overlay.narratives,
    coreVariables: input.overlay.coreVariables,
    markets: ordered.map((market) => {
      const inferredContext = inferMarketContext(market, input.overlay);
      const narrativeId = inferredContext.narrativeId;
      const coreVariableIds = inferredContext.coreVariableIds;
      const narrative = input.overlay.narratives.find((item) => item.id === narrativeId);
      const relatedCoreVariables = input.overlay.coreVariables.filter((item) =>
        coreVariableIds?.includes(item.id),
      );
      const currentProbability = computeDisplayPrice(market, input.liveByTokenId[market.yesTokenId]);
      const history = input.histories[market.id] ?? [];
      const windowStartProbability = getWindowStartPrice(history, input.window);
      return {
        id: market.id,
        question: market.question,
        currentProbability,
        windowStartProbability,
        delta: currentProbability - windowStartProbability,
        volumeNum: market.volumeNum,
        volume24hr: market.volume24hr,
        liquidityNum: market.liquidityNum,
        spread: market.spread,
        weightTier: classifyWeightTier(market, ordered),
        eventTitle: market.eventTitle,
        narrativeId: narrative?.id,
        narrativeTitle: narrative?.title,
        coreVariableIds: relatedCoreVariables.map((item) => item.id),
        coreVariableTitles: relatedCoreVariables.map((item) => item.title),
      };
    }),
  };
}

export type MarketWebSocketHandler = (next: Record<string, MarketLiveState>) => void;

function applyLivePriceUpdate(
  liveByTokenId: Record<string, MarketLiveState>,
  raw: Record<string, unknown>,
): boolean {
  const assetId = typeof raw.asset_id === 'string'
    ? raw.asset_id
    : typeof raw.assetId === 'string'
      ? raw.assetId
      : undefined;
  if (!assetId) {
    return false;
  }

  const current = liveByTokenId[assetId] ?? {};
  const next: MarketLiveState = { ...current };
  const bestBid = Number(raw.best_bid ?? raw.bestBid);
  const bestAsk = Number(raw.best_ask ?? raw.bestAsk);
  const lastTradePrice = Number(raw.price ?? raw.last_trade_price ?? raw.lastTradePrice);

  if (Number.isFinite(bestBid) && bestBid >= 0) next.bestBid = bestBid;
  if (Number.isFinite(bestAsk) && bestAsk >= 0) next.bestAsk = bestAsk;
  if (Number.isFinite(lastTradePrice) && lastTradePrice >= 0) next.lastTradePrice = lastTradePrice;

  liveByTokenId[assetId] = next;
  return true;
}

export function createMarketWebSocket(
  assetIds: string[],
  onUpdate: MarketWebSocketHandler,
  onStatusChange?: (status: MarketConnectionState) => void,
): () => void {
  if (typeof window === 'undefined' || assetIds.length === 0) {
    return () => undefined;
  }

  const liveByTokenId: Record<string, MarketLiveState> = {};
  let socket: WebSocket | null = null;
  let pingTimer: number | null = null;
  let reconnectTimer: number | null = null;
  let flushTimer: number | null = null;
  let closedManually = false;
  let hasPendingUpdate = false;

  const clearTimers = () => {
    if (pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const flushUpdates = () => {
    flushTimer = null;
    if (!hasPendingUpdate) {
      return;
    }
    hasPendingUpdate = false;
    onUpdate({ ...liveByTokenId });
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) {
      return;
    }
    flushTimer = window.setTimeout(flushUpdates, 120);
  };

  const bindSocket = (status: MarketConnectionState) => {
    onStatusChange?.(status);
    socket = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    socket.addEventListener('open', () => {
      onStatusChange?.('live');
      socket?.send(JSON.stringify({ assets_ids: assetIds, type: 'market', custom_feature_enabled: true }));
      pingTimer = window.setInterval(() => {
        socket?.send('PING');
      }, 10_000);
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || event.data === 'PONG') {
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }

      let updated = applyLivePriceUpdate(liveByTokenId, parsed);
      const priceChanges = Array.isArray(parsed.price_changes) ? parsed.price_changes : [];
      for (const priceChange of priceChanges) {
        if (priceChange && typeof priceChange === 'object' && !Array.isArray(priceChange)) {
          updated = applyLivePriceUpdate(liveByTokenId, priceChange as Record<string, unknown>) || updated;
        }
      }
      if (!updated) {
        return;
      }
      hasPendingUpdate = updated;
      scheduleFlush();
    });

    socket.addEventListener('error', () => {
      onStatusChange?.('error');
    });

    socket.addEventListener('close', () => {
      if (closedManually) {
        onStatusChange?.('closed');
        return;
      }
      clearTimers();
      onStatusChange?.('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        bindSocket('reconnecting');
      }, 2_000);
    });
  };

  bindSocket('connecting');

  return () => {
    closedManually = true;
    clearTimers();
    socket?.close();
  };
}
