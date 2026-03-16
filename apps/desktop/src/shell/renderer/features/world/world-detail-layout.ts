import type {
  CultivationRingsData,
  RealmConstellationData,
  WorldDetailLayoutPlan,
  WorldSemanticData,
} from './world-detail-types.js';

export type WorldDetailSectionKey =
  | 'hero'
  | 'dashboard'
  | 'oasis-identity'
  | 'core-rules'
  | 'recommended'
  | 'scenes'
  | 'timeline'
  | 'agents'
  | 'extended';

export type WorldDetailSectionSpec = {
  key: WorldDetailSectionKey;
  anchorId?: string;
  showInQuickNav?: boolean;
  quickNavLabelKey?: string;
};

export type WorldDetailComposition = {
  sections: WorldDetailSectionSpec[];
};

export const NARRATIVE_WORLD_DETAIL_COMPOSITION: WorldDetailComposition = {
  sections: [
    { key: 'hero' },
    { key: 'dashboard' },
    {
      key: 'core-rules',
      anchorId: 'world-detail-rules',
      showInQuickNav: true,
      quickNavLabelKey: 'WorldDetail.xianxia.v2.quickNav.rules',
    },
    {
      key: 'recommended',
      anchorId: 'world-detail-recommended',
      showInQuickNav: true,
      quickNavLabelKey: 'WorldDetail.xianxia.v2.quickNav.characters',
    },
    {
      key: 'scenes',
      anchorId: 'world-detail-scenes',
      showInQuickNav: true,
      quickNavLabelKey: 'WorldDetail.xianxia.v2.quickNav.scenes',
    },
    {
      key: 'timeline',
      anchorId: 'world-detail-timeline',
      showInQuickNav: true,
      quickNavLabelKey: 'WorldDetail.xianxia.v2.quickNav.timeline',
    },
    {
      key: 'agents',
      anchorId: 'world-detail-agents',
      showInQuickNav: true,
      quickNavLabelKey: 'WorldDetail.xianxia.v2.quickNav.roster',
    },
    {
      key: 'extended',
      anchorId: 'world-detail-governance-card',
      showInQuickNav: true,
      quickNavLabelKey: 'WorldDetail.xianxia.v2.quickNav.governance',
    },
  ],
};

export const OASIS_WORLD_DETAIL_COMPOSITION: WorldDetailComposition = {
  sections: [
    { key: 'hero' },
    { key: 'oasis-identity' },
    { key: 'dashboard' },
    {
      key: 'scenes',
      anchorId: 'world-detail-scenes',
    },
    {
      key: 'timeline',
      anchorId: 'world-detail-timeline',
    },
    {
      key: 'agents',
      anchorId: 'world-detail-agents',
    },
  ],
};

export type CoreRuleCardKey = 'operation' | 'taboos' | 'cultivation' | 'constellation' | 'causality' | 'languages';

