export interface NimiTypescriptTargetExport {
  readonly id: string;
  readonly owner: string;
  readonly semantics: string;
}

export interface NimiContractInventoryEntry {
  readonly id: string;
  readonly owner: 'sdks/typescript/core/contracts';
  readonly semantics: string;
}

export interface NimiAdapterCapabilityLevelEntry {
  readonly id: 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  readonly name: string;
  readonly semantics: string;
}

export interface NimiAdapterSourceRootEntry {
  readonly id:
    | 'vercel-ai'
    | 'openai-compatible'
    | 'mcp'
    | 'mastra'
    | 'langgraph'
    | 'llamaindex'
    | 'react'
    | 'next';
  readonly name: string;
  readonly owner: `sdks/typescript/adapters/${string}`;
  readonly semantics: string;
}

export interface NimiMigrationTargetEntry {
  readonly id: NimiAdapterSourceRootEntry['id'];
  readonly name: string;
  readonly semantics: string;
}

export interface NimiOwnerDecisionGateEntry {
  readonly id:
    | 'adapter-public-package-names'
    | 'openai-compatible-api-boundary'
    | 'core-ai-substrate-dependency'
    | 'public-interface-uncertainty';
  readonly name: string;
  readonly semantics: string;
}

export const NIMI_TYPESCRIPT_TARGET_EXPORTS = [
  {
    id: 'root',
    owner: 'sdks/typescript/index',
    semantics: 'Root developer-experience composition over vNext Runtime, Realm, App, AI runner, Contract, and Feature surfaces.',
  },
  {
    id: 'runtime',
    owner: 'sdks/typescript/runtime',
    semantics: 'Generated Runtime projection facade.',
  },
  {
    id: 'realm',
    owner: 'sdks/typescript/realm',
    semantics: 'Generated Realm projection facade.',
  },
  {
    id: 'types',
    owner: 'sdks/typescript/types',
    semantics: 'Shared public TypeScript core request, metadata, and error shape boundary.',
  },
  {
    id: 'app',
    owner: 'sdks/typescript/core/app',
    semantics: 'Third-party app identity, installation, scope, permission, binding, and ecosystem entry contracts.',
  },
  {
    id: 'contracts',
    owner: 'sdks/typescript/core/contracts',
    semantics: 'Nimi-native AI, Tool, Trace, and adapter contract types.',
  },
  {
    id: 'ai',
    owner: 'sdks/typescript/core/ai',
    semantics: 'Nimi-native AI consumption substrate.',
  },
  {
    id: 'ai-runner',
    owner: 'sdks/typescript/core/ai-runner',
    semantics: 'Framework-neutral AI runner facade.',
  },
  {
    id: 'testing',
    owner: 'sdks/typescript/core/testing',
    semantics: 'Contract harness, fake model, stream simulator, and golden assertions.',
  },
  {
    id: 'features-conversation',
    owner: 'sdks/typescript/features/conversation',
    semantics: 'Conversation projection, history windows, and UI-friendly events.',
  },
  {
    id: 'features-knowledge-context',
    owner: 'sdks/typescript/features/knowledge-context',
    semantics: 'Knowledge references, citations, and context parts.',
  },
  {
    id: 'features-memory-context',
    owner: 'sdks/typescript/features/memory-context',
    semantics: 'Memory snippets, summaries, and context windows.',
  },
  {
    id: 'features-generation',
    owner: 'sdks/typescript/features/generation',
    semantics: 'Media generation job and artifact helpers.',
  },
  {
    id: 'features-workflow',
    owner: 'sdks/typescript/features/workflow',
    semantics: 'Workflow events, checkpoints, graph handoff, and migration proof coverage.',
  },
  {
    id: 'features-evaluation',
    owner: 'sdks/typescript/features/evaluation',
    semantics: 'Golden runs, adapter parity, and trace assertions.',
  },
  {
    id: 'features-toolkits',
    owner: 'sdks/typescript/features/toolkits',
    semantics: 'Approval, external execution, artifact, file, and MCP tool helpers.',
  },
  {
    id: 'migration-proofs',
    owner: 'sdks/typescript/migration-proofs',
    semantics: 'External app migration proofs for adapter/model replacement and MingSim-shaped flows.',
  },
] as const satisfies readonly NimiTypescriptTargetExport[];

export const NIMI_CONTRACT_INVENTORY = [
  {
    id: 'NimiModelRef',
    owner: 'sdks/typescript/core/contracts',
    semantics: 'Stable model reference accepted by Nimi SDK and adapters.',
  },
  {
    id: 'NimiMessage',
    owner: 'sdks/typescript/core/contracts',
    semantics: 'Framework-neutral message shape.',
  },
  {
    id: 'NimiTool',
    owner: 'sdks/typescript/core/contracts',
    semantics: 'Tool schema, visibility, policy, executor, and adapter metadata.',
  },
  {
    id: 'NimiRunEvent',
    owner: 'sdks/typescript/core/contracts',
    semantics: 'Normalized run lifecycle, text, tool, warning, error, and trace events.',
  },
  {
    id: 'NimiAiTrace',
    owner: 'sdks/typescript/core/contracts',
    semantics: 'Run and step trace for debugging, evaluation, and adapter mapping.',
  },
  {
    id: 'NimiCapabilityManifest',
    owner: 'sdks/typescript/core/contracts',
    semantics: 'Manifest-driven target-library adapter capability support, ownership mode, capability level, and unsupported behavior.',
  },
] as const satisfies readonly NimiContractInventoryEntry[];

