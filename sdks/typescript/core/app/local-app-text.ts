import type { NimiResponseFormat, NimiGenerateTextRequest } from '../ai';
import type { NimiFunctionTool, NimiJsonValue, NimiTextOutputItem, NimiToolCall, NimiToolResult } from '../contracts';
import { asRecord, assertExactKeys, assertExactProjectionKeys, localAppError, localAppProjectionError } from './local-app-runtime-platform-validation';

export type NimiLocalAppFunctionTool = Pick<NimiFunctionTool, 'type' | 'name' | 'description' | 'inputSchema'>;
export type NimiLocalAppToolCall = Pick<NimiToolCall, 'id' | 'name' | 'arguments'>;
export type NimiLocalAppTextOutputItem =
  | Extract<NimiTextOutputItem, { readonly type: 'text' }>
  | { readonly type: 'tool-call'; readonly toolCall: NimiLocalAppToolCall };
export type NimiLocalAppTextTurnItem =
  | { readonly type: 'output'; readonly output: NimiLocalAppTextOutputItem }
  | { readonly type: 'tool-result'; readonly toolResult: Pick<NimiToolResult, 'toolCallId' | 'toolName' | 'result' | 'isError'> };
export type NimiLocalAppTextMessage = {
  readonly role: 'system' | 'user' | 'assistant';
  readonly text: string;
  readonly turnItems?: readonly NimiLocalAppTextTurnItem[];
};
export type NimiLocalAppTextTurnInput = {
  readonly messages: readonly NimiLocalAppTextMessage[];
  readonly tools?: readonly NimiLocalAppFunctionTool[];
  readonly toolChoice?: NimiGenerateTextRequest['toolChoice'];
  readonly responseFormat?: NimiResponseFormat;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stop?: readonly string[];
  readonly seed?: number;
};

