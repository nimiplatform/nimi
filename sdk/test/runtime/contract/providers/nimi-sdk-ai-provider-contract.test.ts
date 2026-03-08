import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNimiAiProvider } from '../../../../src/ai-provider/index.js';
import { Runtime } from '../../../../src/runtime/index.js';
import { withRuntimeDaemon } from '../helpers/runtime-daemon.js';

const APP_ID = 'nimi.desktop.sdk.ai.contract';
const SUBJECT_USER_ID = 'user-sdk-contract';

function promptFromText(text: string) {
  return [{
    role: 'user' as const,
    content: [{
      type: 'text' as const,
      text,
    }],
  }];
}

test('nimi sdk ai-provider can generate and stream text against runtime daemon', {
  skip: process.env.NIMI_RUNTIME_CONTRACT !== '1',
  timeout: 180_000,
}, async () => {
  try {
    await withRuntimeDaemon({
      appId: APP_ID,
      run: async ({ endpoint }) => {
        const runtime = new Runtime({
          appId: APP_ID,
          transport: {
            type: 'node-grpc',
            endpoint,
          },
          defaults: {
            callerKind: 'desktop-core',
            callerId: 'sdk-ai-provider-contract',
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

        const textModel = provider.text('local/demo-sdk-model');

        const generated = await textModel.doGenerate({
          prompt: promptFromText('hello from sdk contract'),
          providerOptions: {},
        });

        const generatedText = generated.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('')
          .trim();

        assert.ok(generatedText.length > 0, 'generated text should not be empty');
        assert.equal(generated.finishReason.unified, 'stop');

        const streamResult = await textModel.doStream({
          prompt: promptFromText('stream from sdk contract'),
          providerOptions: {},
        });

        const reader = streamResult.stream.getReader();
        let streamText = '';
        let sawFinish = false;

        while (true) {
          const next = await reader.read();
          if (next.done) {
            break;
          }
          const part = next.value;
          if (part.type === 'text-delta') {
            streamText += part.delta;
          }
          if (part.type === 'finish') {
            sawFinish = true;
          }
        }

        assert.ok(streamText.trim().length > 0, 'streamed text should not be empty');
        assert.equal(sawFinish, true, 'stream should emit finish part');
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || '');
    throw new Error(`sdk ai-provider contract failed: ${detail}`);
  }
});
