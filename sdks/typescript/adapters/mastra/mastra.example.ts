import { Agent } from '@mastra/core/agent';

import type { NimiAgentContextProvider } from '@nimiplatform/sdk';
import type { NimiAiModel, NimiRuntimeEmbeddingSurface } from '@nimiplatform/sdk/ai';
import type { NimiRuntimeGenerationHeadInput } from '@nimiplatform/sdk/features/generation';
import type { NimiRuntimeAgentDelegatedCapabilitySurface } from '@nimiplatform/sdk/runtime';
import {
  createNimiMastraEmbeddingModel,
  createNimiMastraContextBridge,
  createNimiMastraModel,
  createNimiMastraRuntimeDelegatedToolBinding,
  createNimiMastraRuntimeDelegatedTool,
  createNimiMastraVoice,
  generateWithNimiMastraContext,
  type NimiMastraVoiceRuntime,
} from './index';

// Migrate the Mastra LLM execution layer to Nimi by swapping the Agent's model for
// a Nimi-backed one. Tools, instructions, and the generate()/stream() public API
// are unchanged, but Mastra Memory/Workflow state remains Mastra-owned unless a
// separate Nimi Runtime/Cognition bridge is installed.
export async function runMastraAgentExample(model: NimiAiModel): Promise<string> {
  const agent = new Agent({
    id: 'nimi-example',
    name: 'nimi-example',
    instructions: 'You are a helpful assistant backed by a Nimi model.',
    model: createNimiMastraModel({ model }),
  });

  const result = await agent.generate('Say hello from the Nimi-backed Mastra agent.');
  return result.text;
}

// Keep Mastra as the orchestration/helper layer while Nimi owns per-turn memory
// and knowledge context. `contextProviders` can come from
// `client.agent.createMemoryContextProvider(...)` and
// `client.agent.createKnowledgeContextProvider(...)`.
export async function runMastraAgentWithNimiRuntimeContextExample(
  model: NimiAiModel,
  contextProviders: readonly NimiAgentContextProvider[],
): Promise<string> {
  const agentSpec = {
    id: 'nimi-runtime-context-example',
    name: 'Nimi Runtime Context Example',
  };
  const agent = new Agent({
    id: agentSpec.id,
    name: agentSpec.name,
    instructions: 'Use the supplied Nimi Runtime context when relevant.',
    model: createNimiMastraModel({ model }),
  });
  const contextBridge = createNimiMastraContextBridge({
    agent: agentSpec,
    model,
    contextProviders,
  });

  const result = await generateWithNimiMastraContext(
    agent,
    'Answer with Nimi Runtime-owned context.',
    { contextBridge },
  );
  return result.text;
}

export function createMastraRuntimeOwnedSearchTool(
  runtime: NimiRuntimeAgentDelegatedCapabilitySurface,
) {
  return createNimiMastraRuntimeDelegatedTool({
    id: 'runtimeSearch',
    description: 'Search through a Nimi Runtime delegated provider.',
    binding: createNimiMastraRuntimeDelegatedToolBinding({
      runtime,
      agentId: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      providerProfileId: 'search-provider',
      capabilityId: 'search.query',
      descriptorHash: 'sha256:search-provider-descriptor',
      outputKind: 'observation',
    }),
  });
}

// Use this embedder anywhere Mastra expects a MastraEmbeddingModel / AI SDK
// EmbeddingModelV3, for example vector stores or semantic recall processors.
export function createMastraRuntimeOwnedEmbedder(
  embedding: NimiRuntimeEmbeddingSurface,
) {
  return createNimiMastraEmbeddingModel({
    model: { providerId: 'runtime', modelId: 'runtime-selected-embedding' },
    embedding,
  });
}

// Non-realtime Mastra voice migration: speak/listen/catalog call Runtime speech
// and voice surfaces. Callers supply idempotency keys from their logical Runtime
// turn/run scope; the adapter does not derive them from text or audio. Realtime
// connect/send/answer intentionally fail closed until a Runtime realtime-session
// bridge is installed.
export function createMastraRuntimeOwnedVoice(
  runtime: NimiMastraVoiceRuntime,
  head: NimiRuntimeGenerationHeadInput,
  idempotencyKeyFactory: (operation: 'speak' | 'listen') => string,
) {
  return createNimiMastraVoice({
    runtime,
    head,
    transcriptionMimeType: 'audio/webm',
    idempotencyKeyFactory,
  });
}