function invalid(detail: string): never {
  return localAppError(`Local App text input is invalid: ${detail}.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_admitted_local_app_text_input');
}

function identifier(value: unknown, fail: (detail: string) => never): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || new TextEncoder().encode(value).byteLength > 128 || /[\u0000-\u001f\u007f]/u.test(value)) fail('tool identifier');
  return value as string;
}

function jsonValue(value: unknown, fail: (detail: string) => never, ancestors = new Set<object>(), depth = 0): asserts value is NimiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value || depth > 32 || ancestors.has(value)) fail('JSON value');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('JSON object');
  ancestors.add(value as object);
  for (const entry of Object.values(value as object)) jsonValue(entry, fail, ancestors, depth + 1);
  ancestors.delete(value as object);
}

function readToolCall(value: unknown, projection: boolean): NimiLocalAppToolCall {
  const fail = projection ? localAppProjectionError : invalid;
  const record = asRecord(value);
  if (!record) fail('tool call');
  if (projection) assertExactProjectionKeys(record, ['id', 'name', 'arguments'], 'tool call');
  else assertExactKeys(record, ['id', 'name', 'arguments'], 'tool call');
  const id = identifier(record.id, fail);
  const name = identifier(record.name, fail);
  if (!asRecord(record.arguments) || Array.isArray(record.arguments)) fail('tool arguments object');
  jsonValue(record.arguments, fail);
  return Object.freeze({ id, name, arguments: record.arguments as NimiJsonValue });
}

export function projectLocalAppToolCall(value: unknown): NimiLocalAppToolCall {
  return readToolCall(value, true);
}

function readOutputItem(value: unknown, projection: boolean): NimiLocalAppTextOutputItem {
  const fail = projection ? localAppProjectionError : invalid;
  const record = asRecord(value);
  if (!record) return fail('text output item');
  const keys = record.type === 'text' ? ['type', 'text'] : ['type', 'toolCall'];
  if (projection) assertExactProjectionKeys(record, keys, 'text output item');
  else assertExactKeys(record, keys, 'text output item');
  if (record.type === 'text' && typeof record.text === 'string' && record.text.length > 0) {
    return Object.freeze({ type: 'text', text: record.text });
  }
  if (record.type === 'tool-call') return Object.freeze({ type: 'tool-call', toolCall: readToolCall(record.toolCall, projection) });
  return fail('unsupported text output item');
}

export function projectLocalAppTextItems(value: unknown): readonly NimiLocalAppTextOutputItem[] {
  if (!Array.isArray(value) || value.length === 0) localAppProjectionError('text output items');
  const ids = new Set<string>();
  const items = value.map((item) => {
    const projected = readOutputItem(item, true);
    if (projected.type === 'tool-call') {
      if (ids.has(projected.toolCall.id)) localAppProjectionError('duplicate tool call');
      ids.add(projected.toolCall.id);
    }
    return projected;
  });
  if (new TextEncoder().encode(JSON.stringify(items)).byteLength > 256 * 1024) localAppProjectionError('text output size');
  return Object.freeze(items);
}

// Arbitrary schema and result keys are business JSON, never identity selectors.
// Only the surrounding exact typed envelopes carry protocol fields.
// @nimi-authority: rule.nimi.sdks.feature-clients.local-app-text-behaviors
export function validateLocalAppTextInput(value: unknown): NimiLocalAppTextTurnInput {
  assertExactKeys(value, ['messages', 'tools', 'toolChoice', 'responseFormat', 'temperature', 'topP', 'maxTokens', 'topK', 'presencePenalty', 'frequencyPenalty', 'stop', 'seed'], 'text-turn input');
  const input = value as unknown as NimiLocalAppTextTurnInput;
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > 128) invalid('messages');
  if (input.tools !== undefined && (!Array.isArray(input.tools) || input.tools.length > 64)) invalid('tools');
  const tools = new Set<string>();
  for (const tool of input.tools ?? []) {
    assertExactKeys(tool, ['type', 'name', 'description', 'inputSchema'], 'function tool');
    const name = identifier(tool.name, invalid);
    if (tools.has(name) || (tool.type !== undefined && tool.type !== 'function') || !asRecord(tool.inputSchema)
      || Array.isArray(tool.inputSchema) || (tool.description !== undefined && typeof tool.description !== 'string')) invalid('function tool');
    jsonValue(tool.inputSchema, invalid);
    tools.add(name);
  }
  const calls = new Map<string, string>();
  let sawUser = false;
  const messages = input.messages.map((message, index): NimiLocalAppTextMessage => {
    assertExactKeys(message, ['role', 'text', 'turnItems'], 'text message');
    const role = message.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') invalid('message role');
    if (role === 'system' && index !== 0) invalid('message role');
    if (typeof message.text !== 'string') invalid('message text');
    if (message.role === 'user') sawUser = true;
    if (message.turnItems !== undefined && !Array.isArray(message.turnItems)) invalid('ordered transcript');
    if (!message.turnItems?.length) {
      if (!message.text.trim()) invalid('empty message');
      return Object.freeze({ role, text: message.text });
    }
    if (message.role !== 'assistant' || message.text !== '') invalid('mixed transcript content');
    const turnItems = message.turnItems.map((item): NimiLocalAppTextTurnItem => {
      if (!asRecord(item)) invalid('turn item');
      if (item.type === 'output') {
        assertExactKeys(item, ['type', 'output'], 'output turn item');
        const output = readOutputItem(item.output, false);
        if (output.type === 'tool-call') {
          if (!tools.has(output.toolCall.name) || calls.has(output.toolCall.id)) invalid('undeclared or duplicate tool call');
          calls.set(output.toolCall.id, output.toolCall.name);
        }
        return Object.freeze({ type: 'output', output });
      }
      if (item.type !== 'tool-result') invalid('turn item');
      assertExactKeys(item, ['type', 'toolResult'], 'tool result turn item');
      const result = item.toolResult;
      assertExactKeys(result, ['toolCallId', 'toolName', 'result', 'isError'], 'tool result');
      const toolCallId = identifier(result.toolCallId, invalid);
      const toolName = identifier(result.toolName, invalid);
      if (calls.get(toolCallId) !== toolName) invalid('tool result association');
      if (result.isError !== undefined && typeof result.isError !== 'boolean') invalid('tool result status');
      jsonValue(result.result, invalid);
      return Object.freeze({ type: 'tool-result', toolResult: Object.freeze({ toolCallId, toolName, result: result.result, ...(result.isError === undefined ? {} : { isError: result.isError }) }) });
    });
    return Object.freeze({ role: 'assistant', text: '', turnItems: Object.freeze(turnItems) });
  });
  if (!sawUser) invalid('user message required');
  const choice = input.toolChoice;
  if (typeof choice === 'object' && choice !== null) {
    assertExactKeys(choice, ['type', 'name'], 'tool choice');
    if (choice.type !== 'tool' || !tools.has(choice.name)) invalid('named tool choice');
  } else if (choice !== undefined && (!['auto', 'none', 'required'].includes(choice) || (choice !== 'none' && tools.size === 0))) invalid('tool choice');
  if (input.responseFormat !== undefined) {
    const format = input.responseFormat;
    assertExactKeys(format, ['type', 'schema', 'name', 'description', 'strict'], 'response format');
    if (!['text', 'json-object', 'json-schema'].includes(format.type)
      || (format.name !== undefined && typeof format.name !== 'string')
      || (format.description !== undefined && typeof format.description !== 'string')
      || (format.strict !== undefined && typeof format.strict !== 'boolean')) invalid('response format');
    if (format.type === 'json-schema') {
      if (!asRecord(format.schema) || Array.isArray(format.schema)) invalid('response schema');
      jsonValue(format.schema, invalid);
    } else if (format.schema !== undefined || format.strict) invalid('response schema mode');
  }
  const bounds: readonly [unknown, number, number, boolean][] = [
    [input.temperature, 0, 2, false], [input.topP, 0, 1, false],
    [input.maxTokens, 0, 2_147_483_647, true], [input.topK, 0, 2_147_483_647, true],
    [input.presencePenalty, -2, 2, false], [input.frequencyPenalty, -2, 2, false],
    [input.seed, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true],
  ];
  for (const [value, minimum, maximum, integer] of bounds) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value)))) invalid('sampling parameter');
  }
  if (input.stop !== undefined && (!Array.isArray(input.stop) || input.stop.some((s) => typeof s !== 'string' || !s.trim()))) invalid('stop');
  const normalized = { ...input, messages };
  const serialized = JSON.stringify(normalized);
  if (new TextEncoder().encode(serialized).byteLength > 1024 * 1024) invalid('request size');
  return Object.freeze(JSON.parse(serialized) as NimiLocalAppTextTurnInput);
}
