export type WorldRecommendedAgentDisplay = {
  readonly role?: string | null;
  readonly faction?: string | null;
  readonly rank?: string | null;
  readonly sceneName?: string | null;
  readonly location?: string | null;
};

export type WorldRecommendedAgent = {
  readonly id: string;
  readonly name: string;
  readonly handle?: string | null;
  readonly avatarUrl?: string | null;
  readonly importance?: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND' | null;
  readonly display?: WorldRecommendedAgentDisplay | null;
};

export type WorldDetailData = {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly tagline?: string | null;
  readonly motto?: string | null;
  readonly overview?: string | null;
  readonly contentRating?: string | null;
  readonly iconUrl: string | null;
  readonly bannerUrl: string | null;
  readonly type: 'OASIS' | 'CREATOR';
  readonly status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  readonly level: number;
  readonly levelUpdatedAt: string | null;
  readonly agentCount: number;
  readonly createdAt: string;
  readonly creatorId: string | null;
  readonly freezeReason: 'QUOTA_OVERFLOW' | 'WORLD_INACTIVE' | 'GOVERNANCE_LOCK' | null;
  readonly lorebookEntryLimit: number;
  readonly nativeAgentLimit: number;
  readonly nativeCreationState: 'OPEN' | 'NATIVE_CREATION_FROZEN';
  readonly scoreA: number;
  readonly scoreC: number;
  readonly scoreE: number;
  readonly scoreEwma: number;
  readonly scoreQ: number;
  readonly flowRatio: number;
  readonly isPaused?: boolean;
  readonly transitInLimit: number;
  readonly genre?: string | null;
  readonly era?: string | null;
  readonly themes?: readonly string[] | null;
  readonly currentWorldTime?: string | null;
  readonly currentTimeLabel?: string | null;
  readonly eraLabel?: string | null;
  readonly primaryLanguage?: string | null;
  readonly commonLanguages?: readonly string[];
  readonly recommendedAgents?: readonly WorldRecommendedAgent[];
};

export type WorldAgentStats = {
  readonly vitalityScore?: number | null;
  readonly influenceTier?: string | null;
  readonly interactionTier?: string | null;
  readonly engagementCount?: number | null;
  readonly lastActiveAt?: string | null;
};

export type WorldAgent = {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly bio: string;
  readonly role?: string | null;
  readonly faction?: string | null;
  readonly rank?: string | null;
  readonly sceneName?: string | null;
  readonly location?: string | null;
  readonly createdAt: string;
  readonly avatarUrl?: string | null;
  readonly importance: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND';
  readonly stats?: WorldAgentStats | null;
};

export type WorldHistoryEvidenceRef = {
  readonly segmentId: string;
  readonly offsetStart: number;
  readonly offsetEnd: number;
  readonly excerpt: string;
  readonly confidence: number;
  readonly sourceType: string;
};

export type WorldHistoryItem = {
  readonly id: string;
  readonly timelineSeq: number;
  readonly time: string;
  readonly title: string;
  readonly tag: string;
  readonly description: string;
  readonly level: 'PRIMARY' | 'SECONDARY';
  readonly eventHorizon: 'PAST' | 'ONGOING' | 'FUTURE';
  readonly summary?: string | null;
  readonly cause?: string | null;
  readonly process?: string | null;
  readonly result?: string | null;
  readonly locationRefs: readonly string[];
  readonly characterRefs: readonly string[];
  readonly evidenceRefs: readonly WorldHistoryEvidenceRef[];
  readonly confidence: number;
  readonly needsEvidence: boolean;
};

export type WorldHistorySummary = {
  readonly primaryCount: number;
  readonly secondaryCount: number;
  readonly totalCount: number;
  readonly eventCharacterCoverage: number;
  readonly eventLocationCoverage: number;
};

export type WorldHistoryBundle = {
  readonly items: readonly WorldHistoryItem[];
  readonly summary: WorldHistorySummary | null;
};

