import type { NimiJsonObject, NimiJsonValue, NimiTool } from '../../core/contracts';

export interface NimiToolExecutionContext {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly caller?: string;
  readonly metadata?: NimiJsonObject;
}

export interface NimiToolDescriptor extends Omit<NimiTool, 'execute'> {
  readonly hasLocalExecutor: boolean;
}

export interface NimiToolSelection {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface NimiToolCallInput {
  readonly toolName: string;
  readonly args?: NimiJsonValue;
  readonly approved?: boolean;
  readonly callId?: string;
  readonly context?: NimiToolExecutionContext;
}

export type NimiToolFailureReason =
  | 'tool-not-found'
  | 'approval-required'
  | 'external-execution-required'
  | 'executor-missing'
  | 'tool-failed';

export interface NimiToolCallSuccess {
  readonly ok: true;
  readonly toolName: string;
  readonly callId?: string;
  readonly result: NimiJsonValue;
  readonly requiresApproval: false;
  readonly externalExecutionRequired: false;
}

export interface NimiToolCallFailure {
  readonly ok: false;
  readonly toolName: string;
  readonly callId?: string;
  readonly reason: NimiToolFailureReason;
  readonly message: string;
  readonly requiresApproval: boolean;
  readonly externalExecutionRequired: boolean;
  readonly error?: unknown;
}

export type NimiToolCallResult = NimiToolCallSuccess | NimiToolCallFailure;

export interface NimiToolRegistry {
  list(): readonly NimiToolDescriptor[];
  get(name: string): NimiTool | undefined;
  select(selection?: NimiToolSelection): readonly NimiToolDescriptor[];
  execute(input: NimiToolCallInput): Promise<NimiToolCallResult>;
}

export function defineNimiTool(tool: NimiTool): NimiTool {
  const name = normalizeToolName(tool.name);
  if (!name) {
    throw new Error('Nimi tool name is required.');
  }
  const description = normalizeToolDescription(tool.description);
  if (!description) {
    throw new Error(`Nimi tool "${name}" description is required.`);
  }
  return {
    ...tool,
    name,
    description,
    inputSchema: tool.inputSchema ?? {},
  };
}

export function createNimiToolRegistry(tools: readonly NimiTool[]): NimiToolRegistry {
  const byName = new Map<string, NimiTool>();
  for (const tool of tools) {
    const normalized = defineNimiTool(tool);
    if (byName.has(normalized.name)) {
      throw new Error(`Duplicate Nimi tool "${normalized.name}".`);
    }
    byName.set(normalized.name, normalized);
  }

  const list = (): readonly NimiToolDescriptor[] => [...byName.values()].map(toNimiToolDescriptor);
  return {
    list,
    get: (name) => byName.get(normalizeToolName(name)),
    select: (selection) => selectNimiTools(list(), selection),
    execute: (input) => executeNimiToolCall(byName, input),
  };
}

export function selectNimiTools(
  tools: readonly NimiToolDescriptor[],
  selection: NimiToolSelection = {},
): readonly NimiToolDescriptor[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const excluded = new Set((selection.exclude ?? []).map(normalizeToolName));

  if (selection.include && selection.include.length > 0) {
    return selection.include.map((rawName) => {
      const name = normalizeToolName(rawName);
      const tool = byName.get(name);
      if (!tool) {
        throw new Error(`Included Nimi tool "${name}" is not registered.`);
      }
      if (excluded.has(name)) {
        throw new Error(`Nimi tool "${name}" cannot be both included and excluded.`);
      }
      return tool;
    });
  }

  return tools.filter((tool) => !excluded.has(tool.name));
}

export async function executeNimiToolCall(
  tools: ReadonlyMap<string, NimiTool> | NimiToolRegistry,
  input: NimiToolCallInput,
): Promise<NimiToolCallResult> {
  const toolName = normalizeToolName(input.toolName);
  const tool = 'get' in tools ? tools.get(toolName) : undefined;
  if (!tool) {
    return createToolFailure(toolName, {
      callId: input.callId,
      reason: 'tool-not-found',
      message: `Nimi tool "${toolName}" is not registered.`,
    });
  }

  if (tool.policy === 'approval-required' && input.approved !== true) {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'approval-required',
      message: `Nimi tool "${tool.name}" requires explicit approval.`,
      requiresApproval: true,
    });
  }

  if (tool.policy === 'external-execution') {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'external-execution-required',
      message: `Nimi tool "${tool.name}" requires external execution by the caller.`,
      externalExecutionRequired: true,
    });
  }

  if (!tool.execute) {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'executor-missing',
      message: `Nimi tool "${tool.name}" has no local executor.`,
    });
  }

  try {
    return {
      ok: true,
      toolName: tool.name,
      callId: input.callId,
      result: await tool.execute(input.args ?? {}),
      requiresApproval: false,
      externalExecutionRequired: false,
    };
  } catch (error) {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'tool-failed',
      message: error instanceof Error ? error.message : String(error),
      error,
    });
  }
}

export function createNimiApprovalTool(input: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: NimiJsonObject;
}): NimiTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema ?? {},
    policy: 'approval-required',
    visibility: 'model',
  };
}

export function createNimiExternalExecutionTool(input: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: NimiJsonObject;
}): NimiTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema ?? {},
    policy: 'external-execution',
    visibility: 'model',
  };
}

export function createNimiArtifactTool(input: {
  readonly name: string;
  readonly description: string;
  readonly artifactKind: string;
}): NimiTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: {
      artifactKind: input.artifactKind,
    },
    visibility: 'model',
  };
}

export function createNimiFileDescriptorTool(input: {
  readonly name: string;
  readonly description: string;
}): NimiTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: {
      path: { type: 'string' },
      mimeType: { type: 'string' },
    },
    visibility: 'model',
  };
}

export function createNimiMcpTool(input: {
  readonly name: string;
  readonly description: string;
  readonly serverId: string;
  readonly inputSchema?: NimiJsonObject;
}): NimiTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema ?? {},
    visibility: 'model',
    adapterMetadata: {
      kind: 'mcp',
      serverId: input.serverId,
    },
  };
}

export function createNimiConstantToolResult(value: NimiJsonValue): () => NimiJsonValue {
  return () => value;
}

function toNimiToolDescriptor(tool: NimiTool): NimiToolDescriptor {
  const { execute: _execute, ...descriptor } = tool;
  return {
    ...descriptor,
    hasLocalExecutor: typeof tool.execute === 'function',
  };
}

function createToolFailure(
  toolName: string,
  input: {
    readonly callId?: string;
    readonly reason: NimiToolFailureReason;
    readonly message: string;
    readonly requiresApproval?: boolean;
    readonly externalExecutionRequired?: boolean;
    readonly error?: unknown;
  },
): NimiToolCallFailure {
  return {
    ok: false,
    toolName,
    callId: input.callId,
    reason: input.reason,
    message: input.message,
    requiresApproval: input.requiresApproval ?? false,
    externalExecutionRequired: input.externalExecutionRequired ?? false,
    error: input.error,
  };
}

function normalizeToolName(value: string): string {
  return value.trim();
}

function normalizeToolDescription(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}
