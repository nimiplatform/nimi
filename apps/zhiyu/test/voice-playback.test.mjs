import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});

test('Zhiyu voice playback projects admitted Runtime modes and rejects simulated truth', async () => {
  const module = await importVoicePlayback();

  assert.deepEqual(module.projectZhiyuVoicePlayback({
    voiceOutputMode: 'native_stream',
    voicePlaybackState: 'active',
    voiceStreamId: 'voice-stream-1',
  }), {
    state: 'active',
    reasonCode: 'runtime-voice-native-stream-active',
    actionHint: 'subscribe_runtime_voice_stream',
    outputMode: 'native_stream',
    playbackState: 'active',
    audioArtifactId: '',
    audioMimeType: '',
    voiceStreamId: 'voice-stream-1',
    playbackAction: 'subscribe_stream',
    violation: false,
  });

  assert.deepEqual(module.projectZhiyuVoicePlayback({
    voiceOutputMode: 'batch_final_artifact',
    voicePlaybackState: 'completed',
    voiceAudioArtifactId: 'artifact-audio-1',
    voiceAudioMimeType: 'audio/wav',
  }), {
    state: 'completed',
    reasonCode: 'runtime-voice-batch-final-artifact-ready',
    actionHint: 'replay_runtime_voice_artifact',
    outputMode: 'batch_final_artifact',
    playbackState: 'completed',
    audioArtifactId: 'artifact-audio-1',
    audioMimeType: 'audio/wav',
    voiceStreamId: '',
    playbackAction: 'replay_artifact',
    violation: false,
  });

  assert.equal(module.projectZhiyuVoicePlayback({
    voiceOutputMode: 'text_only',
    voicePlaybackState: '',
  }).state, 'text_only');

  const simulated = module.projectZhiyuVoicePlayback({
    voiceOutputMode: 'simulated_stream',
    voicePlaybackState: 'active',
    voiceStreamId: 'simulated-stream-1',
  });
  assert.equal(simulated.state, 'failed');
  assert.equal(simulated.reasonCode, 'runtime-voice-simulated-stream-not-admitted');
  assert.equal(simulated.playbackAction, 'none');
  assert.equal(simulated.violation, true);

  const incomplete = module.projectZhiyuVoicePlayback({
    voiceOutputMode: 'native_stream',
    voicePlaybackState: 'active',
  });
  assert.equal(incomplete.state, 'failed');
  assert.equal(incomplete.reasonCode, 'runtime-voice-native-stream-id-missing');
  assert.equal(incomplete.violation, true);
});

test('Zhiyu voice playback controller uses Runtime bytes and never plays violations', async () => {
  const module = await importVoicePlayback();
  const calls = [];
  const controller = module.createZhiyuVoicePlaybackController({
    subscribeStream: async function* (input) {
      calls.push(['subscribe', input.voiceStreamId]);
      yield { chunk: new Uint8Array([1, 2]), mimeType: 'audio/wav' };
    },
    readArtifactBytes: async (artifactId) => {
      calls.push(['artifact', artifactId]);
      return { bytes: new Uint8Array([3, 4]), mimeType: 'audio/wav' };
    },
    playAudioBytes: async (bytes, mimeType) => {
      calls.push(['play', [...bytes], mimeType]);
    },
  });

  await controller.run({
    voiceOutputMode: 'native_stream',
    voicePlaybackState: 'active',
    voiceStreamId: 'voice-stream-1',
  });
  await controller.run({
    voiceOutputMode: 'batch_final_artifact',
    voicePlaybackState: 'completed',
    voiceAudioArtifactId: 'artifact-audio-1',
    voiceAudioMimeType: 'audio/wav',
  });
  await controller.run({
    voiceOutputMode: 'simulated_stream',
    voicePlaybackState: 'active',
    voiceStreamId: 'voice-stream-simulated',
  });

  assert.deepEqual(calls, [
    ['subscribe', 'voice-stream-1'],
    ['play', [1, 2], 'audio/wav'],
    ['artifact', 'artifact-audio-1'],
    ['play', [3, 4], 'audio/wav'],
  ]);
});

async function importVoicePlayback() {
  const outputPath = path.join(await buildVoicePlayback(), 'voice-playback.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildVoicePlayback() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-voice-playback-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/voice-playback.ts')],
    outfile: path.join(buildDir, 'voice-playback.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  });
  return buildDir;
}
