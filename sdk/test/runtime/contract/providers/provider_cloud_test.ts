import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime } from '../../../../src/runtime/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.cloud.contract';
const SUBJECT_USER_ID = 'user-provider-cloud';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

function startFakeLiteLLMServer(): Promise<FakeServer> {
  const imageBytes = Buffer.from('litellm-image-bytes', 'utf8');
  const videoBytes = Buffer.from('litellm-video-bytes', 'utf8');
  const audioBytes = Buffer.from('litellm-audio-bytes', 'utf8');

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
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'litellm text',
          },
        }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
        },
      }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/embeddings') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          embedding: [0.1, 0.2],
        }],
        usage: {
          prompt_tokens: 4,
          total_tokens: 6,
        },
      }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/images/generations') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          b64_json: imageBytes.toString('base64'),
        }],
      }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/video/generations') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    if (req.method === 'POST' && path === '/v1/videos/generations') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          b64_mp4: videoBytes.toString('base64'),
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
        text: 'litellm stt text',
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
        reject(new Error('fake litellm server listen failed'));
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

test('provider_cloud_test.ts: litellm modalities via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeLiteLLMServer();
  const expectedImage = Buffer.from('litellm-image-bytes', 'utf8');
  const expectedVideo = Buffer.from('litellm-video-bytes', 'utf8');
  const expectedAudio = Buffer.from('litellm-audio-bytes', 'utf8');

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-cloud-contract',
          },
        });

        const provider = createNimiAiProvider({
          runtime,
          appId: APP_ID,
          subjectUserId: SUBJECT_USER_ID,
          routePolicy: 'token-api',
          fallback: 'deny',
          timeoutMs: 30_000,
        });

        const textResult = await provider.text('litellm/gpt-4o-mini').doGenerate({
          prompt: promptFromText('hello litellm'),
          providerOptions: {},
        });
        const generatedText = textResult.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('')
          .trim();
        assert.equal(generatedText, 'litellm text');

        const embeddingResult = await provider.embedding('litellm/text-embedding-3').doEmbed({
          values: ['embed me'],
          providerOptions: {},
        });
        assert.deepEqual(embeddingResult.embeddings, [[0.1, 0.2]]);

        const imageResult = await provider.image('litellm/image-1').doGenerate({
          prompt: 'skyline',
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

        const videoResult = await provider.video('litellm/video-1').generate({
          prompt: 'ocean',
        });
        assert.equal(videoResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(videoResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          expectedVideo.toString('utf8'),
        );

        const speechResult = await provider.tts('litellm/tts-1').synthesize({
          text: 'speak',
        });
        assert.equal(speechResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(speechResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          expectedAudio.toString('utf8'),
        );

        const transcription = await provider.stt('litellm/stt-1').transcribe({
          audioBytes: Uint8Array.from([1, 2, 3]),
          mimeType: 'audio/wav',
        });
        assert.equal(transcription.text, 'litellm stt text');
      },
    });
  } finally {
    await fakeServer.close();
  }
});
