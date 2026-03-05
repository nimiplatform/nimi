import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime } from '../../../../src/runtime/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.gemini.contract';
const SUBJECT_USER_ID = 'user-provider-gemini';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

function startFakeGeminiServer(): Promise<FakeServer> {
  const imageBytes = Buffer.from('gemini-image-bytes', 'utf8');
  const videoBytes = Buffer.from('gemini-video-bytes', 'utf8');
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
      res.end(JSON.stringify({
        data: [{ id: 'gemini-model' }],
      }));
      return;
    }

    if (req.method === 'POST' && path === '/operations') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.from(chunk));
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let payload: { modal?: string } = {};
        try {
          payload = JSON.parse(raw) as { modal?: string };
        } catch {
          payload = {};
        }

        if (String(payload.modal || '').toLowerCase() === 'modal_image') {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ name: 'op-image-1' }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ name: 'op-video-1' }));
      });
      return;
    }

    if (req.method === 'GET' && path === '/operations/op-image-1') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        done: true,
        status: 'succeeded',
        artifact: {
          b64_json: imageBytes.toString('base64'),
          mime_type: 'image/png',
        },
      }));
      return;
    }

    if (req.method === 'GET' && path === '/operations/op-video-1') {
      const count = (pollCount.get(path) || 0) + 1;
      pollCount.set(path, count);

      if (count < 2) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          done: false,
          status: 'running',
        }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        done: true,
        status: 'succeeded',
        artifact: {
          b64_mp4: videoBytes.toString('base64'),
          mime_type: 'video/mp4',
        },
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
        reject(new Error('fake gemini server listen failed'));
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

test('provider_gemini_test.ts: gemini operation image/video via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeGeminiServer();

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-gemini-contract',
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

        const imageResult = await provider.image('gemini/imagen-3').doGenerate({
          prompt: 'mountain',
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          files: undefined,
          mask: undefined,
          providerOptions: {},
        });
        assert.equal(imageResult.images.length, 1);
        assert.equal(imageResult.images[0], Buffer.from('gemini-image-bytes', 'utf8').toString('base64'));

        const videoResult = await provider.video('gemini/veo-3').generate({
          mode: 't2v',
          prompt: 'city at dawn',
          content: [
            {
              type: 'text',
              role: 'prompt',
              text: 'city at dawn',
            },
          ],
          options: {
            durationSec: 8,
            fps: 24,
          },
        });
        assert.equal(videoResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(videoResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          'gemini-video-bytes',
        );
      },
    });
  } finally {
    await fakeServer.close();
  }
});
