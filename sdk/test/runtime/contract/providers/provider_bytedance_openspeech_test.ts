import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime } from '../../../../src/runtime/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.bytedance.openspeech.contract';
const SUBJECT_USER_ID = 'user-provider-bytedance';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

function startFakeBytedanceOpenSpeechServer(): Promise<FakeServer> {
  const speechBytes = Buffer.from('bytedance-tts-audio', 'utf8');

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
        data: [{ id: 'bytedance-model' }],
      }));
      return;
    }

    if (req.method === 'POST' && path === '/api/v1/tts') {
      res.statusCode = 200;
      res.setHeader('content-type', 'audio/mpeg');
      res.end(speechBytes);
      return;
    }

    if (req.method === 'POST' && path === '/api/v3/auc/bigmodel/recognize/flash') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        text: 'bytedance stt text',
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
        reject(new Error('fake bytedance openspeech server listen failed'));
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

test('provider_bytedance_openspeech_test.ts: bytedance openspeech tts/stt via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeBytedanceOpenSpeechServer();

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL: fakeServer.url,
        NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_OPENSPEECH_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-bytedance-contract',
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

        const ttsResult = await provider.tts('bytedance/tts-1').synthesize({
          text: 'hello bytedance',
        });
        assert.equal(ttsResult.artifacts.length, 1);
        assert.equal(
          Buffer.from(ttsResult.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          'bytedance-tts-audio',
        );

        const sttResult = await provider.stt('bytedance/stt-1').transcribe({
          audioBytes: Uint8Array.from([1, 2, 3, 4]),
          mimeType: 'audio/wav',
        });
        assert.equal(sttResult.text, 'bytedance stt text');
      },
    });
  } finally {
    await fakeServer.close();
  }
});
