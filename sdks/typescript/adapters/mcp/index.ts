import type {
  NimiCapabilityManifest,
  NimiFunctionTool,
  NimiJsonObject,
  NimiJsonValue,
  NimiRunEvent,
  NimiTool,
} from '../../core/contracts';

export const NIMI_MCP_ADAPTER_ID = 'mcp' as const;
export const NIMI_MCP_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

export const NIMI_MCP_ADAPTER_MANIFEST = {
  adapterId: NIMI_MCP_ADAPTER_ID,
  targetLibrary: 'MCP',
  targetVersionRange: 'structural-tools-v1',
  capabilityLevel: 'L2',
  capabilities: {
    'mcp.tools.list': { support: 'supported', mode: 'adapter-mapped' },
    'mcp.tools.call.auto': {
      support: 'unsupported',
      mode: 'owner-gated',
      note: 'Tool execution must route through the Runtime delegated gateway/firewall; the SDK adapter does not execute local tools.',
    },
    'mcp.runEvents': { support: 'supported', mode: 'adapter-mapped' },
    'mcp.resources': { support: 'unsupported', mode: 'adapter-mapped' },
    approval: { support: 'unsupported', mode: 'owner-gated' },
    externalExecution: { support: 'unsupported', mode: 'owner-gated' },
    workflowCheckpoint: { support: 'not-applicable', mode: 'out-of-domain' },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export interface NimiMcpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: NimiJsonObject;
}

export interface NimiMcpToolCallRequest {
  readonly name: string;
  readonly arguments?: NimiJsonValue;
}

export interface NimiMcpToolCallResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent?: NimiJsonValue;
}

export type NimiMcpRunEventNotification =
  | { readonly method: 'notifications/message'; readonly params: { readonly level: 'info'; readonly data: string } }
  | { readonly method: 'notifications/progress'; readonly params: { readonly progressToken: string; readonly progress: number; readonly total?: number } }
  | { readonly method: 'notifications/cancelled'; readonly params: { readonly reason: string } };

export class NimiMcpUnsupportedFeatureError extends Error {
  readonly code = NIMI_MCP_UNSUPPORTED_FEATURE_CODE;
  readonly feature: string;

  constructor(feature: string, detail?: string) {
    super(detail ? `${feature}: ${detail}` : feature);
    this.name = 'NimiMcpUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedMcpFeature(feature: string, detail?: string): never {
  throw new NimiMcpUnsupportedFeatureError(feature, detail);
}

export interface NimiMcpAdapter {
  readonly manifest: typeof NIMI_MCP_ADAPTER_MANIFEST;
  listTools(): readonly NimiMcpToolDefinition[];
  callTool(request: NimiMcpToolCallRequest): Promise<NimiMcpToolCallResult>;
  runEventNotifications(events: readonly NimiRunEvent[], progressToken?: string): readonly NimiMcpRunEventNotification[];
}

export function createNimiMcpAdapter(options: { readonly tools: readonly NimiTool[] }): NimiMcpAdapter {
  const tools = options.tools.map((tool) => requireMcpFunctionTool(tool));
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    manifest: NIMI_MCP_ADAPTER_MANIFEST,
    listTools() {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    async callTool(request) {
      const tool = toolsByName.get(request.name);
      if (!tool) {
        throwUnsupportedMcpFeature('mcp.tools.call.unknown_tool', request.name);
      }
      throwUnsupportedMcpFeature('mcp.tools.call.runtime_delegation_required', tool.name);
    },
    runEventNotifications(events, progressToken = 'nimi-run') {
      return toMcpRunEventNotifications(events, progressToken);
    },
  };
}

function requireMcpFunctionTool(tool: NimiTool): NimiFunctionTool {
  if (tool.type === 'provider') {
    throwUnsupportedMcpFeature('mcp.tools.providerDefined', 'provider tools cannot be exposed as MCP local tools');
  }
  return tool;
}

export function toMcpRunEventNotifications(
  events: readonly NimiRunEvent[],
  progressToken = 'nimi-run',
): readonly NimiMcpRunEventNotification[] {
  const notifications: NimiMcpRunEventNotification[] = [];
  let progress = 0;

  for (const event of events) {
    if (event.type === 'text-delta') {
      progress += 1;
      notifications.push({
        method: 'notifications/message',
        params: { level: 'info', data: event.text },
      });
      notifications.push({
        method: 'notifications/progress',
        params: { progressToken, progress },
      });
    } else if (event.type === 'tool-call') {
      notifications.push({
        method: 'notifications/message',
        params: { level: 'info', data: `tool:${event.toolCall.name}` },
      });
    } else if (event.type === 'error') {
      notifications.push({
        method: 'notifications/cancelled',
        params: { reason: `${event.code}: ${event.message}` },
      });
    }
  }

  return notifications;
}
