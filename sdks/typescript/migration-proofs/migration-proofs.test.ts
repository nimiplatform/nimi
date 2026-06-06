import assert from 'node:assert/strict';
import test from 'node:test';

import { NIMI_LANGGRAPH_ADAPTER_MANIFEST } from '../adapters/langgraph';
import { NIMI_LLAMA_INDEX_ADAPTER_MANIFEST } from '../adapters/llamaindex';
import { NIMI_MASTRA_ADAPTER_MANIFEST } from '../adapters/mastra';
import { NIMI_MCP_ADAPTER_MANIFEST } from '../adapters/mcp';
import { NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST } from '../adapters/openai-compatible';
import { NIMI_VERCEL_AI_ADAPTER_MANIFEST } from '../adapters/vercel-ai/manifest';
import { assertProofPassed } from './proof-contracts';
import { runLangGraphLikeGraphNodeProof } from './langgraph-like-graph-node';
import { runMastraLikeAgentAppProof } from './mastra-like-agent-app';
import { runMcpToolHeavyAppProof } from './mcp-tool-heavy-app';
import { runMingSimShapedProof } from './mingsim-shaped-proof';
import { runVercelAiSdkExternalAppProof } from './vercel-ai-sdk-external-app';

test('SDK vNext migration proofs pass for required app shapes', async () => {
  const proofs = [
    await runVercelAiSdkExternalAppProof(),
    await runMcpToolHeavyAppProof(),
    await runMastraLikeAgentAppProof(),
    await runLangGraphLikeGraphNodeProof(),
    await runMingSimShapedProof(),
  ];

  proofs.forEach(assertProofPassed);
  assert.deepEqual(
    proofs.map((proof) => proof.proofId),
    [
      'vercel-ai-sdk-external-app',
      'mcp-tool-heavy-app',
      'mastra-like-agent-app',
      'langgraph-like-graph-node',
      'mingsim-shaped-proof',
    ],
  );
  assert.ok(proofs.some((proof) => proof.migratedBy === 'adapter-model-replacement'));
});

test('mingsim-shaped proof is not LLM-only', async () => {
  const proof = await runMingSimShapedProof();

  for (const capability of [
    'tools',
    'memory-context',
    'knowledge-context',
    'structured-output',
    'approval',
    'external-execution',
    'artifacts',
    'long-running-session',
  ]) {
    assert.ok(proof.observedCapabilities.includes(capability), capability);
  }
});

test('adapter manifests match observed proof behavior', async () => {
  const manifests: readonly { readonly adapterId: string }[] = [
    NIMI_VERCEL_AI_ADAPTER_MANIFEST,
    NIMI_MCP_ADAPTER_MANIFEST,
    NIMI_MASTRA_ADAPTER_MANIFEST,
    NIMI_LANGGRAPH_ADAPTER_MANIFEST,
    NIMI_LLAMA_INDEX_ADAPTER_MANIFEST,
    NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST,
  ];
  const manifestByAdapter: ReadonlyMap<string, { readonly adapterId: string }> = new Map(
    manifests.map((manifest) => [manifest.adapterId, manifest] as const),
  );
  const proofs = [
    await runVercelAiSdkExternalAppProof(),
    await runMcpToolHeavyAppProof(),
    await runMastraLikeAgentAppProof(),
    await runLangGraphLikeGraphNodeProof(),
    await runMingSimShapedProof(),
  ];

  for (const proof of proofs) {
    for (const adapterId of proof.adapterIds) {
      assert.ok(manifestByAdapter.has(adapterId), adapterId);
    }
  }
  assert.equal(NIMI_MCP_ADAPTER_MANIFEST.capabilities['mcp.tools.call.auto'], 'supported');
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.capabilities['model.generate'], 'supported');
  assert.equal(NIMI_LANGGRAPH_ADAPTER_MANIFEST.capabilities['node.generate'], 'supported');
  assert.equal(NIMI_LLAMA_INDEX_ADAPTER_MANIFEST.capabilities['query.generate'], 'supported');
  assert.equal(NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST.capabilities['chat.completions.create'], 'supported');
});
