import assert from 'node:assert/strict';
import test from 'node:test';

import { MusicInputCapabilities } from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import { projectMusicInputCapabilities } from './music-input.js';
import { projectRuntimeMusicInput } from './music-input-wire.js';

function decoded(value: Parameters<typeof MusicInputCapabilities.create>[0]) {
  return MusicInputCapabilities.fromBinary(MusicInputCapabilities.toBinary(MusicInputCapabilities.create(value)));
}

const generation = {
  lyricsMode: 'required', scoreMode: 'unsupported', supportsSeed: true,
  maxDurationSeconds: 180, defaultDurationSeconds: 20, maxPromptBytes: 32768, maxLyricsBytes: 32768,
};
const transcription = {
  formats: ['abc', 'timeline'], parts: ['lead-sheet'], maxDurationSeconds: 600, maxSourceBytes: 512 << 20, supportsRange: true,
};
const voiceConvert = {
  sourceKinds: ['singing'], targetKinds: ['reference-audio'], maxSourceSeconds: 600, maxTargetSeconds: 600,
  supportsRange: true, supportsSemitoneShift: true, minSemitoneShift: -12, maxSemitoneShift: 12,
  maxSourceBytes: 512 << 20, maxTargetBytes: 512 << 20,
};

test('decoded Runtime music input projects for each music capability', () => {
  // The shared validator refuses the decoded message itself: its rows carry
  // the protobuf runtime's prototype rather than a plain object's.
  assert.throws(() => projectMusicInputCapabilities(decoded({ generation: [generation] })), /Music input capabilities are invalid/u);

  assert.equal(projectRuntimeMusicInput(decoded({ generation: [generation] })).generation[0]?.maxDurationSeconds, 180);
  const transcribed = projectRuntimeMusicInput(decoded({ transcription: [transcription] }));
  assert.deepEqual(transcribed.generation, []);
  assert.deepEqual(transcribed.transcription?.[0]?.formats, ['abc', 'timeline']);
  assert.equal(projectRuntimeMusicInput(decoded({ voiceConvert: [voiceConvert] })).voiceConvert?.[0]?.minSemitoneShift, -12);
});

test('decoded Runtime music input still fails closed outside its bounds', () => {
  assert.throws(() => projectRuntimeMusicInput(decoded({ generation: [{ ...generation, maxDurationSeconds: 601 }] })), /Music input capabilities are invalid/u);
  assert.throws(() => projectRuntimeMusicInput(decoded({ transcription: [{ ...transcription, parts: [] }] })), /Music input capabilities are invalid/u);
  assert.throws(() => projectRuntimeMusicInput(decoded({})), /Music input capabilities are invalid/u);
});
