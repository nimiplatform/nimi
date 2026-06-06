import type {
  PublicBindingListDto,
  PublicWorldHistoryListDto,
  PublicWorldLorebookListDto,
  PublicWorldSceneListDto,
  RealmTypedClient,
  RealmWorldControllerListWorldsOperationRequest,
  WorldAgentSummaryDto,
  WorldDetailDto,
  WorldDetailWithAgentsDto,
  WorldLevelAuditEventDto,
  WorldviewDetailDto,
} from '../core-generated/realm-typed-client';
import type { JsonObject } from '../types';

export type NimiRealmWorldStatus =
  NonNullable<RealmWorldControllerListWorldsOperationRequest['query']>['status'];

type JsonProjection<T extends object> = JsonObject & T;

export type NimiRealmWorldDetail = JsonProjection<WorldDetailDto>;
export type NimiRealmWorldDetailWithAgents = JsonProjection<WorldDetailWithAgentsDto>;
export type NimiRealmWorldAgentSummary = JsonProjection<WorldAgentSummaryDto>;
export type NimiRealmWorldLevelAuditEvent = JsonProjection<WorldLevelAuditEventDto>;
export type NimiRealmWorldviewDetail = JsonProjection<WorldviewDetailDto>;
export type NimiRealmWorldHistoryPayload = JsonProjection<PublicWorldHistoryListDto>;
export type NimiRealmWorldLorebookListPayload = JsonProjection<PublicWorldLorebookListDto>;
export type NimiRealmWorldBindingListPayload = JsonProjection<PublicBindingListDto>;
export type NimiRealmWorldSceneListPayload = JsonProjection<PublicWorldSceneListDto>;

export interface NimiRealmWorldApi {
  readonly world: Pick<
    RealmTypedClient,
    | 'getWorldScenes'
    | 'worldControllerGetMainWorld'
    | 'worldControllerGetWorld'
    | 'worldControllerGetWorldAgents'
    | 'worldControllerGetWorldBindings'
    | 'worldControllerGetWorldDetailWithAgents'
    | 'worldControllerGetWorldHistory'
    | 'worldControllerGetWorldLevelAudits'
    | 'worldControllerGetWorldLorebooks'
    | 'worldControllerGetWorldview'
    | 'worldControllerListWorlds'
  >;
}

export type NimiRealmWorldSemanticBundle = {
  readonly world: NimiRealmWorldDetail | null;
  readonly worldview: NimiRealmWorldviewDetail | null;
  readonly worldviewEvents: readonly JsonObject[];
  readonly worldviewSnapshots: readonly JsonObject[];
};

export type NimiRealmWorldTruthAnchor = {
  readonly worldId: string;
  readonly title?: string;
  readonly summary?: string;
  readonly worldviewSummary?: string;
};

export type NimiRealmWorldTruthWorldType = 'OASIS' | 'CREATOR';
export type NimiRealmWorldTruthContentRating = 'UNRATED' | 'G' | 'PG13' | 'R18' | 'EXPLICIT';
export type NimiRealmWorldTruthNativeCreationState = 'OPEN' | 'NATIVE_CREATION_FROZEN';
export type NimiRealmWorldTruthWorldviewLifecycle = 'ACTIVE' | 'MAINTENANCE' | 'FROZEN' | 'ARCHIVED';

export type NimiRealmWorldTruthWorldview = {
  readonly lifecycle?: NimiRealmWorldTruthWorldviewLifecycle;
  readonly version?: number;
  readonly updatedAt?: string;
  readonly languageCount?: number;
  readonly regionCount?: number;
  readonly landmarkCount?: number;
  readonly truthRuleCount?: number;
  readonly hasVisualGuide?: boolean;
};

export type NimiRealmWorldTruthRecommendedAgent = {
  readonly agentId: string;
  readonly name: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
  readonly importance?: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND';
  readonly role?: string;
  readonly faction?: string;
  readonly location?: string;
  readonly statusSummary?: string;
};

export type NimiRealmWorldTruthListRecommendedAgent = {
  readonly agentId: string;
  readonly name: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
};

