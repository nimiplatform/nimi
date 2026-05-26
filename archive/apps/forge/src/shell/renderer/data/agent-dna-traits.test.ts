import { describe, it, expect } from 'vitest';
import {
  DNA_PRIMARY_TYPES,
  DNA_SECONDARY_TRAITS,
  normalizeDnaPrimaryTrait,
  normalizeDnaSecondaryTraits,
} from '@world-engine/services/agent-dna-traits.js';

describe('DNA trait constants', () => {
  it('has 6 primary types', () => {
    expect(DNA_PRIMARY_TYPES).toHaveLength(6);
    expect(DNA_PRIMARY_TYPES).toContain('CARING');
    expect(DNA_PRIMARY_TYPES).toContain('MYSTERIOUS');
  });

  it('has 12 secondary traits', () => {
    expect(DNA_SECONDARY_TRAITS).toHaveLength(12);
    expect(DNA_SECONDARY_TRAITS).toContain('HUMOROUS');
    expect(DNA_SECONDARY_TRAITS).toContain('ECCENTRIC');
  });
});

describe('normalizeDnaPrimaryTrait', () => {
  it('returns exact match (uppercase)', () => {
    expect(normalizeDnaPrimaryTrait('CARING')).toBe('CARING');
    expect(normalizeDnaPrimaryTrait('PLAYFUL')).toBe('PLAYFUL');
  });

  it('normalizes case-insensitive', () => {
    expect(normalizeDnaPrimaryTrait('caring')).toBe('CARING');
    expect(normalizeDnaPrimaryTrait('Confident')).toBe('CONFIDENT');
  });

  it('resolves aliases in English', () => {
    expect(normalizeDnaPrimaryTrait('kind')).toBe('CARING');
    expect(normalizeDnaPrimaryTrait('logical')).toBe('INTELLECTUAL');
    expect(normalizeDnaPrimaryTrait('brave')).toBe('CONFIDENT');
    expect(normalizeDnaPrimaryTrait('enigmatic')).toBe('MYSTERIOUS');
    expect(normalizeDnaPrimaryTrait('affectionate')).toBe('ROMANTIC');
  });

  it('resolves aliases in Chinese', () => {
    expect(normalizeDnaPrimaryTrait('温柔')).toBe('CARING');
    expect(normalizeDnaPrimaryTrait('活泼')).toBe('PLAYFUL');
    expect(normalizeDnaPrimaryTrait('自信')).toBe('CONFIDENT');
    expect(normalizeDnaPrimaryTrait('神秘')).toBe('MYSTERIOUS');
    expect(normalizeDnaPrimaryTrait('浪漫')).toBe('ROMANTIC');
  });

  it('returns null for empty/invalid input', () => {
    expect(normalizeDnaPrimaryTrait('')).toBeNull();
    expect(normalizeDnaPrimaryTrait(null)).toBeNull();
    expect(normalizeDnaPrimaryTrait(undefined)).toBeNull();
    expect(normalizeDnaPrimaryTrait('UNKNOWN_TYPE')).toBeNull();
  });
});

describe('normalizeDnaSecondaryTraits', () => {
  it('returns exact matches', () => {
    expect(normalizeDnaSecondaryTraits('HUMOROUS')).toEqual(['HUMOROUS']);
    expect(normalizeDnaSecondaryTraits(['WISE', 'DIRECT'])).toEqual(['WISE', 'DIRECT']);
  });

  it('normalizes from aliases', () => {
    expect(normalizeDnaSecondaryTraits('sarcastic')).toEqual(['SARCASTIC']);
    expect(normalizeDnaSecondaryTraits('乐观')).toEqual(['OPTIMISTIC']);
  });

  it('splits comma-separated values', () => {
    expect(normalizeDnaSecondaryTraits('WISE,DIRECT,GENTLE')).toEqual(['WISE', 'DIRECT', 'GENTLE']);
  });

  it('limits to 3 by default', () => {
    const result = normalizeDnaSecondaryTraits('HUMOROUS,SARCASTIC,GENTLE,DIRECT');
    expect(result).toHaveLength(3);
  });

  it('respects custom limit', () => {
    const result = normalizeDnaSecondaryTraits('HUMOROUS,SARCASTIC,GENTLE,DIRECT', 2);
    expect(result).toHaveLength(2);
  });

  it('deduplicates', () => {
    const result = normalizeDnaSecondaryTraits(['WISE', 'WISE', 'WISE']);
    expect(result).toEqual(['WISE']);
  });

  it('returns empty for invalid input', () => {
    expect(normalizeDnaSecondaryTraits('')).toEqual([]);
    expect(normalizeDnaSecondaryTraits(null)).toEqual([]);
  });
});
