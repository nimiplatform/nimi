import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime, asNimiError } from '../../../../src/runtime/index.js';
import { ReasonCode } from '../../../../src/types/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.local.contract';
const SUBJECT_USER_ID = 'user-provider-local';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

const FAKE_LOCAL_MODEL_IDS = ['qwen', 'embed', 'tts', 'stt'] as const;

function startFakeLocalEngineServer(): Promise<FakeServer> {
  const audioBytes = Buffer.from('local-audio-bytes', 'utf8');

  const server = http.createServer((req, res) => {
    const path = req.url || '';
    if (req.method === 'GET' && path === '/healthz') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'GET' && path === '/v1/models') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: FAKE_LOCAL_MODEL_IDS.map((id) => ({ id })),
      }));
      return;
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'local text',
          },
        }],
        usage: {
          prompt_tokens: 6,
          completion_tokens: 3,
        },
      }));
      return;
    }
    if (req.method === 'POST' && path === '/v1/embeddings') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          embedding: [0.11, 0.22],
        }],
        usage: {
          prompt_tokens: 3,
          total_tokens: 5,
        },
      }));
      return;
    }
    if (req.method === 'POST' && path === '/v1/audio/speech') {
      res.statusCode = 200;
      res.setHeader('content-type', 'audio/mpeg');
      res.end(audioBytes);
      return;
    }
    if (req.method === 'POST' && path === '/v1/audio/transcriptions') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        text: 'local stt text',
      }));
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  return new Promise((resolvePromise, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fake local engine server listen failed'));
        return;
      }
      resolvePromise({
        url: `http://127.0.0.1:${address.port}`,
        close: async () => {
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          });
        },
      });
    });
    server.on('error', reject);
  });
}

function promptFromText(text: string) {
  return [{
    role: 'user' as const,
    content: [{
      type: 'text' as const,
      text,
    }],
  }];
}

async function installAndStartLocalModel(
  runtime: Runtime,
  input: {
    modelId: string;
    capabilities: string[];
    engine: 'llama' | 'media' | 'speech' | 'sidecar';
    endpoint: string;
  },
): Promise<void> {
  const installed = await runtime.local.installLocalModel({
    modelId: input.modelId,
    capabilities: input.capabilities,
    engine: input.engine,
    endpoint: input.endpoint,
  });
  const localModelId = String(installed.model?.localModelId || '').trim();
  assert.ok(localModelId, `missing localModelId for ${input.modelId}`);
  await runtime.local.startLocalModel({ localModelId });
}

test('provider_local_test.ts: engine-first local modalities + image/video fail-close via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeLocalEngineServer();
  const expectedAudio = Buffer.from('local-audio-bytes', 'utf8');

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL: fakeServer.url,
      },
      run: async ({ endpoint }) => {
        const runtime = new Runtime({
          appId: APP_ID,
          transport: {
            type: 'node-grpc',
            endpoint,
          },
          defaults: {
            callerKind: 'desktop-core',
            callerId: 'sdk-provider-local-contract',
          },
        });

        const provider = createNimiAiProvider({
          runtime,
          appId: APP_ID,
          subjectUserId: SUBJECT_USER_ID,
          routePolicy: 'local',
          fallback: 'deny',
          timeoutMs: 30_000,
        });

        await installAndStartLocalModel(runtime, {
          modelId: 'qwen',
          capabilities: ['text.generate'],
          engine: 'llama',
          endpoint: fakeServer.url,
        });
        await installAndStartLocalModel(runtime, {
          modelId: 'embed',
          capabilities: ['text.embed'],
          engine: 'llama',
          endpoint: fakeServer.url,
        });
        await installAndStartLocalModel(runtime, {
          modelId: 'tts',
          capabilities: ['audio.synthesize'],
          engine: 'speech',
          endpoint: fakeServer.url,
        });
        await installAndStartLocalModel(runtime, {
          modelId: 'stt',
          capabilities: ['audio.transcribe'],
          engine: 'speech',
          endpoint: fakeServer.url,
        });

        const textModel = provider.text('llama/qwen');
        const textResult = await textModel.doGenerate({
          prompt: promptFromText('hello llama'),
          providerOptions: {},
        });
        const generatedText = textResult.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('')
          .trim();
        assert.equal(generatedText, 'local text');

        const embeddingResult = await provider.embedding('llama/embed').doEmbed({
          values: ['embed me'],
          providerOptions: {},
        });
        assert.deepEqual(embeddingResult.embeddings, [[0.11, 0.22]]);

        let imageError: unknown = null;
        try {
          await provider.image('media/image').doGenerate({
            prompt: 'draw mountain',
            n: 1,
            size: undefined,
            aspectRatio: undefined,
            seed: undefined,
            files: undefined,
            mask: undefined,
            providerOptions: {},
          });
        } catch (error) {
          imageError = error;
        }
        assert.ok(imageError, 'media image should fail-close');
        const normalizedImageError = asNimiError(imageError, { source: 'runtime' });
        assert.ok(
          normalizedImageError.reasonCode === ReasonCode.AI_ROUTE_UNSUPPORTED || normalizedImageError.reasonCode === '204',
          `unexpected image reasonCode: ${normalizedImageError.reasonCode}`,
        );

        const speechResult = await provider.tts('speech/tts').synthesize({
          text: 'hello',
        });
        assert.equal(speechResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(speechResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          expectedAudio.toString('utf8'),
        );

        const transcription = await provider.stt('speech/stt').transcribe({
          audioBytes: Uint8Array.from([1, 2, 3]),
          mimeType: 'audio/wav',
        });
        assert.equal(transcription.text, 'local stt text');

        let videoError: unknown = null;
        try {
          await provider.video('media/video').generate({
            mode: 't2v',
            prompt: 'unsupported',
            content: [
              {
                type: 'text',
                role: 'prompt',
                text: 'unsupported',
              },
            ],
            options: {
              durationSec: 5,
            },
          });
        } catch (error) {
          videoError = error;
        }
        assert.ok(videoError, 'media video should fail-close');
        const normalized = asNimiError(videoError, { source: 'runtime' });
        assert.ok(
          normalized.reasonCode === ReasonCode.AI_ROUTE_UNSUPPORTED || normalized.reasonCode === '204',
          `unexpected reasonCode: ${normalized.reasonCode}`,
        );
      },
    });
  } finally {
    await fakeServer.close();
  }
});
