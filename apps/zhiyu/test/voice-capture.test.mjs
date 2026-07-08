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

test('Zhiyu voice capture derives readiness from Runtime audio.transcribe AI Config binding', async () => {
  const module = await importVoiceCapture();
  const route = routeWithTranscription();
  const readiness = module.projectZhiyuVoiceCaptureReadiness(route);

  assert.equal(readiness.ready, true);
  assert.equal(readiness.state, 'idle');
  assert.equal(readiness.reasonCode, 'runtime-voice-capture-ready');
  assert.deepEqual(module.createZhiyuVoiceCaptureTranscriptionHead({
    route,
    subjectUserId: 'user-1',
  }), {
    appId: 'nimi.zhiyu',
    subjectUserId: 'user-1',
    routePolicy: 'cloud',
    modelId: 'runtime-stt-model',
    connectorId: 'connector-stt',
    targetRef: {
      kind: 'cloud-connector',
      connectorId: 'connector-stt',
      remoteModelCatalogId: 'remote-model:stt',
      providerModelId: 'runtime-stt-model',
      provider: 'openai',
    },
    timeoutMs: 60_000,
  });
});

test('Zhiyu voice capture records bytes, calls Runtime STT, and returns transcript text', async () => {
  const module = await importVoiceCapture();
  const states = [];
  const controller = module.createZhiyuVoiceCaptureController({
    readiness: module.projectZhiyuVoiceCaptureReadiness(routeWithTranscription()),
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

test('Zhiyu voice capture fails closed before recording without Runtime STT binding', async () => {
  const module = await importVoiceCapture();
  let recorderCreated = false;
  const controller = module.createZhiyuVoiceCaptureController({
    readiness: module.projectZhiyuVoiceCaptureReadiness({
      capabilities: {
        'audio.transcribe': {
          state: 'not_configured',
          reasonCode: '',
          binding: null,
        },
      },
    }),
    createRecorder: async () => {
      recorderCreated = true;
      throw new Error('must not record');
    },
    transcribe: async () => {
      throw new Error('must not transcribe');
    },
  });

  const result = await controller.start();
  assert.equal(result.state, 'failed');
  assert.equal(result.reasonCode, 'runtime-voice-capture-route-not-ready');
  assert.equal(recorderCreated, false);
});

test('Zhiyu voice capture surfaces transcription failure without pseudo transcript', async () => {
  const module = await importVoiceCapture();
  const controller = module.createZhiyuVoiceCaptureController({
    readiness: module.projectZhiyuVoiceCaptureReadiness(routeWithTranscription()),
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

function routeWithTranscription() {
  return {
    capabilities: {
      'audio.transcribe': {
        state: 'ready',
        reasonCode: '',
        binding: {
          route: 'cloud',
          modelId: 'runtime-stt-model',
          connectorId: 'connector-stt',
          targetRef: {
            kind: 'cloud-connector',
            connectorId: 'connector-stt',
            remoteModelCatalogId: 'remote-model:stt',
            providerModelId: 'runtime-stt-model',
            provider: 'openai',
          },
        },
      },
    },
  };
}

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
    plugins: [sdkAliasPlugin()],
  });
  return buildDir;
}

function sdkAliasPlugin() {
  return {
    name: 'sdk-alias',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/ai$/ }, () => ({
        path: 'sdk-ai-stub',
        namespace: 'sdk-ai-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'sdk-ai-stub' }, () => ({
        loader: 'js',
        contents: `
          export function toRuntimeDurableTargetRef(input) {
            return input;
          }
        `,
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/features\/generation$/ }, () => ({
        path: 'sdk-generation-stub',
        namespace: 'sdk-generation-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'sdk-generation-stub' }, () => ({
        loader: 'js',
        contents: `
          export async function runNimiRuntimeSpeechTranscription() {
            throw new Error('generation stub should be injected through transcribe dependency in unit tests');
          }
        `,
      }));
      buildApi.onResolve({ filter: /^@nimiplatform\/sdk\/runtime$/ }, () => ({
        path: 'sdk-runtime-stub',
        namespace: 'sdk-runtime-stub',
      }));
      buildApi.onLoad({ filter: /.*/, namespace: 'sdk-runtime-stub' }, () => ({
        loader: 'js',
        contents: `
          export class Runtime {
            constructor() {
              this.ai = {};
            }
          }
        `,
      }));
    },
  };
}
