export type AppAiToolParametersSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: readonly string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type AppAiToolExecutionContext = {
  runId?: string;
  sessionId?: string;
  caller?: string;
  metadata?: Record<string, unknown>;
};

export type AppAiToolExecutor<TArgs, TResult> = (
  args: TArgs,
  context: AppAiToolExecutionContext,
) => TResult | Promise<TResult>;

export type AppAiToolDefinition<TArgs = unknown, TResult = unknown> = {
  name: string;
  description: string;
  parameters?: AppAiToolParametersSchema;
  instructions?: string;
  requiresApproval?: boolean;
  externalExecutionRequired?: boolean;
  stopAfterCall?: boolean;
  showResult?: boolean;
  metadata?: Record<string, unknown>;
  execute?: AppAiToolExecutor<TArgs, TResult>;
};

export type AppAiToolDescriptor = Omit<AppAiToolDefinition, 'execute'> & {
  hasLocalExecutor: boolean;
};

export type AppAiToolSelection = {
  include?: readonly string[];
  exclude?: readonly string[];
};

export type AppAiToolCallInput = {
  toolName: string;
  args?: unknown;
  approved?: boolean;
  callId?: string;
  context?: AppAiToolExecutionContext;
};

export type AppAiToolFailureReason =
  | 'tool-not-found'
  | 'approval-required'
  | 'external-execution-required'
  | 'executor-missing'
  | 'tool-failed';

export type AppAiToolCallSuccess<TResult = unknown> = {
  ok: true;
  toolName: string;
  callId?: string;
  result: TResult;
  requiresApproval: false;
  externalExecutionRequired: false;
  stopAfterCall: boolean;
  showResult: boolean;
};

export type AppAiToolCallFailure = {
  ok: false;
  toolName: string;
  callId?: string;
  reason: AppAiToolFailureReason;
  message: string;
  requiresApproval: boolean;
  externalExecutionRequired: boolean;
  stopAfterCall: boolean;
  showResult: boolean;
  error?: unknown;
};

export type AppAiToolCallResult<TResult = unknown> =
  | AppAiToolCallSuccess<TResult>
  | AppAiToolCallFailure;

export type AppAiToolRegistry = {
  list: () => AppAiToolDescriptor[];
  get: (name: string) => AppAiToolDefinition | undefined;
  select: (selection?: AppAiToolSelection) => AppAiToolDescriptor[];
  execute: (input: AppAiToolCallInput) => Promise<AppAiToolCallResult>;
};

function normalizeToolName(value: string): string {
  return value.trim();
}

function normalizeDescription(value: string): string {
  return value.trim();
}

function toDescriptor(tool: AppAiToolDefinition): AppAiToolDescriptor {
  const { execute: _execute, ...descriptor } = tool;
  return {
    ...descriptor,
    hasLocalExecutor: typeof tool.execute === 'function',
  };
}

function createToolFailure(
  toolName: string,
  input: {
    callId?: string;
    reason: AppAiToolFailureReason;
    message: string;
    requiresApproval?: boolean;
    externalExecutionRequired?: boolean;
    stopAfterCall?: boolean;
    showResult?: boolean;
    error?: unknown;
  },
): AppAiToolCallFailure {
  return {
    ok: false,
    toolName,
    callId: input.callId,
    reason: input.reason,
    message: input.message,
    requiresApproval: input.requiresApproval ?? false,
    externalExecutionRequired: input.externalExecutionRequired ?? false,
    stopAfterCall: input.stopAfterCall ?? false,
    showResult: input.showResult ?? false,
    error: input.error,
  };
}

export function defineAppAiTool<TArgs = unknown, TResult = unknown>(
  input: AppAiToolDefinition<TArgs, TResult>,
): AppAiToolDefinition<TArgs, TResult> {
  const name = normalizeToolName(input.name);
  const description = normalizeDescription(input.description);
  if (!name) {
    throw new Error('App AI tool name is required.');
  }
  if (!description) {
    throw new Error(`App AI tool "${name}" description is required.`);
  }
  return {
    ...input,
    name,
    description,
    requiresApproval: input.requiresApproval === true,
    externalExecutionRequired: input.externalExecutionRequired === true,
    stopAfterCall: input.stopAfterCall === true,
    showResult: input.showResult === true,
  };
}

export function createAppAiToolRegistry(
  tools: readonly AppAiToolDefinition[],
): AppAiToolRegistry {
  const byName = new Map<string, AppAiToolDefinition>();
  for (const tool of tools) {
    const normalized = defineAppAiTool(tool);
    if (byName.has(normalized.name)) {
      throw new Error(`Duplicate App AI tool "${normalized.name}".`);
    }
    byName.set(normalized.name, normalized);
  }

  const listTools = (): AppAiToolDescriptor[] => [...byName.values()].map(toDescriptor);

  return {
    list: listTools,
    get: (name) => byName.get(normalizeToolName(name)),
    select: (selection = {}) => selectAppAiTools(listTools(), selection),
    execute: async (input) => executeAppAiToolCall(byName, input),
  };
}

export function selectAppAiTools(
  tools: readonly AppAiToolDescriptor[],
  selection: AppAiToolSelection = {},
): AppAiToolDescriptor[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const excluded = new Set((selection.exclude ?? []).map(normalizeToolName));

  if (selection.include && selection.include.length > 0) {
    return selection.include.map((rawName) => {
      const name = normalizeToolName(rawName);
      const tool = byName.get(name);
      if (!tool) {
        throw new Error(`Included App AI tool "${name}" is not registered.`);
      }
      if (excluded.has(name)) {
        throw new Error(`App AI tool "${name}" cannot be both included and excluded.`);
      }
      return tool;
    });
  }

  return tools.filter((tool) => !excluded.has(tool.name));
}

export async function executeAppAiToolCall(
  tools: ReadonlyMap<string, AppAiToolDefinition> | AppAiToolRegistry,
  input: AppAiToolCallInput,
): Promise<AppAiToolCallResult> {
  const toolName = normalizeToolName(input.toolName);
  const tool = 'get' in tools ? tools.get(toolName) : undefined;
  if (!tool) {
    return createToolFailure(toolName, {
      callId: input.callId,
      reason: 'tool-not-found',
      message: `App AI tool "${toolName}" is not registered.`,
    });
  }

  const stopAfterCall = tool.stopAfterCall === true;
  const showResult = tool.showResult === true;

  if (tool.requiresApproval && input.approved !== true) {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'approval-required',
      message: `App AI tool "${tool.name}" requires explicit approval.`,
      requiresApproval: true,
      stopAfterCall,
      showResult,
    });
  }

  if (tool.externalExecutionRequired) {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'external-execution-required',
      message: `App AI tool "${tool.name}" requires external execution by the caller.`,
      externalExecutionRequired: true,
      stopAfterCall,
      showResult,
    });
  }

  if (!tool.execute) {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'executor-missing',
      message: `App AI tool "${tool.name}" has no local executor.`,
      stopAfterCall,
      showResult,
    });
  }

  try {
    const result = await tool.execute(input.args, input.context ?? {});
    return {
      ok: true,
      toolName: tool.name,
      callId: input.callId,
      result,
      requiresApproval: false,
      externalExecutionRequired: false,
      stopAfterCall,
      showResult,
    };
  } catch (error) {
    return createToolFailure(tool.name, {
      callId: input.callId,
      reason: 'tool-failed',
      message: error instanceof Error ? error.message : `App AI tool "${tool.name}" failed.`,
      stopAfterCall,
      showResult,
      error,
    });
  }
}
