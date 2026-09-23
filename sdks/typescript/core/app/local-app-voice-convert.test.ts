import assert from 'node:assert/strict';
import test from 'node:test';
import { localVoiceConvertSpec, runtimeVoiceConvertSpec, localVoiceConversion, runtimeVoiceConversion,
  validateNimiLocalAppVoiceConvertSpec, validateNimiLocalAppVoiceConversion } from './local-app-voice-convert.js';
import { validateNimiLocalAppAudioSeparation } from './local-app-audio-separation.js';
import { projectMusicInputCapabilities } from '../ai/music-input.js';

test('voice conversion keeps source vocal and target voice as distinct bounded inputs', () => {
  const spec = validateNimiLocalAppVoiceConvertSpec({ type: 'audio-voice-convert', sourceVocal: { artifactId: 'source-1', range: { startFrame: 960000, endFrame: 10158504 } },
    sourceKind: 'singing', targetVoice: { kind: 'reference-audio', artifactId: 'target-1' }, semitoneShift: 3 });
  assert.deepEqual(localVoiceConvertSpec(runtimeVoiceConvertSpec(spec)), spec);
  assert.deepEqual(localVoiceConvertSpec(runtimeVoiceConvertSpec(validateNimiLocalAppVoiceConvertSpec({ type: 'audio-voice-convert', sourceVocal: { artifactId: 'source-1' },
    sourceKind: 'singing', targetVoice: { kind: 'preset', presetVoiceId: 'preset-1' } }))).targetVoice, { kind: 'preset', presetVoiceId: 'preset-1' });
  for (const change of [{ model: 'vevo2' }, { semitoneShift: 13 }, { semitoneShift: -13 }, { sourceKind: 'rapping' },
    { targetVoice: { kind: 'reference-audio', artifactId: 'source-1' } }, { targetVoice: { kind: 'preset' } },
    { sourceVocal: { artifactId: 'source-1', range: { startFrame: 2, endFrame: 1 } } }]) {
    assert.throws(() => validateNimiLocalAppVoiceConvertSpec({ ...spec, ...change }));
  }
});

test('converted vocals report their real tail delta instead of claiming exact alignment', () => {
  const artifacts = [{ artifactId: 'vocal-1', mimeType: 'audio/wav', sizeBytes: 963400, sampleRateHz: 24000, channels: 1, frameCount: 240828, durationMs: 10034 }];
  const result = validateNimiLocalAppVoiceConversion({ vocalArtifactId: 'vocal-1', sourceArtifactId: 'source-1',
    sourceInfo: { sampleRateHz: 48000, channels: 2, frameCount: 480000, durationMs: 10000 },
    inputRange: { startFrame: 0, endFrame: 480000 },
    vocalInfo: { sampleRateHz: 24000, channels: 1, frameCount: 240828, durationMs: 10034 },
    lengthRelation: 'MODEL_FRAME_ROUNDING', durationDeltaMs: 34 }, artifacts);
  assert.deepEqual(localVoiceConversion(runtimeVoiceConversion(result)!), result);
  assert.throws(() => validateNimiLocalAppVoiceConversion(result, []));
  assert.throws(() => validateNimiLocalAppVoiceConversion({ ...result, lengthRelation: 'EXACT' }, artifacts));
  assert.throws(() => validateNimiLocalAppVoiceConversion({ ...result, durationDeltaMs: 35 }, artifacts));
  assert.throws(() => validateNimiLocalAppVoiceConversion({ ...result, vocalArtifactId: 'source-1' }, artifacts));
  assert.throws(() => validateNimiLocalAppVoiceConversion({ ...result, inputRange: { startFrame: 0, endFrame: 480001 } }, artifacts));
  assert.throws(() => validateNimiLocalAppVoiceConversion({ ...result, confidence: 0.9 }, artifacts));
  const exact = validateNimiLocalAppVoiceConversion({ ...result, vocalInfo: { sampleRateHz: 24000, channels: 1, frameCount: 240000, durationMs: 10000 },
    lengthRelation: 'EXACT', durationDeltaMs: 0 }, [{ ...artifacts[0], sizeBytes: 960044, frameCount: 240000, durationMs: 10000 }]);
  assert.equal(exact.durationDeltaMs, 0);
  // Full 191.635 s song: the delta is 191670 - 191635 published milliseconds.
  const full = { ...result, sourceInfo: { sampleRateHz: 44100, channels: 2, frameCount: 8451125, durationMs: 191635 },
    inputRange: { startFrame: 0, endFrame: 8451125 }, vocalInfo: { sampleRateHz: 24000, channels: 1, frameCount: 4600080, durationMs: 191670 }, durationDeltaMs: 35 };
  const fullArtifacts = [{ ...artifacts[0], sizeBytes: 18400378, frameCount: 4600080, durationMs: 191670 }];
  assert.equal(validateNimiLocalAppVoiceConversion(full, fullArtifacts).durationDeltaMs, 35);
  assert.throws(() => validateNimiLocalAppVoiceConversion({ ...full, durationDeltaMs: 34 }, fullArtifacts));
});

