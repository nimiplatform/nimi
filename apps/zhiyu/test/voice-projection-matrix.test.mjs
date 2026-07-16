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

test('E-08 voice truth missing or incomplete fails closed without pseudo playback', async () => {
  const module = await importVoicePlayback();
  const cases = [
    {
      name: 'native stream id missing',
      input: {
        voiceOutputMode: 'native_stream',
        voicePlaybackState: 'active',
      },
      reasonCode: 'runtime-voice-native-stream-id-missing',
    },
    {
      name: 'native stream playback state missing',
      input: {
        voiceOutputMode: 'native_stream',
        voiceStreamId: 'voice-stream-1',
      },
      reasonCode: 'runtime-voice-playback-state-missing',
    },
    {
      name: 'final artifact id missing',
      input: {
        voiceOutputMode: 'batch_final_artifact',
        voicePlaybackState: 'completed',
        voiceAudioMimeType: 'audio/wav',
      },
      reasonCode: 'runtime-voice-final-artifact-id-missing',
    },
    {
      name: 'final artifact MIME invalid',
      input: {
        voiceOutputMode: 'batch_final_artifact',
        voicePlaybackState: 'completed',
        voiceAudioArtifactId: 'artifact-audio-1',
        voiceAudioMimeType: 'application/json',
      },
      reasonCode: 'runtime-voice-final-artifact-mime-invalid',
    },
    {
      name: 'output mode invalid',
      input: {
        voiceOutputMode: 'unknown_mode',
        voicePlaybackState: 'active',
      },
      reasonCode: 'runtime-voice-output-mode-invalid',
    },
  ];

  for (const item of cases) {
    const projection = module.projectZhiyuVoicePlayback(item.input);
    assert.equal(projection.state, 'failed', `E-08 ${item.name} failed state`);
    assert.equal(projection.reasonCode, item.reasonCode, `E-08 ${item.name} reason`);
    assert.equal(projection.playbackAction, 'none', `E-08 ${item.name} no playback action`);
    assert.equal(projection.violation, true, `E-08 ${item.name} violation`);

    const calls = [];
    const controller = controllerWithCalls(module, calls);
    const controlled = await controller.run(item.input);
    assert.equal(controlled.reasonCode, item.reasonCode, `E-08 ${item.name} controller reason`);
    assert.deepEqual(calls, [], `E-08 ${item.name} controller side effects`);
  }
});

test('E-09 simulated_stream fails closed and is never played', async () => {
  const module = await importVoicePlayback();
  const input = {
    voiceOutputMode: 'simulated_stream',
    voicePlaybackState: 'active',
    voiceStreamId: 'simulated-stream-1',
  };
  const projection = module.projectZhiyuVoicePlayback(input);

  assert.equal(projection.state, 'failed', 'E-09 simulated stream failed state');
  assert.equal(projection.reasonCode, 'runtime-voice-simulated-stream-not-admitted', 'E-09 simulated stream reason');
  assert.equal(projection.playbackAction, 'none', 'E-09 simulated stream no playback action');
  assert.equal(projection.violation, true, 'E-09 simulated stream violation flag');

  const calls = [];
  const controller = controllerWithCalls(module, calls);
  const controlled = await controller.run(input);
  assert.equal(controlled.reasonCode, 'runtime-voice-simulated-stream-not-admitted', 'E-09 controller reason');
  assert.deepEqual(calls, [], 'E-09 controller does not subscribe, read, or play simulated truth');
});

function controllerWithCalls(module, calls) {
  return module.createZhiyuVoicePlaybackController({
    subscribeStream: async (input) => {
      calls.push(['subscribe', input.voiceStreamId]);
      throw new Error('unexpected subscription');
    },
    readArtifactBytes: async (artifactId) => {
      calls.push(['artifact', artifactId]);
      return { bytes: new Uint8Array([3, 4]), mimeType: 'audio/wav' };
    },
    playAudioBytes: async (bytes, mimeType, audioSourceId) => {
      calls.push(['play', [...bytes], mimeType, audioSourceId]);
    },
  });
}

async function importVoicePlayback() {
  const outputPath = path.join(await buildVoicePlayback(), 'voice-playback.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildVoicePlayback() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-voice-projection-matrix-'));
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
