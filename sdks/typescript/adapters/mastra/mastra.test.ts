import assert from 'node:assert/strict';
import test from 'node:test';

import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';

import type { NimiClient } from '@nimiplatform/sdk';
import type { NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import {
  createNimiMastraModel,
  createNimiMastraProvider,
  NIMI_MASTRA_ADAPTER_MANIFEST,
  NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE,
  NimiMastraUnsupportedFeatureError,
} from './index';
import { createNimiFixtureModel, createNonStreamingFixtureModel } from './mastra.fixtures';

// Conformance + upstream suites driving the real Mastra public API through the
// adapter. Imported here so they run inside the single-file adapter capability
// ledger gate, alongside the model-shape, fail-closed, and manifest checks below.
import './mastra.boundary.test';
import './mastra.context.test';
import './mastra.conformance.test';
import './mastra.embedding-voice.test';
import './mastra.runtime-delegated-tools.test';
import './mastra.upstream-compat.test';

test('mastra adapter produces a LanguageModelV3 Mastra accepts as a model config', () => {
  // The wrapped Nimi model is a v3 provider model assignable to MastraModelConfig
  // and accepted by the Agent constructor — the core migration guarantee.
  const fixture = createNimiFixtureModel({ modelId: 'mastra-model' });
  const model = createNimiMastraModel({ model: fixture.model });

  assert.equal(model.specificationVersion, 'v3');
  assert.equal(model.provider, 'nimi');
  assert.equal(model.modelId, 'mastra-model');

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

  assertConfigError(() => createNimiMastraProvider({}));
  assertConfigError(() => createNimiMastraProvider({ model: createNimiFixtureModel().model, client: {} as NimiClient }));
});

test('mastra provider fails closed on an unknown model id with a typed error', () => {
  const provider = createNimiMastraProvider({ model: createNimiFixtureModel({ modelId: 'known-model' }).model });

  assert.equal(provider.languageModel('known-model').modelId, 'known-model');
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

test('mastra manifest answers Mastra interface coverage and types every gap', () => {
  const capabilities = NIMI_MASTRA_ADAPTER_MANIFEST.capabilities;
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.capabilityLevel, 'L4');
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.targetLibrary, 'Mastra');

  // Adapter-mapped model interface coverage, proven by the conformance suite.
  assert.equal(capabilities['model.config'].support, 'supported');
  assert.equal(capabilities['agent.generate'].support, 'supported');
  assert.equal(capabilities['agent.stream'].support, 'supported');
  assert.equal(capabilities['tools.definition'].support, 'supported');
  assert.equal(capabilities['tools.toolChoice'].support, 'supported');
  assert.equal(capabilities.structuredOutput.support, 'supported');
  assert.equal(capabilities.usage.support, 'supported');
  assert.equal(capabilities.finishReason.support, 'supported');
  assert.equal(capabilities.sources.support, 'supported');

  // Adapter-mapped model-interface coverage proven by the conformance suite.
  assert.equal(capabilities.abort.support, 'supported');
  assert.equal(capabilities.rawChunks.support, 'supported');

  // Framework-owned Mastra orchestration is supported when it only drives repeated
  // model calls through the adapter.
  assert.equal(capabilities['tools.execution'].support, 'supported');
  assert.equal(capabilities['tools.execution'].mode, 'framework-owned');
  assert.equal(capabilities['tools.resultPropagation'].mode, 'framework-owned');
  assert.equal(capabilities.multiStep.support, 'supported');
  assert.equal(capabilities.multiStep.mode, 'framework-owned');
  assert.equal(capabilities.agentCallbacks.support, 'supported');
  assert.equal(capabilities.agentCallbacks.mode, 'framework-owned');
  assert.equal(capabilities.structuredOutputFailure.support, 'supported');
  assert.equal(capabilities.dynamicResolution.support, 'supported');
  assert.equal(capabilities.runtimeContext.support, 'supported');
  assert.equal(capabilities.runtimeContext.mode, 'runtime-owned');
  assert.equal(capabilities.runtimeDelegatedTools.support, 'supported');
  assert.equal(capabilities.runtimeDelegatedTools.mode, 'runtime-owned');
  // Durable agent state surfaces are compatibility-only until they bind to Nimi
  // Runtime/Cognition owner surfaces.
  assert.equal(capabilities.memory.support, 'partial');
  assert.equal(capabilities.memory.mode, 'framework-owned');
  assert.equal(capabilities.workflows.support, 'partial');
  assert.equal(capabilities.workflows.mode, 'framework-owned');

  // Partial capabilities reflect bounded, route-dependent, or not-yet-exercised
  // reality. They are NOT blurred up to supported.
  assert.equal(capabilities.reasoning.support, 'partial');
  assert.equal(capabilities.providerMetadata.support, 'partial');
  assert.equal(capabilities.providerOptions.support, 'partial');
  assert.equal(capabilities.multimodalInput.support, 'partial');
  assert.equal(capabilities.toolApproval.support, 'partial');
  assert.equal(capabilities.toolSuspendResume.support, 'partial');
  assert.equal(capabilities.structuredOutputRepair.support, 'partial');
  assert.equal(capabilities.agentNetwork.support, 'partial');

  // Runtime-backed non-text model surfaces are part of the Mastra migration
  // adapter suite, while framework durable state remains out of domain.
  assert.equal(capabilities.workflowCheckpoint.support, 'not-applicable');
  assert.equal(capabilities.ragEmbeddings.support, 'supported');
  assert.equal(capabilities.ragEmbeddings.mode, 'runtime-owned');
  assert.equal(capabilities.voice.support, 'partial');
  assert.equal(capabilities.voice.mode, 'runtime-owned');
  assert.equal(capabilities.telemetry.support, 'not-applicable');
  assert.equal(capabilities.legacyV1Api.support, 'not-applicable');
  assert.equal(capabilities.modelRouterString.support, 'not-applicable');

  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.unsupportedBehavior, 'throw');
});