test('instrument parts are committed stems, never a substituted mixture', () => {
  const artifacts = [{ artifactId: 'vocals-1', mimeType: 'audio/wav', sizeBytes: 384044, sampleRateHz: 48000, channels: 2, durationMs: 1000 },
    { artifactId: 'background-1', mimeType: 'audio/wav', sizeBytes: 384044, sampleRateHz: 48000, channels: 2, durationMs: 1000 },
    { artifactId: 'drums-1', mimeType: 'audio/wav', sizeBytes: 384044, sampleRateHz: 48000, channels: 2, durationMs: 1000 }];
  const separation = validateNimiLocalAppAudioSeparation({ vocalsArtifactId: 'vocals-1', backgroundArtifactId: 'background-1',
    instrumentParts: [{ kind: 'DRUMS', artifactId: 'drums-1' }] }, artifacts);
  assert.deepEqual(separation.instrumentParts, [{ kind: 'DRUMS', artifactId: 'drums-1' }]);
  assert.throws(() => validateNimiLocalAppAudioSeparation({ vocalsArtifactId: 'vocals-1', backgroundArtifactId: 'background-1',
    instrumentParts: [{ kind: 'DRUMS', artifactId: 'vocals-1' }] }, artifacts.slice(0, 2)));
  assert.throws(() => validateNimiLocalAppAudioSeparation({ vocalsArtifactId: 'vocals-1', backgroundArtifactId: 'background-1',
    instrumentParts: [{ kind: 'DRUMS', artifactId: 'drums-1' }, { kind: 'DRUMS', artifactId: 'bass-1' }] }, artifacts));
  assert.throws(() => validateNimiLocalAppAudioSeparation({ vocalsArtifactId: 'vocals-1', backgroundArtifactId: 'background-1' }, artifacts));
});

test('voice convert profiles declare kinds and shift bounds without inventing a generation profile', () => {
  const profile = { sourceKinds: ['singing'], targetKinds: ['reference-audio', 'preset', 'voice-asset'], maxSourceSeconds: 600, maxTargetSeconds: 60,
    supportsRange: true, supportsSemitoneShift: true, minSemitoneShift: -12, maxSemitoneShift: 12, maxSourceBytes: 536870912, maxTargetBytes: 33554432 };
  const result = projectMusicInputCapabilities({ generation: [], voiceConvert: [profile] });
  assert.equal(result.generation.length, 0);
  assert.deepEqual(result.voiceConvert?.[0]?.targetKinds, ['reference-audio', 'preset', 'voice-asset']);
  assert.throws(() => projectMusicInputCapabilities({ generation: [], voiceConvert: [] }));
  assert.throws(() => projectMusicInputCapabilities({ generation: [], voiceConvert: [{ ...profile, minSemitoneShift: -13 }] }));
  assert.throws(() => projectMusicInputCapabilities({ generation: [], voiceConvert: [{ ...profile, maxSourceBytes: 536870913 }] }));
  assert.throws(() => projectMusicInputCapabilities({ generation: [], voiceConvert: [{ ...profile, targetKinds: ['clone'] }] }));
});
