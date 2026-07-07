import type { AgentCenterSectionId } from './types.js';

export const AGENT_CENTER_SECTIONS: readonly AgentCenterSectionId[] = [
  'overview',
  'model',
  'behavior',
  'cognition',
  'appearance',
  'advanced',
];

export const AGENT_CENTER_SECTION_LABELS: Record<AgentCenterSectionId, string> = {
  overview: 'Overview',
  model: 'Model',
  behavior: 'Behavior',
  cognition: 'Cognition',
  appearance: 'Appearance',
  advanced: 'Advanced',
};

export const AGENT_CENTER_CAPABILITY_LABELS = {
  'text.generate': 'Text',
  'image.generate': 'Image',
  'audio.synthesize': 'Audio',
} as const;
