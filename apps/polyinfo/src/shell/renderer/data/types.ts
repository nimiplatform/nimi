export type AuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

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

export type MarketMappingOverride = {
  narrativeId?: string;
  coreVariableIds?: string[];
};

export type TaxonomyOverlay = {
  narratives: NarrativeRecord[];
  coreVariables: CoreVariableRecord[];
  marketMappingOverrides: Record<string, MarketMappingOverride>;
};

export type PreparedMarket = {
  id: string;
  eventId: string;
  eventTitle: string;
  question: string;
  slug: string;
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

export type HistoryPoint = {
  timestamp: number;
  price: number;
};

export type SectorTag = {
  id: string;
  label: string;
  slug: string;
  description?: string;
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
  entityType: 'narrative' | 'core-variable' | 'market-mapping';
  action: 'create' | 'update' | 'deactivate' | 'remap-market';
  title: string;
  definition?: string;
  keywords?: string[];
  recordId?: string;
  marketId?: string;
  narrativeId?: string;
  coreVariableIds?: string[];
  note?: string;
};

export type SectorChatState = {
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
