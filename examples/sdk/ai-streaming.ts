/**
 * AI Streaming Example
 *
 * Run: npx tsx examples/sdk/ai-streaming.ts
 */

import { Runtime } from '@nimiplatform/sdk';
import { ReasonCode } from '@nimiplatform/sdk/types';

const APP_ID = 'example.stream';

const runtime = new Runtime({
  appId: APP_ID,
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

async function basicStream() {
  const streamResult = await runtime.ai.text.stream({
    model: 'local/qwen2.5',
    subjectUserId: 'local-user',
    input: 'Write a short haiku about open source.',
    maxTokens: 128,
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 120000,
  });

  let fullText = '';

  for await (const part of streamResult.stream) {
    if (part.type === 'start') {
      console.log('Started.');
      continue;
    }
    if (part.type === 'delta') {
      fullText += part.text;
      process.stdout.write(part.text);
      continue;
    }
    if (part.type === 'finish') {
      console.log('\nUsage:', part.usage);
      console.log('Completed. finishReason:', part.finishReason);
      continue;
    }
    if (part.type === 'error') {
      console.error('\nFailed:', part.error.reasonCode, part.error.actionHint);
    }
  }

  console.log('\nFull output:', fullText);
}

async function streamFailureCase() {
  const streamResult = await runtime.ai.text.stream({
    model: 'nonexistent-model',
    subjectUserId: 'local-user',
    input: 'test',
    maxTokens: 64,
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 20000,
  });

  for await (const part of streamResult.stream) {
    if (part.type === 'error') {
      const reason = part.error.reasonCode;
      console.error('Failure reason:', reason);
      if (reason === ReasonCode.AI_PROVIDER_TIMEOUT) {
        console.error('This reason is retryable.');
      }
      return;
    }
  }
}

async function main() {
  console.log('=== Basic Stream ===');
  await basicStream();

  console.log('\n=== Failure Case ===');
  await streamFailureCase();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