export function resolveCoreRuleLayout(input: {
  operationRuleCount: number;
  hasOperationDescription: boolean;
  tabooCount: number;
  cultivationLevelCount: number;
  extraPowerSystemCount: number;
  topologyRealmCount: number;
  topologyMetaCount: number;
  causalityFieldCount: number;
  languageCount: number;
  languageHasSamples: boolean;
}): WorldDetailLayoutPlan<CoreRuleCardKey> {
  const orderedCards: CoreRuleCardKey[] = [
    'operation',
    'taboos',
    'cultivation',
    'constellation',
    'causality',
    'languages',
  ];
  const cards = orderedCards.filter((key): key is CoreRuleCardKey => {
    switch (key) {
      case 'operation':
        return input.operationRuleCount > 0 || input.hasOperationDescription;
      case 'taboos':
        return input.tabooCount > 0;
      case 'cultivation':
        return input.cultivationLevelCount > 0;
      case 'constellation':
        return input.topologyRealmCount > 0 || input.topologyMetaCount > 0;
      case 'causality':
        return input.causalityFieldCount > 0;
      case 'languages':
        return input.languageCount > 0;
      default:
        return false;
    }
  });

  const hasCultivation = input.cultivationLevelCount > 0;
  const hasConstellation = input.topologyRealmCount > 0 || input.topologyMetaCount > 0;
  const hasVisualPair = hasCultivation && hasConstellation;
  const hasSingleVisual = hasCultivation !== hasConstellation;

  const operationSpan: 0 | 6 | 8 =
    input.operationRuleCount >= 4 || (input.operationRuleCount >= 2 && input.hasOperationDescription)
      ? 8
      : input.operationRuleCount > 0 || input.hasOperationDescription
        ? 6
        : 0;
  const tabooSpan: 0 | 4 | 6 = input.tabooCount >= 3 ? 6 : input.tabooCount > 0 ? 4 : 0;
  const cultivationSpan: 0 | 6 | 8 =
    input.cultivationLevelCount >= 8 || input.extraPowerSystemCount > 0
      ? 8
      : input.cultivationLevelCount > 0
        ? 6
        : 0;
  const constellationSpan: 0 | 6 | 8 =
    input.topologyRealmCount >= 5 || (input.topologyRealmCount >= 3 && input.topologyMetaCount > 0)
      ? 8
      : input.topologyRealmCount > 0 || input.topologyMetaCount > 0
        ? 6
        : 0;
  const causalitySpan: 0 | 4 | 6 = input.causalityFieldCount >= 3 ? 6 : input.causalityFieldCount > 0 ? 4 : 0;
  const languagesSpan: 0 | 4 | 6 =
    input.languageCount >= 3 || input.languageHasSamples
      ? 6
      : input.languageCount > 0
        ? 4
        : 0;

  return {
    cards: cards.map((key) => {
      if (hasVisualPair) {
        if (key === 'cultivation') return { key, span: cultivationSpan || 8 };
        if (key === 'constellation') return { key, span: constellationSpan || 8 };
        if (key === 'operation') return { key, span: operationSpan || 6 };
        if (key === 'taboos') return { key, span: tabooSpan || 4 };
        if (key === 'languages') return { key, span: languagesSpan || 4 };
        return { key, span: causalitySpan || 4 };
      }

      if (hasSingleVisual) {
        if (key === 'cultivation' || key === 'constellation') {
          const supportCount =
            Number(operationSpan > 0) +
            Number(tabooSpan > 0) +
            Number(causalitySpan > 0) +
            Number(languagesSpan > 0);
          return { key, span: supportCount > 0 ? 8 : 12 };
        }
        if (key === 'operation') return { key, span: operationSpan || 6 };
        if (key === 'taboos') return { key, span: tabooSpan || 4 };
        if (key === 'languages') return { key, span: languagesSpan || 4 };
        return { key, span: causalitySpan || 4 };
      }

      if (cards.length === 1) {
        return { key, span: 12 };
      }
      if (cards.length === 2) {
        if (key === 'operation') return { key, span: 6 };
        if (key === 'taboos') return { key, span: tabooSpan || 6 };
        if (key === 'languages') return { key, span: languagesSpan || 6 };
        return { key, span: causalitySpan || 6 };
      }
      if (key === 'operation') return { key, span: operationSpan === 8 ? 6 : 4 };
      if (key === 'taboos') return { key, span: tabooSpan || 4 };
      if (key === 'cultivation') return { key, span: cultivationSpan || 6 };
      if (key === 'constellation') return { key, span: constellationSpan || 6 };
      if (key === 'languages') return { key, span: languagesSpan || 4 };
      return { key, span: causalitySpan || 4 };
    }),
  };
}

export function mapCultivationRingsData(semantic: WorldSemanticData): CultivationRingsData | null {
  const primarySystem = semantic.powerSystems[0] ?? null;
  const levels = primarySystem?.levels.length
    ? primarySystem.levels.slice(0, 12)
    : semantic.standaloneLevels.slice(0, 12);

  if (!levels.length) {
    return null;
  }

  return {
    systemName: primarySystem?.name ?? semantic.operationTitle ?? '',
    systemDescription: primarySystem?.description ?? semantic.operationDescription ?? null,
    levels,
    extraSystems: semantic.powerSystems.slice(1).filter((system) => system.levels.length > 0),
  };
}

export function mapRealmConstellationData(semantic: WorldSemanticData): RealmConstellationData | null {
  const topology = semantic.topology;
  if (!topology) {
    return null;
  }

  const hasMeta = Boolean(topology.type || topology.boundary || topology.dimensions);
  const realms = topology.realms.slice(0, 8);
  if (!realms.length && !hasMeta) {
    return null;
  }

  return {
    topologyType: topology.type ?? null,
    boundary: topology.boundary ?? null,
    dimensions: topology.dimensions ?? null,
    realms,
  };
}
