import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from '../ai';
import {
  textPart,
  type NimiAgentTrace,
  type NimiJsonObject,
  type NimiJsonValue,
  type NimiMessage,
  type NimiMessagePart,
  type NimiTool,
} from '../contracts';
import type { NimiAgentContextMaterial, NimiAgentEvent, NimiAgentRunRequest, NimiAgentSpec } from './index';

export interface NimiAgentRunner {
  run(request: NimiAgentRunRequest): Promise<NimiAgentRunnerResult>;
}

export interface NimiAgentRunnerResult {
  readonly result: NimiGenerateTextResult;
  readonly request: NimiGenerateTextRequest;
  readonly events: readonly NimiAgentEvent[];
  readonly trace: NimiAgentTrace;
}

export function createNimiAgentRunner(): NimiAgentRunner {
  return {
    async run(request) {
      const modelRequest = await buildNimiAgentModelRequest(request.agent, request.model, request.messages);
      const events: NimiAgentEvent[] = [
        { type: 'agent-start', agentId: request.agent.id },
        {
          type: 'model-request',
          messageCount: modelRequest.messages.length,
          toolCount: modelRequest.tools?.length ?? 0,
        },
      ];

      const result = await request.model.generateText(modelRequest);
      appendModelResultEvents(events, result);
      await appendToolLifecycleEvents(events, result, request.agent.tools ?? []);
      events.push({ type: 'finish', finishReason: result.finishReason, usage: result.usage });

      return {
        result,
        request: modelRequest,
        events,
        trace: toNimiAgentTrace(request.agent.id, events),
      };
    },
  };
}

export async function buildNimiAgentModelRequest(
  agent: NimiAgentSpec,
  model: NimiAiModel,
  messages: readonly NimiMessage[],
): Promise<NimiGenerateTextRequest> {
  return {
    model: model.model,
    messages: [
      ...materializeInstructionMessages(agent),
      ...(await materializeContextMessages(agent)),
      ...messages,
    ],
    tools: agent.tools,
  };
}

function materializeInstructionMessages(agent: NimiAgentSpec): readonly NimiMessage[] {
  const instructions = [
    agent.instructions,
    ...(agent.instructionPacks?.map((pack) => pack.content) ?? []),
  ].filter((content): content is string => Boolean(content && content.trim()));

  if (instructions.length === 0) {
    return [];
  }

  return [
    {
      role: 'system',
      content: [textPart(instructions.join('\n\n'))],
    },
  ];
}

async function materializeContextMessages(agent: NimiAgentSpec): Promise<readonly NimiMessage[]> {
  const messages: NimiMessage[] = [];
  for (const provider of agent.contextProviders ?? []) {
    const material = await provider.load();
    messages.push(toContextMessage(material));
  }
  return messages;
}

function toContextMessage(material: NimiAgentContextMaterial): NimiMessage {
  if (typeof material === 'string') {
    return { role: 'user', content: [textPart(material)] };
  }
  if (isMessagePartArray(material)) {
    return { role: 'user', content: material };
  }
  if (isNimiMessage(material)) {
    return material;
  }
  if ('content' in material) {
    const role = material.role ?? 'user';
    return { role, content: [textPart(material.content)] };
  }
  return material;
}

function appendModelResultEvents(events: NimiAgentEvent[], result: NimiGenerateTextResult): void {
  const reasoning = extractReasoningText(result.raw);
  if (reasoning) {
    events.push({ type: 'reasoning', text: reasoning });
  }
  if (result.text) {
    events.push({ type: 'text', text: result.text });
  }
  for (const warning of result.warnings ?? []) {
    events.push({ type: 'warning', code: warning.code, message: warning.message });
  }
  for (const artifact of extractArtifacts(result.raw)) {
    events.push({ type: 'artifact', artifact });
  }
  for (const toolCall of result.toolCalls ?? []) {
    events.push({ type: 'tool-call', toolCall });
  }
}

