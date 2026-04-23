export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

export type AnalystRoute = 'local' | 'cloud';

export type AnalystRuntimeSettings = {
  route: AnalystRoute;
  localModel: string;
  cloudConnectorId: string;
  cloudModel: string;
};

export type RuntimeCloudConnector = {
  id: string;
  label: string;
  provider: string;
  models: string[];
};

export type WindowKey = '24h' | '48h' | '7d';

export type NarrativeRecord = {
  id: string;
  title: string;
  definition: string;
  keywords?: string[];
  confirmationState: 'confirmed' | 'proposed';
};

export type CoreVariableRecord = {
  id: string;
  title: string;
  definition: string;
  keywords?: string[];
  confirmationState: 'confirmed' | 'proposed';
};

export type CustomSectorRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type ImportedEventStaleState = 'active' | 'closed' | 'missing' | 'error';

export type ImportedEventCachedPayload = {
  sourceEventId: string;
  slug: string;
  title: string;
  description?: string;
  endDate?: string;
  markets: PreparedMarket[];
};

export type ImportedEventRecord = {
  id: string;
  sectorId: string;
  sourceUrl: string;
  sourceEventId: string;
  title: string;
  cachedEventPayload: ImportedEventCachedPayload;
  lastValidatedAt: number | null;
  staleState: ImportedEventStaleState;
  staleReason?: string;
  createdAt: number;
  updatedAt: number;
};

export type TaxonomyOverlay = {
  narratives: NarrativeRecord[];
  coreVariables: CoreVariableRecord[];
};

export type PreparedMarket = {
  id: string;
  eventId: string;
  eventTitle: string;
  question: string;
  groupItemTitle?: string;
  slug: string;
  active?: boolean;
  acceptingOrders?: boolean;
  closed?: boolean;
  endDate?: string;
  description?: string;
  image?: string;
  volumeNum: number;
  volume24hr: number;
  liquidityNum: number;
  spread: number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  rawOutcomePrice?: number;
  yesTokenId: string;
  noTokenId?: string;
  tags: Array<{ id: string; label: string; slug: string }>;
};

export type SectorMarketBatch = {
  markets: PreparedMarket[];
  nextCursor?: string;
  hasMore: boolean;
};

export type HistoryPoint = {
  timestamp: number;
  price: number;
};

export type SectorTag = {
  id: string;
  label: string;
  slug: string;
  description?: string;
  parentSlug?: string;
  displayedCount?: number;
};

export type FrontendCategoryGroup = {
  id: string;
  label: string;
  slug: string;
  description?: string;
};

export type FrontendCategoryItem = {
  id: string;
  label: string;
  slug: string;
  parentSlug: string;
  displayedCount?: number;
};

export type FrontendCategoryMappingRow = {
  category: FrontendCategoryItem;
  fetchedCount: number;
  pageCount: number;
  sampleEvents: Array<{
    id: string;
    title: string;
    slug: string;
  }>;
};

export type FrontendCategoryMapping = {
  root: FrontendCategoryGroup;
  generatedAt: string;
  rows: FrontendCategoryMappingRow[];
};

export type AnalysisPackageMarket = {
  id: string;
  question: string;
  currentProbability: number;
  windowStartProbability: number;
  delta: number;
  volumeNum: number;
  volume24hr: number;
  liquidityNum: number;
  spread: number;
  weightTier: 'lead' | 'support' | 'watch';
  eventTitle: string;
  narrativeId?: string;
  narrativeTitle?: string;
  coreVariableIds: string[];
  coreVariableTitles: string[];
};

export type AnalysisPackage = {
  sector: {
    id: string;
    label: string;
    slug: string;
  };
  window: WindowKey;
  generatedAt: string;
  narratives: NarrativeRecord[];
  coreVariables: CoreVariableRecord[];
  markets: AnalysisPackageMarket[];
};

export type AnalystMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: number;
  status?: 'streaming' | 'complete' | 'error';
  error?: string;
};

export type DraftProposal = {
  id: string;
  entityType: 'narrative' | 'core-variable';
  action: 'create' | 'update' | 'deactivate';
  title: string;
  definition?: string;
  keywords?: string[];
  recordId?: string;
  note?: string;
};

export type SectorChatState = {
  threadId: string;
  title: string;
  draftText: string;
  createdAt: number;
  updatedAt: number;
  messages: AnalystMessage[];
  draftProposal: DraftProposal | null;
  isStreaming: boolean;
  error: string | null;
};

export type AnalysisSnapshot = {
  id: string;
  sectorSlug: string;
  sectorLabel: string;
  window: WindowKey;
  createdAt: number;
  headline: string;
  summary: string;
  messageId: string;
};
