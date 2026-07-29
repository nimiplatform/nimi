const REQUEST_ID_PATTERN = /^chat-ai-[1-9][0-9]{0,15}$/u;

export const CHAT_AI_COMMANDS = [
  'chat_ai_list_threads',
  'chat_ai_get_thread_bundle',
  'chat_ai_create_thread',
  'chat_ai_update_thread_metadata',
  'chat_ai_create_message',
  'chat_ai_update_message',
  'chat_ai_get_draft',
  'chat_ai_put_draft',
  'chat_ai_delete_draft',
] as const;

export type ChatAiCommand = typeof CHAT_AI_COMMANDS[number];

const COMMAND_SET: ReadonlySet<string> = new Set(CHAT_AI_COMMANDS);

export type ChatAiStoreWorkerRequest = {
  readonly id: string;
  readonly command: ChatAiCommand;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly selectedDataRoot: string;
};

export type ChatAiStoreWorkerResponse =
  | {
      readonly id: string;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly id: string;
      readonly ok: false;
      readonly error: string;
    };

export function parseChatAiStoreWorkerRequest(value: unknown): ChatAiStoreWorkerRequest {
  const record = exactRecord(
    value,
    ['command', 'id', 'payload', 'selectedDataRoot'],
    'chat-ai-store-worker-request-invalid',
  );
  const id = parseRequestId(record.id);
  const command = parseCommand(record.command);
  const payload = record.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('chat-ai-store-worker-request-invalid');
  }
  if (typeof record.selectedDataRoot !== 'string' || !record.selectedDataRoot.trim()) {
    throw new Error('chat-ai-store-worker-request-invalid');
  }
  return {
    id,
    command,
    payload: payload as Readonly<Record<string, unknown>>,
    selectedDataRoot: record.selectedDataRoot,
  };
}

export function parseChatAiStoreWorkerResponse(value: unknown): ChatAiStoreWorkerResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('chat-ai-store-worker-response-invalid');
  }
  const record = value as Readonly<Record<string, unknown>>;
  const id = parseRequestId(record.id);
  if (record.ok === true) {
    const exact = exactRecord(
      value,
      ['id', 'ok', 'value'],
      'chat-ai-store-worker-response-invalid',
    );
    return { id, ok: true, value: exact.value };
  }
  if (record.ok === false) {
    const exact = exactRecord(
      value,
      ['error', 'id', 'ok'],
      'chat-ai-store-worker-response-invalid',
    );
    if (
      typeof exact.error !== 'string'
      || !exact.error
      || exact.error.length > 8_192
    ) {
      throw new Error('chat-ai-store-worker-response-invalid');
    }
    return { id, ok: false, error: exact.error };
  }
  throw new Error('chat-ai-store-worker-response-invalid');
}

export function boundedChatAiStoreWorkerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.trim().slice(0, 8_192) || 'chat-ai-store-operation-failed';
}

function parseRequestId(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    throw new Error('chat-ai-store-worker-message-id-invalid');
  }
  return value;
}

function parseCommand(value: unknown): ChatAiCommand {
  if (typeof value !== 'string' || !COMMAND_SET.has(value)) {
    throw new Error('chat-ai-store-worker-command-invalid');
  }
  return value as ChatAiCommand;
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  error: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(error);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(error);
  }
  return record;
}
