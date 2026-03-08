import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime } from '../../../../src/runtime/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.glm.contract';
const SUBJECT_USER_ID = 'user-provider-glm';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

function startFakeGLMServer(): Promise<FakeServer> {
  const imageBytes = Buffer.from('glm-image-bytes', 'utf8');
  const videoBytes = Buffer.from('glm-video-bytes', 'utf8');
  const ttsBytes = Buffer.from('glm-tts-audio', 'utf8');
  const pollCount = new Map<string, number>();

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
      res.end(JSON.stringify({ data: [{ id: 'glm-model' }] }));
      return;
    }

    if (req.method === 'POST' && path === '/api/paas/v4/videos/generations') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'glm-task-1' }));
      return;
    }

    if (req.method === 'GET' && path === '/api/paas/v4/async-result/glm-task-1') {
      const count = (pollCount.get(path) || 0) + 1;
      pollCount.set(path, count);

      if (count < 2) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'running' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        status: 'succeeded',
        artifact: {
          b64_mp4: videoBytes.toString('base64'),
          mime_type: 'video/mp4',
        },
      }));
      return;
    }

    if (req.method === 'POST' && path === '/api/paas/v4/images/generations') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          b64_json: imageBytes.toString('base64'),
          mime_type: 'image/png',
        }],
      }));
      return;
    }

    if (req.method === 'POST' && path === '/api/paas/v4/audio/speech') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        audio_base64: ttsBytes.toString('base64'),
      }));
      return;
    }

    if (req.method === 'POST' && path === '/api/paas/v4/audio/transcriptions') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        text: 'glm stt text',
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
        reject(new Error('fake glm server listen failed'));
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

test('provider_glm_test.ts: glm task/native media via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeGLMServer();

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_GLM_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-glm-contract',
          },
        });

        const provider = createNimiAiProvider({
          runtime,
          appId: APP_ID,
          subjectUserId: SUBJECT_USER_ID,
          routePolicy: 'cloud',
          fallback: 'deny',
          timeoutMs: 30_000,
        });

        const videoResult = await provider.video('glm/cogvideox-3').generate({
          mode: 't2v',
          prompt: 'city flyover',
          content: [
            {
              type: 'text',
              role: 'prompt',
              text: 'city flyover',
            },
          ],
          options: {
            durationSec: 6,
          },
        });
        assert.equal(videoResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(videoResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          'glm-video-bytes',
        );

        const imageResult = await provider.image('glm/cogview-3').doGenerate({
          prompt: 'mountain at dusk',
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          files: undefined,
          mask: undefined,
          providerOptions: {},
        });
        assert.equal(imageResult.images.length, 1);
        assert.equal(imageResult.images[0], Buffer.from('glm-image-bytes', 'utf8').toString('base64'));

        const ttsResult = await provider.tts('glm/tts-1').synthesize({
          text: 'hello glm',
        });
        assert.equal(ttsResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(ttsResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          'glm-tts-audio',
        );

        const sttResult = await provider.stt('glm/asr-1').transcribe({
          audioBytes: Uint8Array.from([1, 2, 3]),
          mimeType: 'audio/wav',
        });
        assert.equal(sttResult.text, 'glm stt text');
      },
    });
  } finally {
    await fakeServer.close();
  }
});
