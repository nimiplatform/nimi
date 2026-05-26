import {
  AGENT_DELIVERABLE_REGISTRY,
  WORLD_DELIVERABLE_REGISTRY,
  type AgentDeliverableFamily,
  type WorldDeliverableFamily,
} from './deliverable-registry.js';

export type DeliverableVisualState = 'MISSING' | 'PRESENT' | 'BOUND';

export type DeliverableCoverageCounts = {
  currentReadyCount: number;
  boundCount: number;
};

export type AgentDeliverableLike = {
  family: AgentDeliverableFamily;
  currentState: DeliverableVisualState;
};

export type AgentRosterSummaryBadgeItem = {
  family: AgentDeliverableFamily;
  label: string;
  value: number;
  state: DeliverableVisualState;
};

export type AgentDeliverableCardItem = {
  family: AgentDeliverableFamily;
  label: string;
  detail: string;
  value: number;
  state: DeliverableVisualState;
};

export type WorldVisualCardItem = {
  family: WorldDeliverableFamily;
  title: string;
  description: string;
  previewUrl: string | null;
  previewName: string;
};

export type WorldAgentSummaryKpiItem = {
  key: 'current-complete' | 'needs-review' | 'voice-demo-bound';
  label: string;
  value: string;
  detail: string;
};

export type WorldAgentHeroStatus = {
  state: DeliverableVisualState;
  label: string;
};

export type AgentRosterStatusBadge = {
  state: DeliverableVisualState;
  label: string;
};

export type AgentRosterPageStatItem = {
  key: 'world-owned-agents' | 'current-complete' | 'ops-complete' | 'unverified-required';
  label: string;
  value: string | number;
  detail: string;
};

export const AGENT_ROSTER_COMPLETENESS_COPY = {
  worldOwnedAgentsLabel: 'World-Owned Agents',
  worldOwnedAgentsDetail: "Agents routed through this world's truth surface.",
  currentCompleteLabel: 'Current Complete',
  currentCompleteDetail: 'Required deliverables are present or bound on the current roster.',
  opsCompleteLabel: 'Ops Complete',
  opsCompleteDetail: 'Required deliverables are fully backed by admitted bound ops truth.',
  unverifiedRequiredLabel: 'Unverified Required',
  unverifiedRequiredDetail: 'Required deliverables are present but not yet backed by bound ops truth.',
  missingRequiredLabel: 'Missing Required',
  summaryDescription: 'Required deliverables are summarized from current roster inspection.',
  completenessOverviewTitle: 'Completeness Overview',
  completenessOverviewDescription: 'Required deliverables distinguish missing, present, and bound posture. Optional cover status stays visible per agent.',
  needsReviewLabel: 'Needs Review',
  needsReviewDetail: 'Roster items still need one or more required deliverables or review.',
  voiceDemoBoundLabel: 'Voice Demo Bound',
  voiceDemoBoundDetail: 'Roster agents with a bound voice demo in canonical asset ops.',
} as const;

const AGENT_DELIVERABLE_PRESENTATION = {
  'agent-avatar': {
    summaryLabel: 'Avatar Present',
    summaryMetric: 'currentReadyCount',
    summaryState: 'PRESENT',
    cardDetail: 'Current active avatar presence',
  },
  'agent-cover': {
    summaryLabel: 'Cover Bound',
    summaryMetric: 'boundCount',
    summaryState: 'BOUND',
    cardDetail: 'World portrait binding slot',
  },
  'agent-greeting-primary': {
    summaryLabel: 'Greeting Present',
    summaryMetric: 'currentReadyCount',
    summaryState: 'PRESENT',
    cardDetail: 'Primary opening line',
  },
  'agent-voice-demo': {
    summaryLabel: 'Voice Demo Bound',
    summaryMetric: 'boundCount',
    summaryState: 'BOUND',
    cardDetail: 'Playable world voice sample',
  },
} as const satisfies Record<
  AgentDeliverableFamily,
  {
    summaryLabel: string;
    summaryMetric: keyof DeliverableCoverageCounts;
    summaryState: DeliverableVisualState;
    cardDetail: string;
  }
>;

const WORLD_DELIVERABLE_PRESENTATION = {
  'world-icon': {
    title: 'Icon',
    description: 'Current icon slot for catalog identity.',
  },
  'world-cover': {
    title: 'Cover',
    description: 'Current cover/banner slot for world presentation.',
  },
  'world-background': {
    title: 'Background',
    description: 'Ambient backdrop slot for world shell surfaces.',
  },
  'world-scene': {
    title: 'Scene',
    description: 'Narrative scene slot for world key art.',
  },
} as const satisfies Record<
  WorldDeliverableFamily,
  {
    title: string;
    description: string;
  }
>;

export function buildAgentRosterSummaryBadgeItems(
  familyCoverage: Partial<Record<AgentDeliverableFamily, DeliverableCoverageCounts>> | undefined,
): AgentRosterSummaryBadgeItem[] {
  return AGENT_DELIVERABLE_REGISTRY
    .filter((entry) => entry.requiredForPublish)
    .map((entry) => {
      const presentation = AGENT_DELIVERABLE_PRESENTATION[entry.family];
      const coverage = familyCoverage?.[entry.family];
      return {
        family: entry.family,
        label: presentation.summaryLabel,
        value: coverage?.[presentation.summaryMetric] ?? 0,
        state: presentation.summaryState,
      };
    });
}

