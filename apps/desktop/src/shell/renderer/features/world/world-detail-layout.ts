import type {
  CultivationRingsData,
  RealmConstellationData,
  WorldDetailLayoutCard,
  WorldDetailLayoutPlan,
  WorldSemanticData,
} from './world-detail-types.js';

export const WORLD_DETAIL_SECTION_ORDER = [
  'hero',
  'dashboard',
  'core-rules',
  'timeline',
  'scenes',
  'agents',
  'extended',
] as const;

export type DashboardSecondaryCardKey = 'runtimeFacts' | 'recommendedAgents' | 'chronologyLanguage';
export type CoreRuleCardKey = 'operation' | 'taboos' | 'cultivation' | 'constellation' | 'causality' | 'languages';
export type ExtendedCardKey = 'knowledge' | 'governance';

export function resolveDashboardSecondaryLayout(
  input: {
    hasRuntimeFacts: boolean;
    recommendedAgentsCount: number;
    chronologyFactCount: number;
    hasLatestAudit: boolean;
  },
): WorldDetailLayoutPlan<DashboardSecondaryCardKey> {
  const cards: WorldDetailLayoutCard<DashboardSecondaryCardKey>[] = [];

  if (input.hasRuntimeFacts) {
    const runtimeSpan =
      input.recommendedAgentsCount > 0
        ? input.chronologyFactCount > 0
          ? input.hasLatestAudit ? 6 : 4
          : 6
        : input.chronologyFactCount > 0
          ? 6
          : 12;
    cards.push({ key: 'runtimeFacts', span: runtimeSpan });
  }

  if (input.recommendedAgentsCount > 0) {
    const recommendedSpan =
      input.chronologyFactCount > 0
        ? input.recommendedAgentsCount >= 3
          ? 8
          : 6
        : 6;
    cards.push({ key: 'recommendedAgents', span: recommendedSpan });
  }

  if (input.chronologyFactCount > 0) {
    const chronologySpan =
      input.chronologyFactCount >= 3 || input.recommendedAgentsCount > 0 ? 12 : 6;
    cards.push({ key: 'chronologyLanguage', span: chronologySpan });
  }

  return { cards };
}

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
        if (key === 'operation') return { key, span: operationSpan === 8 ? 6 : 6 };
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

export function resolveExtendedLayout(input: {
  hasKnowledge: boolean;
  hasGovernance: boolean;
}): WorldDetailLayoutPlan<ExtendedCardKey> {
  if (input.hasKnowledge && input.hasGovernance) {
    return {
      cards: [
        { key: 'knowledge', span: 8 },
        { key: 'governance', span: 4 },
      ],
    };
  }
  if (input.hasKnowledge) {
    return { cards: [{ key: 'knowledge', span: 12 }] };
  }
  if (input.hasGovernance) {
    return { cards: [{ key: 'governance', span: 12 }] };
  }
  return { cards: [] };
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
    systemName: primarySystem?.name ?? semantic.operationTitle ?? '力量体系',
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
