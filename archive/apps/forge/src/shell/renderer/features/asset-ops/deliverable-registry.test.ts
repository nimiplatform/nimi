import { describe, expect, it } from 'vitest';
import {
  WORLD_DELIVERABLE_REGISTRY,
  getWorldDeliverableRegistryEntry,
  isWorldDeliverableRequiredForPublish,
} from './deliverable-registry.js';

describe('deliverable-registry', () => {
  it('keeps world background and scene admitted but optional for publish', () => {
    expect(WORLD_DELIVERABLE_REGISTRY.map((entry) => entry.family)).toEqual([
      'world-icon',
      'world-cover',
      'world-background',
      'world-scene',
    ]);

    expect(isWorldDeliverableRequiredForPublish('world-icon')).toBe(true);
    expect(isWorldDeliverableRequiredForPublish('world-cover')).toBe(true);
    expect(isWorldDeliverableRequiredForPublish('world-background')).toBe(false);
    expect(isWorldDeliverableRequiredForPublish('world-scene')).toBe(false);
  });

  it('exposes canonical binding points and studio targets for extended world families', () => {
    expect(getWorldDeliverableRegistryEntry('world-background')).toMatchObject({
      bindingPoint: 'SCENE_BACKGROUND',
      studioTarget: 'world-background',
      showInCatalogVisuals: false,
    });
    expect(getWorldDeliverableRegistryEntry('world-scene')).toMatchObject({
      bindingPoint: 'WORLD_GALLERY',
      studioTarget: 'world-scene',
      showInCatalogVisuals: false,
    });
  });
});
