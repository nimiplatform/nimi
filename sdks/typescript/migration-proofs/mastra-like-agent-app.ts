import { createNimiMastraModel, type NimiMastraLanguageModel } from '../adapters/mastra';
import { NIMI_MASTRA_ADAPTER_MANIFEST } from '../adapters/mastra/manifest';
import { createNimiProofModel } from './model-fixtures';
import type { NimiMigrationProofResult } from './proof-contracts';

// A Mastra app can migrate its LLM execution layer to Nimi by replacing the
// Agent's model: MastraModelConfig admits the LanguageModelV3 returned by
// createNimiMastraModel. This proof does not claim Nimi-owned Mastra memory,
// knowledge, workflow checkpointing, or localAgent lifecycle state; those need a
// Runtime/Cognition bridge.
export async function runMastraLikeAgentAppProof(): Promise<NimiMigrationProofResult> {
  const fixture = createNimiProofModel({ modelId: 'mastra-proof-model', text: 'agent turn complete' });
  const model = createNimiMastraModel({ model: fixture.model });
  const result = await mastraAgentGenerateLike({
    model,
    prompt: 'Existing Mastra app prompt with its LLM layer migrated by replacing the Agent model.',
  });

  return {
    proofId: 'mastra-like-agent-app',
    appShape: 'Mastra agent LLM execution layer',
    status: result.text === 'agent turn complete' && fixture.calls.length === 1 ? 'passed' : 'failed',
    migratedBy: 'adapter-model-replacement',
    adapterIds: [NIMI_MASTRA_ADAPTER_MANIFEST.adapterId],
    observedCapabilities: ['model.config', 'agent.generate'],
    evidence: [`text:${result.text}`, `calls:${fixture.calls.length}`],
  };
}

async function mastraAgentGenerateLike(input: {
  readonly model: NimiMastraLanguageModel;
  readonly prompt: string;
}): Promise<{ readonly text: string }> {
  const result = await input.model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }],
  });
  const text = result.content.find((part) => part.type === 'text');
  return {
    text: text?.text ?? '',
  };
}
