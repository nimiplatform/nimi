import { describe, expect, it } from 'vitest';
import {
  resolveInitialMarbleQuality,
  resolveMarbleDefaultQualityFromAuthority,
} from './marble-model-authority.js';

describe('marble-model-authority', () => {
  it('derives Realm Drift default quality from external-api-surface authority', () => {
    expect(resolveMarbleDefaultQualityFromAuthority()).toBe('mini');
  });

  it('allows explicit non-secret quality override', () => {
    expect(resolveInitialMarbleQuality({ VITE_MARBLE_QUALITY: 'standard' })).toBe('standard');
    expect(resolveInitialMarbleQuality({ VITE_MARBLE_QUALITY: 'mini' })).toBe('mini');
  });

  it('rejects missing or ambiguous authority defaults', () => {
    expect(() => resolveMarbleDefaultQualityFromAuthority('models: []')).toThrow(
      'MARBLE_DEFAULT_MODEL_AUTHORITY_INVALID',
    );
    expect(() => resolveMarbleDefaultQualityFromAuthority(`
models:
  - quality: draft
    realm-drift-default: true
  - quality: standard
    realm-drift-default: true
`)).toThrow('MARBLE_DEFAULT_MODEL_AUTHORITY_INVALID');
  });
});
