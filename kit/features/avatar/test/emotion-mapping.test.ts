import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createActivityMappingResolver,
  mapRuntimeAgentEmotionToAvatarCue,
  parseRuntimeAgentEmotionId,
  parseRuntimeAgentEmotionIntensity,
  RUNTIME_AGENT_EMOTION_IDS,
  type RuntimeAgentEmotionId,
} from '../src/headless.js';

const EXPECTED_CUES: Readonly<Record<RuntimeAgentEmotionId, ReturnType<typeof mapRuntimeAgentEmotionToAvatarCue>>> = {
  happy: 'joy',
  sad: 'concerned',
  shy: 'calm',
  angry: 'concerned',
  surprised: 'surprised',
  confused: 'focus',
  excited: 'playful',
  worried: 'concerned',
  embarrassed: 'calm',
  neutral: 'neutral',
  'ext:apologetic': 'concerned',
  'ext:proud': 'joy',
  'ext:lonely': 'concerned',
  'ext:grateful': 'joy',
};

describe('runtime agent emotion mapping', () => {
  it('maps every admitted Runtime Agent emotion id to an Avatar emotion cue', () => {
    expect(RUNTIME_AGENT_EMOTION_IDS).toHaveLength(14);
    expect(Object.keys(EXPECTED_CUES).sort()).toEqual([...RUNTIME_AGENT_EMOTION_IDS].sort());

    for (const id of RUNTIME_AGENT_EMOTION_IDS) {
      expect(parseRuntimeAgentEmotionId(id)).toBe(id);
      expect(mapRuntimeAgentEmotionToAvatarCue(id)).toBe(EXPECTED_CUES[id]);
      expect(mapRuntimeAgentEmotionToAvatarCue(id, 'strong')).toBe(EXPECTED_CUES[id]);
    }
  });

  it('fails closed for unknown emotion ids and intensities', () => {
    expect(() => parseRuntimeAgentEmotionId('focused')).toThrow(/not admitted/u);
    expect(() => parseRuntimeAgentEmotionId('custom-mood')).toThrow(/not admitted/u);
    expect(parseRuntimeAgentEmotionIntensity('weak')).toBe('weak');
    expect(parseRuntimeAgentEmotionIntensity('')).toBeNull();
    expect(() => parseRuntimeAgentEmotionIntensity('extreme')).toThrow(/not admitted/u);
  });

});
