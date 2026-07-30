import { getAgentCenterCatalogRecord } from './locales/index.js';
import type { AgentCenterSectionId } from './types.js';

export const AGENT_CENTER_SECTIONS: readonly AgentCenterSectionId[] = [
  'overview',
  'appearance',
  'behavior',
  'model',
  'cognition',
  'advanced',
];

export const AGENT_CENTER_SECTION_LABELS: Record<AgentCenterSectionId, string> = getAgentCenterCatalogRecord('AgentCenter.section.') as Record<AgentCenterSectionId, string>;
