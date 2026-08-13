import { describe, expect, it } from 'vitest';
import { loadEmbeddedWLipSyncProfile } from './lip-sync-profile.js';

describe('embedded wLipSync profile', () => {
  it('loads the production profile through the renderer module graph', () => {
    const profile = loadEmbeddedWLipSyncProfile();

    expect(profile.targetSampleRate).toBe(16_000);
    expect(profile.sampleCount).toBe(1_024);
    expect(profile.mfccNum).toBe(12);
    expect(profile.mfccs.map((entry) => entry.name)).toEqual([
      'A',
      'I',
      'U',
      'E',
      'O',
      'S',
      'A',
      'I',
      'U',
      'U',
      'E',
      'O',
    ]);
    expect(profile.mfccs.every((entry) => entry.mfccCalibrationDataList.length > 0)).toBe(true);
  });
});
