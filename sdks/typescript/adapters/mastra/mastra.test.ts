import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';

import type { NimiClient, NimiClientRuntimeModelOptions } from '@nimiplatform/sdk';
import { isNimiError } from '@nimiplatform/sdk';
import type { NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import {
  createNimiMastraModel,
  createNimiMastraProvider,
  NIMI_MASTRA_ADAPTER_MANIFEST,
  NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE,
  NimiMastraUnsupportedFeatureError,
} from './index';
import { createNimiFixtureModel, createNonStreamingFixtureModel } from './mastra.fixtures';

// Adapter-owned conformance suites driving the real Mastra public API.
import './mastra.context.test';
import './mastra.conformance.test';
import './mastra.embedding-voice.test';

test('mastra adapter produces a LanguageModelV3 Mastra accepts as a model config', () => {
  // The wrapped Nimi model is a v3 provider model assignable to MastraModelConfig
  // and accepted by the Agent constructor — the core migration guarantee.
  const fixture = createNimiFixtureModel();
  const model = createNimiMastraModel({ model: fixture.model });

  assert.equal(model.specificationVersion, 'v3');
  assert.equal(model.provider, 'nimi');
  assert.equal(model.modelId, 'text.generate');

  const asMastraConfig: MastraModelConfig = model;
  const agent = new Agent({ id: 'shape', name: 'shape', instructions: 'shape check', model: asMastraConfig });
  assert.ok(agent instanceof Agent);
});

test('mastra adapter maps a LanguageModelV3 generate call to a Nimi request', async () => {
  // Mastra drives the model's doGenerate; the adapter maps prompt/tools/responseFormat
  // onto a NimiGenerateTextRequest.
  const calls: NimiGenerateTextRequest[] = [];
  const fixture = createNimiFixtureModel({ result: { text: 'mapped', finishReason: 'stop' } });
  const recording = {
    model: fixture.model.model,
    generateText: (request: NimiGenerateTextRequest) => {
      calls.push(request);
      return fixture.model.generateText(request);
    },
  };
  const model = createNimiMastraModel({ model: recording });

  const result = await model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
    responseFormat: { type: 'json', schema: { type: 'object' }, name: 'Answer' },
  });

  assert.equal(calls[0]?.messages[0]?.role, 'user');
  assert.equal(calls[0]?.tools?.[0]?.name, 'lookup');
  assert.equal(calls[0]?.responseFormat?.type, 'json-schema');
  assert.deepEqual(result.content, [{ type: 'text', text: 'mapped' }]);
});

test('mastra adapter fails closed when the Nimi model cannot stream', async () => {
  // Streaming over a generate-only Nimi model surfaces the adapter's own typed
  // unsupported-feature error rather than a fabricated empty stream.
  const model = createNimiMastraModel({ model: createNonStreamingFixtureModel() });

  await assert.rejects(
    async () => await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'stream' }] }],
    }),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.code, NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'languageModel.doStream');
      return true;
    },
  );
});

test('mastra adapter fails closed when a Nimi stream ends without terminal evidence', async () => {
  const model = createNimiMastraModel({
    model: createNimiFixtureModel({
      stream: [{ type: 'text-delta', text: 'partial' }],
    }).model,
  });
  const { stream } = await model.doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'stream' }] }],
  });
  const reader = stream.getReader();
  await assert.rejects(
    async () => {
      for (;;) {
        await reader.read();
      }
    },
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING');
      return true;
    },
  );
});

test('mastra adapter preserves structured stream failures and unknown terminal states', async () => {
  const errorFixture = createNimiFixtureModel({
    stream: [
      { type: 'text-delta', text: 'partial' },
      { type: 'error', code: 'SDK_MASTRA_STREAM_TEST_FAILURE', message: 'failed' },
    ],
  });
  const streamResult = await createNimiMastraModel({ model: errorFixture.model }).doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  const parts = [];
  const reader = streamResult.stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    parts.push(next.value);
  }
  const errorPart = parts.find((part) => part.type === 'error');
  const streamError = errorPart?.type === 'error' ? errorPart.error : undefined;
  assert.equal(isNimiError(streamError), true);
  assert.equal((streamError as { reasonCode?: string }).reasonCode, 'SDK_MASTRA_STREAM_TEST_FAILURE');

  const unknownFixture = createNimiFixtureModel({
    stream: [{ type: 'done', finishReason: 'unknown' }],
  });
  const unknownStream = await createNimiMastraModel({ model: unknownFixture.model }).doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  const unknownReader = unknownStream.stream.getReader();
  await assert.rejects(
    async () => {
      for (;;) {
        await unknownReader.read();
      }
    },
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN');
      return true;
    },
  );
});

test('mastra adapter fails closed on a missing model', () => {
  // createNimiMastraModel requires a NimiAiModel and throws a typed adapter error
  // rather than returning an unsupported placeholder model.
  assert.throws(
    () => createNimiMastraModel({ model: undefined as never }),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.code, NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'model.config');
      return true;
    },
  );
});

test('mastra provider fails closed on invalid configuration with a typed error', () => {
  // The provider must be given exactly one of model or client, and the error is the
  // adapter's own typed error (not a leaked sibling-adapter error).
  const assertConfigError = (run: () => unknown): void => {
    assert.throws(run, (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.code, NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'provider.configuration');
      return true;
    });
  };

  assertConfigError(() => createNimiMastraProvider({} as never));
  assertConfigError(() => createNimiMastraProvider({ model: createNimiFixtureModel().model, client: {} as NimiClient } as never));
});

test('mastra provider fails closed on anything except the text capability id', () => {
  const provider = createNimiMastraProvider({ model: createNimiFixtureModel().model });

  assert.equal(provider.languageModel('text.generate').modelId, 'text.generate');
  assert.throws(
    () => provider.languageModel('unknown-model'),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.code, NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'provider.languageModel');
      return true;
    },
  );
});

test('mastra runtime-backed provider requires explicit external subject mode', () => {
  const client = {
    ai: {
      createRuntimeModel(_options: NimiClientRuntimeModelOptions) {
        return createNimiFixtureModel().model;
      },
      createRuntimeEmbeddingClient() {
        return {
          async embedText() {
            return { embeddings: [[0]], raw: {} };
          },
        };
      },
    },
  } as unknown as NimiClient;

  assert.throws(
    () => createNimiMastraProvider({
      client,
      subjectUserId: 'user-1',
    }).languageModel('model-1'),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.feature, 'provider.subjectUserId');
      return true;
    },
  );
  assert.throws(
    () => createNimiMastraProvider({
      client,
      embedding: {
        appId: 'app-1',
        subjectUserId: 'user-1',
      },
    }).embeddingModel('text.embed'),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.feature, 'provider.embedding.subjectUserId');
      return true;
    },
  );
});

test('mastra manifest represents supported, partial, and not-applicable capability classes', () => {
  const capabilities = NIMI_MASTRA_ADAPTER_MANIFEST.capabilities;
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.capabilityLevel, 'L4');
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.targetLibrary, 'Mastra');
  assert.equal(capabilities['agent.generate'].support, 'supported');
  assert.equal(capabilities.runtimeContext.support, 'supported');
  assert.equal(capabilities.runtimeContext.mode, 'adapter-mapped');
  assert.match(capabilities.runtimeContext.note, /does not fetch Memory or Knowledge/);
  assert.equal(capabilities.memory.support, 'partial');
  assert.equal(capabilities.memory.mode, 'framework-owned');
  assert.equal(capabilities.workflowCheckpoint.support, 'not-applicable');
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.unsupportedBehavior, 'throw');
});
