import { describe, expect, it } from 'vitest';
import { getAvailableEncounterScripts } from './data/encounter-scripts.js';

describe('getAvailableEncounterScripts', () => {
  it('returns an empty list when the world catalog whitelist is empty', () => {
    expect(getAvailableEncounterScripts()).toEqual([]);
  });
});
