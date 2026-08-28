import { describe, expect, it } from 'vitest';

import {
  NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS,
  type NimiRuntimeAgentResolvedStatusCueMood,
} from '../src/sdk-contract.js';

describe('kit sdk-contract', () => {
  it('re-exports only the Runtime emotion vocabulary still required by Kit', () => {
    const mood: NimiRuntimeAgentResolvedStatusCueMood = 'neutral';
    expect(mood).toBe('neutral');
    expect(NIMI_RUNTIME_AGENT_RESOLVED_STATUS_CUE_MOODS).toContain('ext:grateful');
  });
});