export type NimiRealmWorldTruthListComputed = {
  readonly time?: {
    readonly currentWorldTime?: string;
    readonly currentLabel?: string;
    readonly eraLabel?: string;
    readonly flowRatio?: number;
    readonly isPaused?: boolean;
  };
  readonly languages?: {
    readonly primary?: string;
    readonly common?: readonly string[];
  };
  readonly entry?: {
    readonly recommendedAgents?: readonly NimiRealmWorldTruthListRecommendedAgent[];
  };
  readonly score?: {
    readonly scoreEwma?: number;
  };
  readonly featuredAgentCount?: number;
};

export type NimiRealmWorldTruthSummary = NimiRealmWorldTruthAnchor & {
  readonly description?: string;
  readonly tagline?: string;
  readonly genre?: string;
  readonly themes?: readonly string[];
  readonly status?: NimiRealmWorldStatus;
  readonly type?: NimiRealmWorldTruthWorldType;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly worldview?: NimiRealmWorldTruthWorldview;
};

export type NimiRealmWorldTruthListItem = NimiRealmWorldTruthSummary & {
  readonly overview?: string;
  readonly motto?: string;
  readonly era?: string;
  readonly iconUrl?: string;
  readonly bannerUrl?: string;
  readonly creatorId?: string;
  readonly level?: number;
  readonly levelUpdatedAt?: string;
  readonly agentCount?: number;
  readonly freezeReason?: string;
  readonly lorebookEntryLimit?: number;
  readonly nativeAgentLimit?: number;
  readonly contentRating?: NimiRealmWorldTruthContentRating;
  readonly nativeCreationState?: NimiRealmWorldTruthNativeCreationState;
  readonly scoreA?: number;
  readonly scoreC?: number;
  readonly scoreE?: number;
  readonly scoreEwma?: number;
  readonly scoreQ?: number;
  readonly transitInLimit?: number;
  readonly computed?: NimiRealmWorldTruthListComputed;
};

export type NimiRealmWorldTruthDetail = NimiRealmWorldTruthSummary & {
  readonly overview?: string;
  readonly motto?: string;
  readonly era?: string;
  readonly iconUrl?: string;
  readonly bannerUrl?: string;
  readonly creatorId?: string;
  readonly level?: number;
  readonly agentCount?: number;
  readonly featuredAgentCount?: number;
  readonly contentRating?: NimiRealmWorldTruthContentRating;
  readonly nativeCreationState?: NimiRealmWorldTruthNativeCreationState;
  readonly recommendedAgents?: readonly NimiRealmWorldTruthRecommendedAgent[];
};

export type NimiRealmWorldRecommendedAgentDisplay = {
  readonly role?: string | null;
  readonly faction?: string | null;
  readonly rank?: string | null;
  readonly sceneName?: string | null;
  readonly location?: string | null;
};

export type NimiRealmWorldRecommendedAgent = {
  readonly id: string;
  readonly name: string;
  readonly handle?: string | null;
  readonly avatarUrl?: string | null;
  readonly importance?: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND' | null;
  readonly display?: NimiRealmWorldRecommendedAgentDisplay | null;
};

export type NimiRealmWorldDetailData = {
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
  readonly recommendedAgents?: readonly NimiRealmWorldRecommendedAgent[];
};

export type NimiRealmWorldAgentStats = {
  readonly vitalityScore?: number | null;
  readonly influenceTier?: string | null;
  readonly interactionTier?: string | null;
  readonly engagementCount?: number | null;
  readonly lastActiveAt?: string | null;
};

export type NimiRealmWorldAgent = {
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
  readonly stats?: NimiRealmWorldAgentStats | null;
};

export type NimiRealmWorldHistoryEvidenceRef = {
  readonly segmentId: string;
  readonly offsetStart: number;
  readonly offsetEnd: number;
  readonly excerpt: string;
  readonly confidence: number;
  readonly sourceType: string;
};

export type NimiRealmWorldHistoryItem = {
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
  readonly evidenceRefs: readonly NimiRealmWorldHistoryEvidenceRef[];
  readonly confidence: number;
  readonly needsEvidence: boolean;
};

export type NimiRealmWorldHistorySummary = {
  readonly primaryCount: number;
  readonly secondaryCount: number;
  readonly totalCount: number;
  readonly eventCharacterCoverage: number;
  readonly eventLocationCoverage: number;
};

export type NimiRealmWorldHistoryBundle = {
  readonly items: readonly NimiRealmWorldHistoryItem[];
  readonly summary: NimiRealmWorldHistorySummary | null;
};

export type NimiRealmWorldSemanticRule = {
  readonly key: string;
  readonly title: string;
  readonly value: string;
};

