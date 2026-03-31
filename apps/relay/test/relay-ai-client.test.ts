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

  it('passes local image route and workflow extensions through to runtime.media.image.generate', async () => {
    let request: Record<string, unknown> | null = null;
    const runtime = {
      ai: {
        text: {
          generate: async () => ({ text: '', finishReason: 'stop', trace: null }),
          stream: async function* stream() {
            return;
          },
        },
      },
      media: {
        image: {
          generate: async (input: Record<string, unknown>) => {
            request = input;
            return {
              artifacts: [{
                uri: 'file:///tmp/generated.png',
                mimeType: 'image/png',
                bytes: new Uint8Array([1, 2, 3]),
              }],
              trace: { traceId: 'trace-local-image' },
            };
          },
        },
        video: { generate: async () => ({ artifacts: [], trace: null }) },
      },
    };

    const client = createRelayAiClient(runtime as never, null, {
      image: {
        routeSource: 'local',
        model: 'local/flux-local-dev',
        localModelId: 'local-image-1',
        extensions: {
          components: [{ slot: 'vae_path', localArtifactId: 'artifact-vae-1' }],
        },
      },
    });

    const result = await client.generateImage({
      prompt: 'a city skyline at dusk',
    } as never);

    assert.deepEqual(request, {
      model: 'local/flux-local-dev',
      prompt: 'a city skyline at dusk',
      negativePrompt: undefined,
      size: undefined,
      aspectRatio: undefined,
      quality: undefined,
      style: undefined,
      n: undefined,
      subjectUserId: 'local-user',
      route: 'local',
      extensions: {
        components: [{ slot: 'vae_path', localArtifactId: 'artifact-vae-1' }],
      },
    });
    assert.equal(result.traceId, 'trace-local-image');
    assert.equal(result.artifacts[0]?.mimeType, 'image/png');
    assert.equal(result.artifacts[0]?.base64, Buffer.from([1, 2, 3]).toString('base64'));
  });

  it('keeps cloud image route behavior unchanged', async () => {
    let request: Record<string, unknown> | null = null;
    const runtime = {
      ai: {
        text: {
          generate: async () => ({ text: '', finishReason: 'stop', trace: null }),
          stream: async function* stream() {
            return;
          },
        },
      },
      media: {
        image: {
          generate: async (input: Record<string, unknown>) => {
            request = input;
            return { artifacts: [], trace: null };
          },
        },
        video: { generate: async () => ({ artifacts: [], trace: null }) },
      },
    };

    const client = createRelayAiClient(runtime as never, null, {
      image: {
        routeSource: 'cloud',
        connectorId: 'conn-1',
        model: 'gpt-image-1',
      },
    });

    await client.generateImage({ prompt: 'cloud test' } as never);

    assert.deepEqual(request, {
      model: 'gpt-image-1',
      prompt: 'cloud test',
      negativePrompt: undefined,
      size: undefined,
      aspectRatio: undefined,
      quality: undefined,
      style: undefined,
      n: undefined,
      subjectUserId: 'local-user',
      route: 'cloud',
      connectorId: 'conn-1',
    });
  });
});
