import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readTesterPanel(relativePath: string): string {
  return fs.readFileSync(
    path.join(
      import.meta.dirname,
      '..',
      'src',
      'shell',
      'renderer',
      'features',
      'tester',
      'panels',
      relativePath,
    ),
    'utf8',
  );
}

test('tester speech panel contract: voice workflow panels call real runtime helpers', () => {
  const voicePanelSource = readTesterPanel('panel-voice-stubs.tsx');

  assert.match(voicePanelSource, /runTesterVoiceClone\(/);
  assert.match(voicePanelSource, /runTesterVoiceDesign\(/);
  assert.doesNotMatch(voicePanelSource, /sdkMethodUnavailable/);
});

test('tester speech panel contract: stt and voice clone panels retain file input path', () => {
  const transcribePanelSource = readTesterPanel('panel-audio-transcribe.tsx');
  const voicePanelSource = readTesterPanel('panel-voice-stubs.tsx');

  assert.match(transcribePanelSource, /type="file"/);
  assert.match(voicePanelSource, /type="file"/);
});

test('tester speech panel contract: tts panel uses persisted synthesize params', () => {
  const synthesizePanelSource = readTesterPanel('panel-audio-synthesize.tsx');

  assert.match(synthesizePanelSource, /params:\s*AudioSynthesizeParamsState/);
  assert.match(synthesizePanelSource, /onParamsChange/);
  assert.match(synthesizePanelSource, /params\.voiceId/);
  assert.match(synthesizePanelSource, /params\.responseFormat/);
  assert.match(synthesizePanelSource, /params\.speakingRate/);
  assert.match(synthesizePanelSource, /params\.volume/);
  assert.match(synthesizePanelSource, /params\.pitchSemitones/);
  assert.match(synthesizePanelSource, /params\.languageHint/);
  assert.match(synthesizePanelSource, /params\.timeoutMs/);
  assert.match(synthesizePanelSource, /lastAutoVoiceBindingRef/);
  assert.match(synthesizePanelSource, /updateParams\(\{\s*voiceId:\s*fallbackVoiceId\s*\}\)/);
});
