import { createNimiMcpAdapter, NIMI_MCP_ADAPTER_MANIFEST } from '../adapters/mcp';
import type { NimiMigrationProofResult } from './proof-contracts';

export async function runMcpToolHeavyAppProof(): Promise<NimiMigrationProofResult> {
  const adapter = createNimiMcpAdapter({
    tools: [
      createAutoTool('read_project', { project: 'nimi' }),
      createAutoTool('summarize_file', { summary: 'bounded' }),
      createAutoTool('write_artifact', { artifactId: 'artifact-1' }),
    ],
  });

  const results = await Promise.all([
    expectRuntimeDelegationRequired(adapter.callTool({ name: 'read_project', arguments: { path: 'README.md' } })),
    expectRuntimeDelegationRequired(adapter.callTool({ name: 'summarize_file', arguments: { fileId: 'README.md' } })),
    expectRuntimeDelegationRequired(adapter.callTool({ name: 'write_artifact', arguments: { kind: 'report' } })),
  ]);

  return {
    proofId: 'mcp-tool-heavy-app',
    appShape: 'MCP tool-heavy app',
    status: results.length === 3 && adapter.listTools().length === 3 ? 'passed' : 'failed',
    migratedBy: 'source-root-adapter-contract',
    adapterIds: [NIMI_MCP_ADAPTER_MANIFEST.adapterId],
    observedCapabilities: ['mcp.tools.list', 'mcp.tools.call.auto'],
    evidence: results,
  };
}

async function expectRuntimeDelegationRequired(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    const feature = (error as { readonly feature?: string }).feature;
    if (feature === 'mcp.tools.call.runtime_delegation_required') {
      return feature;
    }
    throw error;
  }
  throw new Error('MCP local tool execution must require Runtime delegation');
}

function createAutoTool(name: string, output: { readonly [key: string]: string }) {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object' },
    policy: 'auto' as const,
    visibility: 'model' as const,
    execute() {
      return output;
    },
  };
}
