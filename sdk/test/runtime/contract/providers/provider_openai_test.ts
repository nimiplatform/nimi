import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime, asNimiError } from '../../../../src/runtime/index.js';
import { ReasonCode } from '../../../../src/types/index.js';

import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.provider.openai.contract';
const SUBJECT_USER_ID = 'user-provider-openai';

type FakeServer = {
  url: string;
  close: () => Promise<void>;
};

type FakeOpenAIBehavior = {
  videoMode: 'fallback' | 'unsupported';
  streamMode: 'native' | 'fallback-on-nonstream';
};

function startFakeOpenAIServer(behavior: FakeOpenAIBehavior): Promise<FakeServer> {
  const videoBytes = Buffer.from('openai-video-bytes', 'utf8');

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
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/video/generations') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    if (req.method === 'POST' && path === '/v1/videos/generations') {
      if (behavior.videoMode === 'unsupported') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        data: [{
          b64_mp4: videoBytes.toString('base64'),
        }],
      }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.from(chunk));
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let payload: { stream?: boolean } = {};
        try {
          payload = JSON.parse(raw) as { stream?: boolean };
        } catch {
          payload = {};
        }

        if (payload.stream && behavior.streamMode === 'fallback-on-nonstream') {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            error: {
              message: 'stream not supported by upstream adapter',
            },
          }));
          return;
        }

        if (payload.stream && behavior.streamMode === 'native') {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream');
          res.write('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n');
          res.write('data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          choices: [{
            finish_reason: 'stop',
            message: {
              content: 'fallback text',
            },
          }],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 3,
          },
        }));
      });
      return;
    }

    res.statusCode = 404;
    res.end('not found');
  });

  return new Promise((resolvePromise, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('fake openai server listen failed'));
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

test('provider_openai_test.ts: video uses /v1/videos/generations fallback path', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeOpenAIServer({
    videoMode: 'fallback',
    streamMode: 'native',
  });

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_LOCAL_AI_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-openai-contract',
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

        const video = await provider.video('localai/vid-model').generate({
          prompt: 'drive on mars',
        });

        assert.equal(video.artifacts.length, 1);
        assert.equal(
          Buffer.from(video.artifacts[0]?.bytes || new Uint8Array(0)).toString('utf8'),
          'openai-video-bytes',
        );
      },
    });
  } finally {
    await fakeServer.close();
  }
});

test('provider_openai_test.ts: video unsupported returns strict fail-close', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeOpenAIServer({
    videoMode: 'unsupported',
    streamMode: 'native',
  });

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_LOCAL_AI_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-openai-contract',
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

        let thrown: unknown = null;
        try {
          await provider.video('localai/vid-model').generate({
            prompt: 'unsupported video endpoint',
          });
        } catch (error) {
          thrown = error;
        }

        assert.ok(thrown, 'video should fail when both endpoints are unsupported');
        const normalized = asNimiError(thrown, { source: 'runtime' });
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

test('provider_openai_test.ts: stream falls back to non-stream generate when stream unsupported', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 120_000,
}, async () => {
  const fakeServer = await startFakeOpenAIServer({
    videoMode: 'fallback',
    streamMode: 'fallback-on-nonstream',
  });

  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      runtimeEnv: {
        NIMI_RUNTIME_LOCAL_AI_BASE_URL: fakeServer.url,
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
            callerId: 'sdk-provider-openai-contract',
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

        const streamResult = await provider.text('localai/gpt-4o').doStream({
          prompt: promptFromText('hello'),
          providerOptions: {},
        });

        const reader = streamResult.stream.getReader();
        let streamedText = '';
        let sawFinish = false;

        while (true) {
          const next = await reader.read();
          if (next.done) {
            break;
          }
          const part = next.value;
          if (part.type === 'text-delta') {
            streamedText += part.delta;
          }
          if (part.type === 'finish') {
            sawFinish = true;
          }
        }

        assert.equal(streamedText.trim(), 'fallback text');
        assert.equal(sawFinish, true);
      },
    });
  } finally {
    await fakeServer.close();
  }
});
