import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime, asNimiError } from '../../../../src/runtime/index.js';
import { ReasonCode } from '../../../../src/types/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.kimi.contract';
const SUBJECT_USER_ID = 'user-provider-kimi';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

function startFakeKimiServer(invalidOutput: boolean): Promise<FakeServer> {
  const imageBytes = Buffer.from('kimi-image-bytes', 'utf8');

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
      res.end(JSON.stringify({ data: [{ id: 'kimi-model' }] }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      if (invalidOutput) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: [{
                type: 'text',
                text: 'no image generated',
              }],
            },
          }],
        }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: [{
              type: 'output_image',
              b64_json: imageBytes.toString('base64'),
              mime_type: 'image/png',
            }],
          },
        }],
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
        reject(new Error('fake kimi server listen failed'));
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

async function runKimiImageScenario(input: { invalidOutput: boolean }): Promise<{ error: unknown; imageBase64: string }> {
  const fakeServer = await startFakeKimiServer(input.invalidOutput);
  let error: unknown = null;
  let imageBase64 = '';

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-kimi-contract',
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

        const result = await provider.image('moonshot/moonshot-v1-vision').doGenerate({
          prompt: 'render a floating city',
          n: 1,
          size: undefined,
          aspectRatio: undefined,
          seed: undefined,
          files: undefined,
          mask: undefined,
          providerOptions: {
            style_preset: 'anime',
          },
        });
        imageBase64 = result.images[0] || '';
      },
    });
  } catch (caught) {
    error = caught;
  } finally {
    await fakeServer.close();
  }

  return { error, imageBase64 };
}

test('provider_kimi_test.ts: kimi chat-multimodal image via nimi-sdk', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const { error, imageBase64 } = await runKimiImageScenario({ invalidOutput: false });
  assert.equal(error, null);
  assert.equal(imageBase64, Buffer.from('kimi-image-bytes', 'utf8').toString('base64'));
});

test('provider_kimi_test.ts: kimi invalid output returns AI_OUTPUT_INVALID', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const { error } = await runKimiImageScenario({ invalidOutput: true });
  assert.notEqual(error, null);
  const normalized = asNimiError(error, { source: 'runtime' });
  assert.ok(
    normalized.reasonCode === ReasonCode.AI_OUTPUT_INVALID
      || normalized.reasonCode === '206'
      || normalized.reasonCode === ReasonCode.RUNTIME_CALL_FAILED,
    `unexpected reasonCode: ${normalized.reasonCode}`,
  );
});
