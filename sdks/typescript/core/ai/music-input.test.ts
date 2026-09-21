import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMusicInputCapabilities } from './music-input.js';

test('input projection distinguishes complete legal combinations and rejects contradictory claims', () => {
  const profile = { lyricsMode: 'required', scoreMode: 'unsupported', scoreFormats: [], scoreConditioning: [],
    supportsInstrumental: false, supportsSeed: true, supportsGeneratedScore: true, supportsAudioReference: false,
    maxDurationSeconds: 600, defaultDurationSeconds: 20, maxPromptBytes: 32768, maxLyricsBytes: 32768, maxScoreBytes: 0, maxAudioReferenceBytes: 0 };
  const capabilities = { generation: [profile, { ...profile, scoreMode: 'required', scoreFormats: ['abc'], scoreConditioning: ['melody-only'], maxScoreBytes: 1048576, supportsGeneratedScore: false }] };
  assert.deepEqual(projectMusicInputCapabilities(capabilities), capabilities);
  for (const invalid of [
    { ...profile, scoreFormats: ['abc'] }, { ...profile, supportsAudioReference: true },
    { ...profile, supportsInstrumental: true }, { ...profile, maxDurationSeconds: 601 },
    { ...profile, defaultDurationSeconds: 601 }, { ...profile, scoreMode: 'any' },
    { ...profile, provider: 'private' },
  ]) assert.throws(() => projectMusicInputCapabilities({ generation: [invalid] }));
  assert.throws(() => projectMusicInputCapabilities({ generation: [] }));
});
