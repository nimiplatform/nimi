import { describe, it, expect } from 'vitest';
import { getExperimentSuggestion } from './journal-experiment-templates.js';

const COVERED_DIMENSIONS = [
  'PO-OBS-CONC-001',
  'PO-OBS-EMOT-001',
  'PO-OBS-SOCL-001',
  'PO-OBS-CHOI-001',
  'PO-OBS-INDP-001',
  'PO-OBS-RELQ-001',
  'PO-OBS-ATTC-001',
  'PO-OBS-EXEC-001',
];

describe('getExperimentSuggestion', () => {
  it('returns null for null dimensionId', () => {
    expect(getExperimentSuggestion(null)).toBeNull();
  });

  it('returns null for uncovered dimension', () => {
    expect(getExperimentSuggestion('PO-OBS-REPT-001')).toBeNull();
    expect(getExperimentSuggestion('PO-OBS-MOVE-001')).toBeNull();
    expect(getExperimentSuggestion('UNKNOWN')).toBeNull();
  });

  for (const dimensionId of COVERED_DIMENSIONS) {
    it(`returns a valid template for ${dimensionId}`, () => {
      const result = getExperimentSuggestion(dimensionId);
      expect(result).not.toBeNull();
      expect(result!.dimensionId).toBe(dimensionId);
      expect(result!.title).toBeTruthy();
      expect(typeof result!.title).toBe('string');
    });
  }
});
