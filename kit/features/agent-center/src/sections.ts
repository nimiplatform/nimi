import type { AgentCenterSectionId } from './types.js';

export const AGENT_CENTER_SECTIONS: readonly AgentCenterSectionId[] = [
  'overview',
  'appearance',
  'behavior',
  'model',
  'cognition',
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
  'text.embed': 'Embedding',
  'image.generate': 'Image',
  'audio.synthesize': 'Audio',
  'voice_workflow.voice_clone': 'Voice Clone',
  'voice_workflow.voice_design': 'Voice Design',
} as const;
