import type {
  NimiRealmWorldSemanticLevel as WorldSemanticLevel,
  NimiRealmWorldSemanticPowerSystem as WorldSemanticPowerSystem,
  NimiRealmWorldSemanticRealm as WorldSemanticRealm,
} from '@nimiplatform/sdk/realm';

export type {
  NimiRealmWorldAgent as WorldAgent,
  NimiRealmWorldAgentStats as WorldAgentStats,
  NimiRealmWorldAuditItem as WorldAuditItem,
  NimiRealmWorldBindingItem as WorldBindingItem,
  NimiRealmWorldDetailData as WorldDetailData,
  NimiRealmWorldHistoryBundle as WorldHistoryBundle,
  NimiRealmWorldHistoryEvidenceRef as WorldHistoryEvidenceRef,
  NimiRealmWorldHistoryItem as WorldHistoryItem,
  NimiRealmWorldHistorySummary as WorldHistorySummary,
  NimiRealmWorldLorebookItem as WorldLorebookItem,
  NimiRealmWorldPublicAssetsData as WorldPublicAssetsData,
  NimiRealmWorldRecommendedAgent as WorldRecommendedAgent,
  NimiRealmWorldRecommendedAgentDisplay as WorldRecommendedAgentDisplay,
  NimiRealmWorldSceneItem as WorldSceneItem,
  NimiRealmWorldSemanticData as WorldSemanticData,
  NimiRealmWorldSemanticLanguage as WorldSemanticLanguage,
  NimiRealmWorldSemanticLevel as WorldSemanticLevel,
  NimiRealmWorldSemanticPowerSystem as WorldSemanticPowerSystem,
  NimiRealmWorldSemanticRealm as WorldSemanticRealm,
  NimiRealmWorldSemanticRule as WorldSemanticRule,
  NimiRealmWorldSemanticSnapshotItem as WorldSemanticSnapshotItem,
  NimiRealmWorldSemanticTaboo as WorldSemanticTaboo,
  NimiRealmWorldSemanticTimelineItem as WorldSemanticTimelineItem,
  NimiRealmWorldSemanticTopology as WorldSemanticTopology,
} from '@nimiplatform/sdk/realm';

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