export const NIMI_ADAPTER_CAPABILITY_LEVELS = [
  { id: 'L0', name: 'Discovery', semantics: 'Adapter identity and explicit unsupported behavior.' },
  { id: 'L1', name: 'Generate', semantics: 'Text generation with model/provider identity.' },
  { id: 'L2', name: 'Stream', semantics: 'Text streaming and run-event visibility.' },
  { id: 'L3', name: 'Tools', semantics: 'Structured output, tools, approval, external execution, traces.' },
  { id: 'L4', name: 'Context', semantics: 'Memory and knowledge context integration.' },
  { id: 'L5', name: 'Workflow', semantics: 'Workflow checkpoint and migration proof coverage.' },
] as const satisfies readonly NimiAdapterCapabilityLevelEntry[];

export const NIMI_ADAPTER_SOURCE_ROOTS = [
  {
    id: 'vercel-ai',
    name: 'Vercel AI SDK',
    owner: 'sdks/typescript/adapters/vercel-ai',
    semantics: 'ProviderV3 and LanguageModelV3 adapter.',
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    owner: 'sdks/typescript/adapters/openai-compatible',
    semantics: 'Strict Chat Completions-compatible migration bridge.',
  },
  {
    id: 'mcp',
    name: 'MCP',
    owner: 'sdks/typescript/adapters/mcp',
    semantics: 'MCP tool/resource adapter; public package name remains owner-gated.',
  },
  {
    id: 'mastra',
    name: 'Mastra',
    owner: 'sdks/typescript/adapters/mastra',
    semantics: 'Agent framework adapter; public package name remains owner-gated.',
  },
  {
    id: 'langgraph',
    name: 'LangGraph',
    owner: 'sdks/typescript/adapters/langgraph',
    semantics: 'Graph workflow adapter; public package name remains owner-gated.',
  },
  {
    id: 'llamaindex',
    name: 'LlamaIndex',
    owner: 'sdks/typescript/adapters/llamaindex',
    semantics: 'Retrieval/query interop adapter; public package name remains owner-gated.',
  },
  {
    id: 'react',
    name: 'React',
    owner: 'sdks/typescript/adapters/react',
    semantics: 'Common React app framework adapter; public package name remains owner-gated.',
  },
  {
    id: 'next',
    name: 'Next',
    owner: 'sdks/typescript/adapters/next',
    semantics: 'Common Next app framework adapter; public package name remains owner-gated.',
  },
] as const satisfies readonly NimiAdapterSourceRootEntry[];

export const NIMI_MIGRATION_TARGETS = [
  { id: 'vercel-ai', name: 'Vercel AI SDK', semantics: 'First full adapter target.' },
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    semantics: 'Priority strict Chat Completions-compatible migration bridge.',
  },
  { id: 'mcp', name: 'MCP', semantics: 'Tool/resource adapter after event semantics are proven.' },
  {
    id: 'mastra',
    name: 'Mastra',
    semantics: 'Agent framework adapter after core AI runner contracts stabilize.',
  },
  {
    id: 'langgraph',
    name: 'LangGraph',
    semantics: 'Graph workflow adapter after workflow events stabilize.',
  },
  {
    id: 'llamaindex',
    name: 'LlamaIndex',
    semantics: 'Retrieval/query interop adapter after knowledge context stabilizes.',
  },
  {
    id: 'react',
    name: 'React',
    semantics: 'Common app framework adapter after feature event contracts stabilize.',
  },
  {
    id: 'next',
    name: 'Next',
    semantics: 'Common app framework adapter after feature event contracts stabilize.',
  },
] as const satisfies readonly NimiMigrationTargetEntry[];

export const NIMI_OWNER_DECISION_GATES = [
  {
    id: 'adapter-public-package-names',
    name: 'Adapter public package names',
    semantics: 'Final public names for external adapters.',
  },
  {
    id: 'openai-compatible-api-boundary',
    name: 'OpenAI-compatible API boundary',
    semantics: 'Resolved for v1 as strict Chat Completions-compatible migration bridge only.',
  },
  {
    id: 'core-ai-substrate-dependency',
    name: 'Core AI substrate dependency',
    semantics: 'Whether core AI may directly depend on Vercel AI SDK Core.',
  },
  {
    id: 'public-interface-uncertainty',
    name: 'Public interface uncertainty',
    semantics: 'Stop for owner decision on hard-to-change release promises.',
  },
] as const satisfies readonly NimiOwnerDecisionGateEntry[];

export function findNimiAdapterSourceRoot(adapterId: NimiAdapterSourceRootEntry['id']): NimiAdapterSourceRootEntry {
  const adapter = NIMI_ADAPTER_SOURCE_ROOTS.find((entry) => entry.id === adapterId);
  if (!adapter) {
    throw new Error(`unknown Nimi adapter source root: ${adapterId}`);
  }
  return adapter;
}
