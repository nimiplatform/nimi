/**
 * AI Streaming Example
 *
 * Run: npx tsx docs/examples/ai-streaming.ts
 */

import { createNimiClient } from '@nimiplatform/sdk';
import {
  FallbackPolicy,
  Modal,
  RuntimeReasonCode,
  RoutePolicy,
  StreamEventType,
} from '@nimiplatform/sdk/runtime';

const APP_ID = 'example.stream';

const client = createNimiClient({
  appId: APP_ID,
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const runtime = client.runtime!;

async function basicStream() {
  const stream = await runtime.ai.streamGenerate(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/qwen2.5',
      modal: Modal.TEXT,
      input: [{ role: 'user', name: 'user', content: 'Write a short haiku about open source.' }],
      systemPrompt: '',
      tools: [],
      temperature: 0,
      topP: 1,
      maxTokens: 128,
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 120000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  let fullText = '';

  for await (const event of stream) {
    switch (event.eventType) {
      case StreamEventType.STREAM_EVENT_STARTED:
        if (event.payload.oneofKind === 'started') {
          console.log('Started model:', event.payload.started.modelResolved);
        }
        break;

      case StreamEventType.STREAM_EVENT_DELTA:
        if (event.payload.oneofKind === 'delta') {
          const text = event.payload.delta.text;
          fullText += text;
          process.stdout.write(text);
        }
        break;

      case StreamEventType.STREAM_EVENT_USAGE:
        if (event.payload.oneofKind === 'usage') {
          console.log('\nUsage:', event.payload.usage);
        }
        break;

      case StreamEventType.STREAM_EVENT_COMPLETED:
        console.log('\nCompleted.');
        break;

      case StreamEventType.STREAM_EVENT_FAILED:
        if (event.payload.oneofKind === 'failed') {
          console.error(
            '\nFailed:',
            RuntimeReasonCode[event.payload.failed.reasonCode],
            event.payload.failed.actionHint,
          );
        }
        break;

      default:
        break;
    }
  }

  console.log('\nFull output:', fullText);
}

async function streamFailureCase() {
  const stream = await runtime.ai.streamGenerate(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'nonexistent-model',
      modal: Modal.TEXT,
      input: [{ role: 'user', name: 'user', content: 'test' }],
      systemPrompt: '',
      tools: [],
      temperature: 0,
      topP: 1,
      maxTokens: 64,
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 20000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  for await (const event of stream) {
    if (
      event.eventType === StreamEventType.STREAM_EVENT_FAILED
      && event.payload.oneofKind === 'failed'
    ) {
      const reason = event.payload.failed.reasonCode;
      console.error('Failure reason:', RuntimeReasonCode[reason]);
      if (reason === RuntimeReasonCode.AI_PROVIDER_TIMEOUT) {
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
