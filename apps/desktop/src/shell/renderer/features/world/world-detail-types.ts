import type {
  WorldSemanticLevel,
  WorldSemanticPowerSystem,
  WorldSemanticRealm,
} from '@nimiplatform/sdk/world';

export type {
  WorldAgent,
  WorldAgentStats,
  WorldAuditItem,
  WorldBindingItem,
  WorldDetailData,
  WorldHistoryBundle,
  WorldHistoryEvidenceRef,
  WorldHistoryItem,
  WorldHistorySummary,
  WorldLorebookItem,
  WorldPublicAssetsData,
  WorldRecommendedAgent,
  WorldRecommendedAgentDisplay,
  WorldSceneItem,
  WorldSemanticData,
  WorldSemanticLanguage,
  WorldSemanticLevel,
  WorldSemanticPowerSystem,
  WorldSemanticRealm,
  WorldSemanticRule,
  WorldSemanticSnapshotItem,
  WorldSemanticTaboo,
  WorldSemanticTimelineItem,
  WorldSemanticTopology,
} from '@nimiplatform/sdk/world';

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
