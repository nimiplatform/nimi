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

function startFakeNexaServer(): Promise<FakeServer> {
  const imageBytes = Buffer.from('nexa-image-bytes', 'utf8');
  const audioBytes = Buffer.from('nexa-audio-bytes', 'utf8');
  const imageBase64 = imageBytes.toString('base64');

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
      res.end(JSON.stringify({ data: [{ id: 'qwen' }] }));
      return;
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'nexa text',
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
    if (req.method === 'POST' && path === '/v1/images/generations') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          b64_json: imageBase64,
        }],
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
        text: 'nexa stt text',
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
        reject(new Error('fake nexa server listen failed'));
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

test('provider_local_test.ts: nexa modalities + video fail-close via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeNexaServer();
  const expectedImage = Buffer.from('nexa-image-bytes', 'utf8');
  const expectedAudio = Buffer.from('nexa-audio-bytes', 'utf8');

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_LOCAL_NEXA_BASE_URL: fakeServer.url,
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
          routePolicy: 'local-runtime',
          fallback: 'deny',
          timeoutMs: 30_000,
        });

        const textModel = provider.text('nexa/qwen');
        const textResult = await textModel.doGenerate({
          prompt: promptFromText('hello nexa'),
          providerOptions: {},
        });
        const generatedText = textResult.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('')
          .trim();
        assert.equal(generatedText, 'nexa text');

        const embeddingResult = await provider.embedding('nexa/embed').doEmbed({
          values: ['embed me'],
          providerOptions: {},
        });
        assert.deepEqual(embeddingResult.embeddings, [[0.11, 0.22]]);

        const imageResult = await provider.image('nexa/image').doGenerate({
          prompt: 'draw mountain',
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          files: undefined,
          mask: undefined,
          providerOptions: {},
        });
        assert.equal(imageResult.images.length, 1);
        assert.equal(imageResult.images[0], expectedImage.toString('base64'));

        const speechResult = await provider.tts('nexa/tts').synthesize({
          text: 'hello',
        });
        assert.equal(speechResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(speechResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          expectedAudio.toString('utf8'),
        );

        const transcription = await provider.stt('nexa/stt').transcribe({
          audioBytes: Uint8Array.from([1, 2, 3]),
          mimeType: 'audio/wav',
        });
        assert.equal(transcription.text, 'nexa stt text');

        let videoError: unknown = null;
        try {
          await provider.video('nexa/video').generate({
            prompt: 'unsupported',
          });
        } catch (error) {
          videoError = error;
        }
        assert.ok(videoError, 'nexa video should fail-close');
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
