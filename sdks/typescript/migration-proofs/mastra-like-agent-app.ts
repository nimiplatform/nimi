import { createNimiMastraAdapter, NIMI_MASTRA_ADAPTER_MANIFEST } from '../adapters/mastra';
import { textPart } from '../core/contracts';
import { createNimiProofModel } from './model-fixtures';
import type { NimiMigrationProofResult } from './proof-contracts';

export async function runMastraLikeAgentAppProof(): Promise<NimiMigrationProofResult> {
  const fixture = createNimiProofModel({ modelId: 'mastra-proof-model', text: 'agent turn complete' });
  const adapter = createNimiMastraAdapter({ model: fixture.model });
  const result = await adapter.model.generate({
    messages: [{ role: 'user', content: [textPart('Run the agent turn.')] }],
  });

  return {
    proofId: 'mastra-like-agent-app',
    appShape: 'Mastra-like agent app',
    status: result.text === 'agent turn complete' && fixture.calls.length === 1 ? 'passed' : 'failed',
    migratedBy: 'adapter-model-replacement',
    adapterIds: [NIMI_MASTRA_ADAPTER_MANIFEST.adapterId],
    observedCapabilities: ['model.generate'],
    evidence: [`text:${result.text}`],
  };
}
