import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime } from '../../../../src/runtime/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.minimax.contract';
const SUBJECT_USER_ID = 'user-provider-minimax';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

function startFakeMiniMaxServer(): Promise<FakeServer> {
  const imageBytes = Buffer.from('minimax-image-bytes', 'utf8');
  const videoBytes = Buffer.from('minimax-video-bytes', 'utf8');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'minimax-model' }] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/image_generation') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ task_id: 'task-image-1' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/query/image_generation') {
      const taskID = url.searchParams.get('task_id');
      if (taskID !== 'task-image-1') {
        res.statusCode = 404;
        res.end('unknown task');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        status: 'success',
        artifact: {
          b64_json: imageBytes.toString('base64'),
          mime_type: 'image/png',
        },
      }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/video_generation') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ task_id: 'task-video-1' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/query/video_generation') {
      const taskID = url.searchParams.get('task_id');
      if (taskID !== 'task-video-1') {
        res.statusCode = 404;
        res.end('unknown task');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        status: 'success',
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
        reject(new Error('fake minimax server listen failed'));
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

test('provider_minimax_test.ts: minimax image/video task via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeMiniMaxServer();

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-minimax-contract',
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

        const imageResult = await provider.image('minimax/image-1').doGenerate({
          prompt: 'forest at dusk',
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          files: undefined,
          mask: undefined,
          providerOptions: {},
        });
        assert.equal(imageResult.images.length, 1);
        assert.equal(imageResult.images[0], Buffer.from('minimax-image-bytes', 'utf8').toString('base64'));

        const videoResult = await provider.video('minimax/video-1').generate({
          mode: 't2v',
          prompt: 'sea sunset',
          content: [
            {
              type: 'text',
              role: 'prompt',
              text: 'sea sunset',
            },
          ],
          options: {
            durationSec: 6,
          },
        });
        assert.equal(videoResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(videoResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          'minimax-video-bytes',
        );
      },
    });
  } finally {
    await fakeServer.close();
  }
});