export function buildAgentDeliverableCardItems(
  deliverables: AgentDeliverableLike[],
  options?: {
    includeOptional?: boolean;
  },
): AgentDeliverableCardItem[] {
  return AGENT_DELIVERABLE_REGISTRY
    .filter((entry) => options?.includeOptional || entry.requiredForPublish)
    .map((entry) => {
      const presentation = AGENT_DELIVERABLE_PRESENTATION[entry.family];
      const deliverable = deliverables.find((item) => item.family === entry.family);
      const state = deliverable?.currentState ?? 'MISSING';
      return {
        family: entry.family,
        label: entry.label,
        detail: presentation.cardDetail,
        value: state === 'MISSING' ? 0 : presentation.summaryMetric === 'boundCount' ? (state === 'BOUND' ? 1 : 0) : 1,
        state,
      };
    });
}

export function buildWorldVisualCardItems(input: {
  worldName: string;
  iconUrl: string | null;
  bannerUrl: string | null;
}): WorldVisualCardItem[] {
  return WORLD_DELIVERABLE_REGISTRY
    .filter((entry) => entry.showInCatalogVisuals)
    .map((entry) => ({
      family: entry.family,
      title: WORLD_DELIVERABLE_PRESENTATION[entry.family].title,
      description: WORLD_DELIVERABLE_PRESENTATION[entry.family].description,
      previewUrl: entry.family === 'world-icon' ? input.iconUrl : input.bannerUrl,
      previewName: input.worldName,
    }));
}

export function buildWorldAgentHeroStatus(input: {
  agentCount: number;
  currentCompleteCount: number;
}): WorldAgentHeroStatus {
  if (input.currentCompleteCount > 0) {
    return {
      state: 'PRESENT',
      label: `${input.currentCompleteCount} Current-Ready Agents`,
    };
  }
  if (input.agentCount > 0) {
    return {
      state: 'MISSING',
      label: `${input.agentCount} Agents Need Review`,
    };
  }
  return {
    state: 'MISSING',
    label: 'Agent Delivery Missing',
  };
}

export function buildWorldAgentSummaryKpiItems(input: {
  agentCount: number;
  currentCompleteCount: number;
  voiceDemoBoundCount: number;
}): WorldAgentSummaryKpiItem[] {
  return [
    {
      key: 'current-complete',
      label: 'Current-Ready Agents',
      value: `${input.currentCompleteCount}/${input.agentCount}`,
      detail: 'Required deliverables are present or already bound.',
    },
    {
      key: 'needs-review',
      label: 'Agents Needing Review',
      value: `${Math.max(input.agentCount - input.currentCompleteCount, 0)}/${input.agentCount}`,
      detail: 'Roster items still missing one or more required current deliverables.',
    },
    {
      key: 'voice-demo-bound',
      label: AGENT_ROSTER_COMPLETENESS_COPY.voiceDemoBoundLabel,
      value: `${input.voiceDemoBoundCount}/${input.agentCount}`,
      detail: AGENT_ROSTER_COMPLETENESS_COPY.voiceDemoBoundDetail,
    },
  ];
}

export function buildAgentRosterStatusBadge(input: {
  currentState: string;
  opsState: string;
}): AgentRosterStatusBadge {
  const state =
    input.opsState === 'COMPLETE'
      ? 'BOUND'
      : input.currentState === 'COMPLETE' || input.currentState === 'PARTIAL'
        ? 'PRESENT'
        : 'MISSING';
  return {
    state,
    label: `Roster ${state === 'BOUND' ? 'Bound' : state === 'PRESENT' ? 'Present' : 'Missing'}`,
  };
}

export function buildAgentRosterPageStatItems(input: {
  agentCount: number;
  currentCompleteCount: number;
  opsCompleteCount: number;
  unverifiedRequiredFamilyCount: number;
}): AgentRosterPageStatItem[] {
  return [
    {
      key: 'world-owned-agents',
      label: AGENT_ROSTER_COMPLETENESS_COPY.worldOwnedAgentsLabel,
      value: input.agentCount,
      detail: AGENT_ROSTER_COMPLETENESS_COPY.worldOwnedAgentsDetail,
    },
    {
      key: 'current-complete',
      label: AGENT_ROSTER_COMPLETENESS_COPY.currentCompleteLabel,
      value: `${input.currentCompleteCount}/${input.agentCount}`,
      detail: AGENT_ROSTER_COMPLETENESS_COPY.currentCompleteDetail,
    },
    {
      key: 'ops-complete',
      label: AGENT_ROSTER_COMPLETENESS_COPY.opsCompleteLabel,
      value: `${input.opsCompleteCount}/${input.agentCount}`,
      detail: AGENT_ROSTER_COMPLETENESS_COPY.opsCompleteDetail,
    },
    {
      key: 'unverified-required',
      label: AGENT_ROSTER_COMPLETENESS_COPY.unverifiedRequiredLabel,
      value: input.unverifiedRequiredFamilyCount,
      detail: AGENT_ROSTER_COMPLETENESS_COPY.unverifiedRequiredDetail,
    },
  ];
}

export function formatAgentRosterCompletenessLine(input: {
  currentState: string;
  opsState: string;
}): string {
  return `Current completeness: ${input.currentState.toLowerCase()}. Ops-backed completeness: ${input.opsState.toLowerCase()}.`;
}
