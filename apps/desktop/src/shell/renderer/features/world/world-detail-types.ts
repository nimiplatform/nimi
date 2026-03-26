export type WorldRecommendedAgentDisplay = {
  role?: string | null;
  faction?: string | null;
  rank?: string | null;
  sceneName?: string | null;
  location?: string | null;
};

export type WorldRecommendedAgent = {
  id: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  importance?: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND' | null;
  display?: WorldRecommendedAgentDisplay | null;
};

export type WorldDetailData = {
  id: string;
  name: string;
  description: string | null;
  tagline?: string | null;
  motto?: string | null;
  overview?: string | null;
  contentRating?: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  type: 'OASIS' | 'CREATOR';
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  level: number;
  levelUpdatedAt: string | null;
  agentCount: number;
  createdAt: string;
  creatorId: string | null;
  freezeReason: 'QUOTA_OVERFLOW' | 'WORLD_INACTIVE' | 'GOVERNANCE_LOCK' | null;
  lorebookEntryLimit: number;
  nativeAgentLimit: number;
  nativeCreationState: 'OPEN' | 'NATIVE_CREATION_FROZEN';
  scoreA: number;
  scoreC: number;
  scoreE: number;
  scoreEwma: number;
  scoreQ: number;
  flowRatio: number;
  isPaused?: boolean;
  transitInLimit: number;
  genre?: string | null;
  era?: string | null;
  themes?: string[] | null;
  currentWorldTime?: string | null;
  currentTimeLabel?: string | null;
  eraLabel?: string | null;
  primaryLanguage?: string | null;
  commonLanguages?: string[];
  recommendedAgents?: WorldRecommendedAgent[];
};

export type WorldAgentStats = {
  vitalityScore?: number | null;
  influenceTier?: string | null;
  interactionTier?: string | null;
  engagementCount?: number | null;
  lastActiveAt?: string | null;
};

export type WorldAgent = {
  id: string;
  name: string;
  handle: string;
  bio: string;
  role?: string | null;
  faction?: string | null;
  rank?: string | null;
  sceneName?: string | null;
  location?: string | null;
  createdAt: string;
  avatarUrl?: string | null;
  importance: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND';
  stats?: WorldAgentStats | null;
};

export type WorldHistoryEvidenceRef = {
  segmentId: string;
  offsetStart: number;
  offsetEnd: number;
  excerpt: string;
  confidence: number;
  sourceType: string;
};

export type WorldHistoryItem = {
  id: string;
  timelineSeq: number;
  time: string;
  title: string;
  tag: string;
  description: string;
  level: 'PRIMARY' | 'SECONDARY';
  eventHorizon: 'PAST' | 'ONGOING' | 'FUTURE';
  summary?: string | null;
  cause?: string | null;
  process?: string | null;
  result?: string | null;
  locationRefs: string[];
  characterRefs: string[];
  evidenceRefs: WorldHistoryEvidenceRef[];
  confidence: number;
  needsEvidence: boolean;
};

export type WorldHistorySummary = {
  primaryCount: number;
  secondaryCount: number;
  totalCount: number;
  eventCharacterCoverage: number;
  eventLocationCoverage: number;
};

export type WorldHistoryBundle = {
  items: WorldHistoryItem[];
  summary: WorldHistorySummary | null;
};

export type WorldSemanticRule = {
  key: string;
  title: string;
  value: string;
};

export type WorldSemanticLevel = {
  name: string;
  description?: string | null;
  extra?: string | null;
};

export type WorldSemanticTaboo = {
  name: string;
  description?: string | null;
  severity?: string | null;
};

export type WorldSemanticRealm = {
  name: string;
  description?: string | null;
  accessibility?: string | null;
};

export type WorldSemanticLanguage = {
  name: string;
  category?: string | null;
  description?: string | null;
  writingSample?: string | null;
  spokenSample?: string | null;
  isCommon?: boolean | null;
};

export type WorldSemanticTimelineItem = {
  id: string;
  title: string;
  summary?: string | null;
  eventType?: string | null;
  createdAt?: string | null;
};

export type WorldSemanticSnapshotItem = {
  id: string;
  versionLabel: string;
  summary?: string | null;
  createdAt?: string | null;
};

export type WorldSemanticPowerSystem = {
  name: string;
  description?: string | null;
  levels: WorldSemanticLevel[];
  rules: string[];
};

export type WorldSemanticTopology = {
  type?: string | null;
  boundary?: string | null;
  dimensions?: string | null;
  realms: WorldSemanticRealm[];
};

export type WorldSemanticData = {
  operationTitle?: string | null;
  operationDescription?: string | null;
  operationRules: WorldSemanticRule[];
  powerSystems: WorldSemanticPowerSystem[];
  standaloneLevels: WorldSemanticLevel[];
  taboos: WorldSemanticTaboo[];
  topology: WorldSemanticTopology | null;
  causality: {
    type?: string | null;
    karmaEnabled?: boolean | null;
    fateWeight?: number | null;
  } | null;
  languages: WorldSemanticLanguage[];
  worldviewEvents: WorldSemanticTimelineItem[];
  worldviewSnapshots: WorldSemanticSnapshotItem[];
  hasContent: boolean;
};

export type WorldAuditItem = {
  id: string;
  label: string;
  eventType?: string | null;
  occurredAt: string;
  prevLevel?: number | null;
  nextLevel?: number | null;
  ewmaScore?: number | null;
  freezeReason?: string | null;
};

export type WorldLorebookItem = {
  id: string;
  key: string;
  name?: string | null;
  content: string;
  keywords: string[];
  priority?: number | null;
};

export type WorldSceneItem = {
  id: string;
  name: string;
  description: string;
  activeEntities: string[];
};

export type WorldBindingItem = {
  id: string;
  objectType: string;
  objectId: string;
  hostType: string;
  hostId: string;
  bindingKind: string;
  bindingPoint?: string | null;
  priority: number;
  tags: string[];
  resource: {
    id: string;
    url: string;
    resourceType: string;
    label?: string | null;
  };
};

export type WorldPublicAssetsData = {
  lorebooks: WorldLorebookItem[];
  scenes: WorldSceneItem[];
  bindings: WorldBindingItem[];
};

export type WorldDetailLayoutCard<Key extends string = string> = {
  key: Key;
  span: 4 | 6 | 8 | 12;
};

export type WorldDetailLayoutPlan<Key extends string = string> = {
  cards: WorldDetailLayoutCard<Key>[];
};

export type CultivationRingsData = {
  systemName: string;
  systemDescription?: string | null;
  levels: WorldSemanticLevel[];
  extraSystems: WorldSemanticPowerSystem[];
};

export type RealmConstellationData = {
  topologyType?: string | null;
  boundary?: string | null;
  dimensions?: string | null;
  realms: WorldSemanticRealm[];
};
