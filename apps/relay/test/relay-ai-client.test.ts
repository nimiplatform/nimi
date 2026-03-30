import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayAiClient } from '../src/main/chat-pipeline/relay-ai-client.js';

describe('createRelayAiClient', () => {
  it('fails closed when authoritative text route is missing', async () => {
    const runtime = {
      ai: {
        text: {
          generate: async () => {
            throw new Error('should not be called without a route');
          },
          stream: async function* stream() {
            throw new Error('should not be called without a route');
          },
        },
      },
      media: {
        image: { generate: async () => ({ artifacts: [], trace: null }) },
        video: { generate: async () => ({ artifacts: [], trace: null }) },
      },
    };

    const client = createRelayAiClient(runtime as never, null);

    await assert.rejects(
      client.generateText({ prompt: 'hello' } as never),
      /RELAY_TEXT_ROUTE_REQUIRED/,
    );
  });
});
