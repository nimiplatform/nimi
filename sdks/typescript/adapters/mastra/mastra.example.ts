import { Agent } from '@mastra/core/agent';

import type { NimiAiContextProvider } from '@nimiplatform/sdk';
import type { NimiAiModel, NimiRuntimeEmbeddingSurface } from '@nimiplatform/sdk/ai';
import type { NimiRuntimeGenerationHeadInput } from '@nimiplatform/sdk/features/generation';
import {
  createNimiMastraEmbeddingModel,
  createNimiMastraContextBridge,
  createNimiMastraModel,
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

// This bridge accepts caller-supplied, already-bounded context for generic AI
// work. LocalAgent recall and conversation context stay inside Runtime's
// canonical Conversation path and are not fetched by this adapter.
export async function runMastraAgentWithNimiRuntimeContextExample(
  model: NimiAiModel,
  contextProviders: readonly NimiAiContextProvider[],
): Promise<string> {
  const runnerSpec = {
    id: 'nimi-runtime-context-example',
    name: 'Nimi Runtime Context Example',
  };
  const agent = new Agent({
    id: runnerSpec.id,
    name: runnerSpec.name,
    instructions: 'Use the supplied Nimi Runtime context when relevant.',
    model: createNimiMastraModel({ model }),
  });
  const contextBridge = createNimiMastraContextBridge({
    runner: runnerSpec,
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

// Use this embedder anywhere Mastra expects a MastraEmbeddingModel / AI SDK
// EmbeddingModelV3, for example vector stores or semantic recall processors.
export function createMastraRuntimeOwnedEmbedder(
  embedding: NimiRuntimeEmbeddingSurface,
) {
  return createNimiMastraEmbeddingModel({
    model: { modelId: 'text.embed' },
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
