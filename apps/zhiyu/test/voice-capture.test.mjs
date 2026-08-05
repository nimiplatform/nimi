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

test('Zhiyu voice transcription fails closed while the local-app capability is not admitted', async () => {
  const module = await importVoiceCapture();
  const transcribe = module.createElectronVoiceCaptureTranscriber({
    agentId: 'agent-a',
    ownerUserId: 'user-a',
  });
  await assert.rejects(
    transcribe({
      bytes: Uint8Array.from([1, 2, 3]),
      mimeType: 'audio/webm',
      requestId: 'voice-capture-test-request',
    }),
    (error) => error?.reasonCode === 'zhiyu-voice-transcription-capability-not-admitted',
  );
  assert.throws(
    () => module.createElectronVoiceCaptureTranscriber({ agentId: '  ', ownerUserId: 'user-a' }),
    (error) => error?.reasonCode === 'runtime-voice-capture-agent-required',
  );
  assert.throws(
    () => module.createElectronVoiceCaptureTranscriber({ agentId: 'agent-a', ownerUserId: '  ' }),
    (error) => error?.reasonCode === 'runtime-voice-capture-owner-required',
  );
});

test('Zhiyu voice capture records bytes, calls Runtime STT, and returns transcript text', async () => {
  const module = await importVoiceCapture();
  const states = [];
  const controller = module.createZhiyuVoiceCaptureController({
    createRecorder: async () => ({
      mimeType: 'audio/webm',
      async start() {
        states.push('recorder-started');
      },
      async stop() {
        states.push('recorder-stopped');
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/webm',
        };
      },
    }),
    transcribe: async (input) => {
      states.push(`transcribe:${input.mimeType}:${input.bytes.byteLength}`);
      return { text: '你好，织羽' };
    },
    onStateChange: (state) => states.push(state.state),
    createRequestId: () => 'voice-capture-test-request',
  });

  assert.equal((await controller.start()).state, 'recording');
  const result = await controller.stop();

  assert.equal(result.state, 'idle');
  assert.equal(result.transcriptText, '你好，织羽');
  assert.deepEqual(states, [
    'recording',
    'recorder-started',
    'transcribing',
    'recorder-stopped',
    'transcribe:audio/webm:3',
    'idle',
  ]);
});

test('Zhiyu voice capture fails closed when microphone recording cannot start', async () => {
  const module = await importVoiceCapture();
  let recorderCreated = false;
  const controller = module.createZhiyuVoiceCaptureController({
    createRecorder: async () => {
      recorderCreated = true;
      throw new Error('microphone unavailable');
    },
    transcribe: async () => {
      throw new Error('must not transcribe');
    },
  });

  const result = await controller.start();
  assert.equal(result.state, 'failed');
  assert.equal(result.reasonCode, 'runtime-voice-capture-recording-failed');
  assert.equal(recorderCreated, true);
});

test('Zhiyu voice capture surfaces transcription failure without pseudo transcript', async () => {
  const module = await importVoiceCapture();
  const controller = module.createZhiyuVoiceCaptureController({
    createRecorder: async () => ({
      mimeType: 'audio/webm',
      async start() {},
      async stop() {
        return { bytes: new Uint8Array([1]), mimeType: 'audio/webm' };
      },
    }),
    transcribe: async () => {
      throw Object.assign(new Error('scenario failed'), {
        reasonCode: 'RUNTIME_SCENARIO_FAILED',
        actionHint: 'retry_voice_capture',
        source: 'runtime',
      });
    },
  });

  await controller.start();
  const result = await controller.stop();
  assert.equal(result.state, 'failed');
  assert.equal(result.reasonCode, 'RUNTIME_SCENARIO_FAILED');
  assert.equal(result.transcriptText, '');
});

async function importVoiceCapture() {
  const outputPath = path.join(await buildVoiceCapture(), 'voice-capture.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildVoiceCapture() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-voice-capture-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/voice-capture.ts')],
    outfile: path.join(buildDir, 'voice-capture.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    plugins: [localAppCapabilityStubPlugin()],
  });
  return buildDir;
}

function localAppCapabilityStubPlugin() {
  return {
    name: 'local-app-capability-stub',
    setup(buildApi) {
      buildApi.onResolve({ filter: /auth\/runtime-platform$/ }, () => ({
        path: 'runtime-platform-stub',
        namespace: 'runtime-platform-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'runtime-platform-stub' }, () => ({
        loader: 'js',
        contents: `
          export function requireZhiyuLocalAppCapability(capability) {
            throw Object.assign(new Error('Zhiyu local-app capability is not admitted.'), {
              reasonCode: \`zhiyu-\${capability}-capability-not-admitted\`,
              actionHint: \`admit_zhiyu_\${capability.replaceAll('-', '_')}_capability\`,
              source: 'sdk',
              retryable: false,
            });
          }
        `,
      }));
    },
  };
}