export type WorldSemanticRule = {
  readonly key: string;
  readonly title: string;
  readonly value: string;
};

export type WorldSemanticLevel = {
  readonly name: string;
  readonly description?: string | null;
  readonly extra?: string | null;
};

export type WorldSemanticTaboo = {
  readonly name: string;
  readonly description?: string | null;
  readonly severity?: string | null;
};

export type WorldSemanticRealm = {
  readonly name: string;
  readonly description?: string | null;
  readonly accessibility?: string | null;
};

export type WorldSemanticLanguage = {
  readonly name: string;
  readonly category?: string | null;
  readonly description?: string | null;
  readonly writingSample?: string | null;
  readonly spokenSample?: string | null;
  readonly isCommon?: boolean | null;
};

export type WorldSemanticTimelineItem = {
  readonly id: string;
  readonly title: string;
  readonly summary?: string | null;
  readonly eventType?: string | null;
  readonly createdAt?: string | null;
};

export type WorldSemanticSnapshotItem = {
  readonly id: string;
  readonly versionLabel: string;
  readonly summary?: string | null;
  readonly createdAt?: string | null;
};

export type WorldSemanticPowerSystem = {
  readonly name: string;
  readonly description?: string | null;
  readonly levels: readonly WorldSemanticLevel[];
  readonly rules: readonly string[];
};

export type WorldSemanticTopology = {
  readonly type?: string | null;
  readonly boundary?: string | null;
  readonly dimensions?: string | null;
  readonly realms: readonly WorldSemanticRealm[];
};

export type WorldSemanticData = {
  readonly operationTitle?: string | null;
  readonly operationDescription?: string | null;
  readonly operationRules: readonly WorldSemanticRule[];
  readonly powerSystems: readonly WorldSemanticPowerSystem[];
  readonly standaloneLevels: readonly WorldSemanticLevel[];
  readonly taboos: readonly WorldSemanticTaboo[];
  readonly topology: WorldSemanticTopology | null;
  readonly causality: {
    readonly type?: string | null;
    readonly karmaEnabled?: boolean | null;
    readonly fateWeight?: number | null;
  } | null;
  readonly languages: readonly WorldSemanticLanguage[];
  readonly worldviewEvents: readonly WorldSemanticTimelineItem[];
  readonly worldviewSnapshots: readonly WorldSemanticSnapshotItem[];
  readonly hasContent: boolean;
};

export type WorldAuditItem = {
  readonly id: string;
  readonly label: string;
  readonly eventType?: string | null;
  readonly occurredAt: string;
  readonly prevLevel?: number | null;
  readonly nextLevel?: number | null;
  readonly ewmaScore?: number | null;
  readonly freezeReason?: string | null;
};

export type WorldLorebookItem = {
  readonly id: string;
  readonly key: string;
  readonly name?: string | null;
  readonly content: string;
  readonly keywords: readonly string[];
  readonly priority?: number | null;
};

export type WorldSceneItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly activeEntities: readonly string[];
};

export type WorldBindingItem = {
  readonly id: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly hostType: string;
  readonly hostId: string;
  readonly bindingKind: string;
  readonly bindingPoint?: string | null;
  readonly priority: number;
  readonly tags: readonly string[];
  readonly resource: {
    readonly id: string;
    readonly url: string;
    readonly resourceType: string;
    readonly label?: string | null;
  };
};

export type WorldPublicAssetsData = {
  readonly lorebooks: readonly WorldLorebookItem[];
  readonly scenes: readonly WorldSceneItem[];
  readonly bindings: readonly WorldBindingItem[];
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
  levels: readonly WorldSemanticLevel[];
  extraSystems: readonly WorldSemanticPowerSystem[];
};

export type RealmConstellationData = {
  topologyType?: string | null;
  boundary?: string | null;
  dimensions?: string | null;
  realms: readonly WorldSemanticRealm[];
};
