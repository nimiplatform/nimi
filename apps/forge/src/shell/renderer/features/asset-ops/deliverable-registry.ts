import type { ImageGenTarget } from '@renderer/data/image-gen-client.js';

export type WorldDeliverableFamily =
  | 'world-icon'
  | 'world-cover'
  | 'world-background'
  | 'world-scene';
export type AgentDeliverableFamily =
  | 'agent-avatar'
  | 'agent-cover'
  | 'agent-greeting-primary'
  | 'agent-voice-demo';

export type WorldDeliverableBindingPoint =
  | 'WORLD_ICON'
  | 'WORLD_BANNER'
  | 'SCENE_BACKGROUND'
  | 'WORLD_GALLERY';

export type DeliverableRegistryEntry<Family extends string> = {
  family: Family;
  label: string;
  requiredForPublish: boolean;
};

export type WorldDeliverableRegistryEntry = DeliverableRegistryEntry<WorldDeliverableFamily> & {
  bindingPoint: WorldDeliverableBindingPoint;
  studioTarget: Extract<ImageGenTarget, 'world-icon' | 'world-banner' | 'world-background' | 'world-scene'>;
  showInCatalogVisuals: boolean;
};

export const WORLD_DELIVERABLE_REGISTRY = [
  {
    family: 'world-icon',
    label: 'Icon',
    requiredForPublish: true,
    bindingPoint: 'WORLD_ICON',
    studioTarget: 'world-icon',
    showInCatalogVisuals: true,
  },
  {
    family: 'world-cover',
    label: 'Cover',
    requiredForPublish: true,
    bindingPoint: 'WORLD_BANNER',
    studioTarget: 'world-banner',
    showInCatalogVisuals: true,
  },
  {
    family: 'world-background',
    label: 'Background',
    requiredForPublish: false,
    bindingPoint: 'SCENE_BACKGROUND',
    studioTarget: 'world-background',
    showInCatalogVisuals: false,
  },
  {
    family: 'world-scene',
    label: 'Scene',
    requiredForPublish: false,
    bindingPoint: 'WORLD_GALLERY',
    studioTarget: 'world-scene',
    showInCatalogVisuals: false,
  },
] as const satisfies readonly WorldDeliverableRegistryEntry[];

export const AGENT_DELIVERABLE_REGISTRY = [
  {
    family: 'agent-avatar',
    label: 'Avatar',
    requiredForPublish: true,
  },
  {
    family: 'agent-cover',
    label: 'Cover',
    requiredForPublish: false,
  },
  {
    family: 'agent-greeting-primary',
    label: 'Greeting',
    requiredForPublish: true,
  },
  {
    family: 'agent-voice-demo',
    label: 'Voice Demo',
    requiredForPublish: true,
  },
] as const satisfies readonly DeliverableRegistryEntry<AgentDeliverableFamily>[];

export function isWorldDeliverableRequiredForPublish(family: WorldDeliverableFamily): boolean {
  return WORLD_DELIVERABLE_REGISTRY.find((entry) => entry.family === family)?.requiredForPublish ?? false;
}

export function isAgentDeliverableRequiredForPublish(family: AgentDeliverableFamily): boolean {
  return AGENT_DELIVERABLE_REGISTRY.find((entry) => entry.family === family)?.requiredForPublish ?? false;
}

export function getWorldDeliverableRegistryEntry(family: WorldDeliverableFamily): WorldDeliverableRegistryEntry {
  const entry = WORLD_DELIVERABLE_REGISTRY.find((item) => item.family === family);
  if (!entry) {
    throw new Error(`FORGE_WORLD_DELIVERABLE_FAMILY_UNSUPPORTED:${family}`);
  }
  return entry;
}