async function appendToolLifecycleEvents(
  events: NimiAgentEvent[],
  result: NimiGenerateTextResult,
  tools: readonly NimiTool[],
): Promise<void> {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const toolCall of result.toolCalls ?? []) {
    const tool = toolsByName.get(toolCall.name);
    if (!tool) {
      events.push({ type: 'error', code: 'unknown_tool', message: `tool ${toolCall.name} was not registered` });
      continue;
    }
    if (tool.policy === 'approval-required') {
      events.push({ type: 'approval-requested', toolCall });
      continue;
    }
    if (tool.policy === 'external-execution') {
      events.push({ type: 'external-execution-requested', toolCall });
      continue;
    }
    if (!tool.execute) {
      events.push({ type: 'error', code: 'tool_executor_missing', message: `tool ${tool.name} does not expose execute` });
      continue;
    }
    try {
      const toolResult = await tool.execute(toolCall.arguments);
      events.push({ type: 'tool-result', toolCallId: toolCall.id, name: tool.name, result: toolResult });
    } catch (error) {
      events.push({
        type: 'error',
        code: 'tool_execution_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function toNimiAgentTrace(agentId: string, events: readonly NimiAgentEvent[]): NimiAgentTrace {
  return {
    traceId: `agent:${agentId}`,
    events: events.map(toRunEvent),
    steps: events.map((event, index) => ({
      id: `agent:${agentId}:${index}:${event.type}`,
      kind: agentEventStepKind(event),
      status: event.type === 'error' ? 'failed' : 'completed',
      input: agentEventInput(event),
    })),
  };
}

function toRunEvent(event: NimiAgentEvent) {
  if (event.type === 'text') {
    return { type: 'text-delta' as const, text: event.text };
  }
  if (event.type === 'tool-call') {
    return { type: 'tool-call' as const, toolCall: event.toolCall };
  }
  if (event.type === 'warning') {
    return { type: 'warning' as const, code: event.code, message: event.message };
  }
  if (event.type === 'error') {
    return { type: 'error' as const, code: event.code, message: event.message };
  }
  if (event.type === 'finish') {
    return { type: 'done' as const, finishReason: event.finishReason, usage: event.usage };
  }
  return { type: 'trace' as const, trace: { traceId: `event:${event.type}`, events: [], steps: [] } };
}

function agentEventStepKind(event: NimiAgentEvent): 'model' | 'tool' | 'approval' | 'external-execution' | 'workflow' {
  if (event.type === 'tool-call' || event.type === 'tool-result') {
    return 'tool';
  }
  if (event.type === 'approval-requested') {
    return 'approval';
  }
  if (event.type === 'external-execution-requested') {
    return 'external-execution';
  }
  if (event.type === 'model-request' || event.type === 'text' || event.type === 'reasoning') {
    return 'model';
  }
  return 'workflow';
}

function agentEventInput(event: NimiAgentEvent): NimiJsonValue {
  return JSON.parse(JSON.stringify(event)) as NimiJsonValue;
}

function extractReasoningText(raw: NimiJsonValue | undefined): string | undefined {
  if (!isJsonObject(raw)) {
    return undefined;
  }
  const reasoning = raw.reasoning ?? raw.reasoningText;
  return typeof reasoning === 'string' && reasoning.length > 0 ? reasoning : undefined;
}

function extractArtifacts(raw: NimiJsonValue | undefined): readonly NimiJsonObject[] {
  if (!isJsonObject(raw) || !Array.isArray(raw.artifacts)) {
    return [];
  }
  return raw.artifacts.filter(isJsonObject);
}

function isJsonObject(value: NimiJsonValue | undefined): value is NimiJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMessagePartArray(value: NimiAgentContextMaterial): value is readonly NimiMessagePart[] {
  return Array.isArray(value);
}

function isNimiMessage(value: NimiAgentContextMaterial): value is NimiMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray((value as { readonly content?: unknown }).content);
}