export type NimiRealmWorldSemanticLevel = {
  readonly name: string;
  readonly description?: string | null;
  readonly extra?: string | null;
};

export type NimiRealmWorldSemanticTaboo = {
  readonly name: string;
  readonly description?: string | null;
  readonly severity?: string | null;
};

export type NimiRealmWorldSemanticRealm = {
  readonly name: string;
  readonly description?: string | null;
  readonly accessibility?: string | null;
};

export type NimiRealmWorldSemanticLanguage = {
  readonly name: string;
  readonly category?: string | null;
  readonly description?: string | null;
  readonly writingSample?: string | null;
  readonly spokenSample?: string | null;
  readonly isCommon?: boolean | null;
};

export type NimiRealmWorldSemanticTimelineItem = {
  readonly id: string;
  readonly title: string;
  readonly summary?: string | null;
  readonly eventType?: string | null;
  readonly createdAt?: string | null;
};

export type NimiRealmWorldSemanticSnapshotItem = {
  readonly id: string;
  readonly versionLabel: string;
  readonly summary?: string | null;
  readonly createdAt?: string | null;
};

export type NimiRealmWorldSemanticPowerSystem = {
  readonly name: string;
  readonly description?: string | null;
  readonly levels: readonly NimiRealmWorldSemanticLevel[];
  readonly rules: readonly string[];
};

export type NimiRealmWorldSemanticTopology = {
  readonly type?: string | null;
  readonly boundary?: string | null;
  readonly dimensions?: string | null;
  readonly realms: readonly NimiRealmWorldSemanticRealm[];
};

export type NimiRealmWorldSemanticData = {
  readonly operationTitle?: string | null;
  readonly operationDescription?: string | null;
  readonly operationRules: readonly NimiRealmWorldSemanticRule[];
  readonly powerSystems: readonly NimiRealmWorldSemanticPowerSystem[];
  readonly standaloneLevels: readonly NimiRealmWorldSemanticLevel[];
  readonly taboos: readonly NimiRealmWorldSemanticTaboo[];
  readonly topology: NimiRealmWorldSemanticTopology | null;
  readonly causality: {
    readonly type?: string | null;
    readonly karmaEnabled?: boolean | null;
    readonly fateWeight?: number | null;
  } | null;
  readonly languages: readonly NimiRealmWorldSemanticLanguage[];
  readonly worldviewEvents: readonly NimiRealmWorldSemanticTimelineItem[];
  readonly worldviewSnapshots: readonly NimiRealmWorldSemanticSnapshotItem[];
  readonly hasContent: boolean;
};

export type NimiRealmWorldAuditItem = {
  readonly id: string;
  readonly label: string;
  readonly eventType?: string | null;
  readonly occurredAt: string;
  readonly prevLevel?: number | null;
  readonly nextLevel?: number | null;
  readonly ewmaScore?: number | null;
  readonly freezeReason?: string | null;
};

export type NimiRealmWorldLorebookItem = {
  readonly id: string;
  readonly key: string;
  readonly name?: string | null;
  readonly content: string;
  readonly keywords: readonly string[];
  readonly priority?: number | null;
};

export type NimiRealmWorldSceneItem = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly activeEntities: readonly string[];
};

export type NimiRealmWorldBindingItem = {
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

export type NimiRealmWorldPublicAssetsData = {
  readonly lorebooks: readonly NimiRealmWorldLorebookItem[];
  readonly scenes: readonly NimiRealmWorldSceneItem[];
  readonly bindings: readonly NimiRealmWorldBindingItem[];
};

export type NimiRealmWorldPrimaryDetailRecord<T extends object = JsonObject> = T & {
  readonly worldTruth: NimiRealmWorldTruthDetail;
};

export type NimiRealmWorldDisplayComputed = {
  readonly time: {
    readonly currentWorldTime: string | null;
    readonly currentLabel: string | null;
    readonly eraLabel: string | null;
    readonly flowRatio: number;
    readonly isPaused: boolean;
  };
  readonly languages: {
    readonly primary: string | null;
    readonly common: readonly string[];
  };
  readonly entry: {
    readonly recommendedAgents: readonly NimiRealmWorldRecommendedAgent[];
  };
  readonly score: {
    readonly scoreEwma: number;
  };
  readonly featuredAgentCount: number;
};
