import { createNimiLangGraphAdapter, NIMI_LANGGRAPH_ADAPTER_MANIFEST } from '../adapters/langgraph';
import { textPart } from '../core/contracts';
import { createNimiProofModel } from './model-fixtures';
import type { NimiMigrationProofResult } from './proof-contracts';

export async function runLangGraphLikeGraphNodeProof(): Promise<NimiMigrationProofResult> {
  const fixture = createNimiProofModel({ modelId: 'langgraph-proof-model', text: 'graph node complete' });
  const adapter = createNimiLangGraphAdapter({ model: fixture.model });
  const state = await adapter.node({
    messages: [{ role: 'user', content: [textPart('Advance graph node.')] }],
  });

  return {
    proofId: 'langgraph-like-graph-node',
    appShape: 'LangGraph-like graph node',
    status: state.messages.length === 2 && state.messages[1]?.role === 'assistant' ? 'passed' : 'failed',
    migratedBy: 'source-root-adapter-contract',
    adapterIds: [NIMI_LANGGRAPH_ADAPTER_MANIFEST.adapterId],
    observedCapabilities: ['node.generate'],
    evidence: [`messages:${state.messages.length}`],
  };
}
