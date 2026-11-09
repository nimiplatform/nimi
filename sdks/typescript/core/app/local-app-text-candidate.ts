import type { NimiLocalAppStandardShell, NimiLocalAppClient, NimiLocalAppTextCandidateInput, NimiLocalAppTextCandidateMessage, NimiLocalAppTextCandidateResult } from './local-app-runtime-platform.js';
import { asRecord, assertExactKeys, assertExactProjectionKeys, assertSafeProjection, localAppError, localAppProjectionError, projectionText, requireText } from './local-app-runtime-platform-validation.js';

const MAX_TEXT_CANDIDATE_MESSAGES = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES = 64 * 1024;
const MAX_TEXT_CANDIDATE_RESULT_BYTES = 256 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS = 4096;

export function createTextCandidateClient(
  shell: Pick<NimiLocalAppStandardShell['ai']['text'], 'generateCandidate'>,
): Pick<NimiLocalAppClient['ai']['text'], 'generateCandidate'> {
  return Object.freeze({
    generateCandidate: async (
      input: NimiLocalAppTextCandidateInput,
    ): Promise<NimiLocalAppTextCandidateResult> => {
      assertExactKeys(input, [
        'messages', 'temperature', 'topP', 'maxTokens',
      ], 'text candidate input');
      if (!Array.isArray(input.messages)
        || input.messages.length === 0
        || input.messages.length > MAX_TEXT_CANDIDATE_MESSAGES) {
        return localAppError(
          'Text candidate messages are invalid.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_bounded_text_candidate_messages',
        );
      }
      let promptBytes = 0;
      let sawSystem = false;
      let sawUser = false;
      const messages = input.messages.map((message, index): NimiLocalAppTextCandidateMessage => {
        assertExactKeys(message, ['role', 'text'], `text candidate message ${index}`);
        if (message.role === 'system') {
          if (sawSystem || sawUser) return invalidTextCandidateInput('system message order is invalid');
          sawSystem = true;
        } else if (message.role === 'user') {
          sawUser = true;
        } else {
          return invalidTextCandidateInput(`message ${index} role is invalid`);
        }
        const text = requireText(message.text, `text_candidate_message_${index}`);
        const textBytes = new TextEncoder().encode(text).byteLength;
        if (textBytes > MAX_TEXT_CANDIDATE_MESSAGE_BYTES) {
          return invalidTextCandidateInput(`message ${index} exceeds the byte bound`);
        }
        promptBytes += new TextEncoder().encode(message.role).byteLength + textBytes;
        if (promptBytes > MAX_TEXT_CANDIDATE_PROMPT_BYTES) {
          return invalidTextCandidateInput('messages exceed the prompt byte bound');
        }
        return Object.freeze({ role: message.role, text });
      });
      if (!sawUser) invalidTextCandidateInput('at least one user message is required');
      const temperature = optionalBoundedTextCandidateNumber(input.temperature, 0, 2, 'temperature');
      const topP = optionalBoundedTextCandidateNumber(input.topP, 0, 1, 'topP');
      const maxTokens = optionalBoundedTextCandidateInteger(input.maxTokens, 0, MAX_TEXT_CANDIDATE_TOKENS, 'maxTokens');
      const value = await shell.generateCandidate({
        messages: Object.freeze(messages),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { topP } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['text', 'finishReason', 'traceId'], 'text candidate');
      assertSafeProjection(record);
      const text = projectionUtf8Content(
        record.text,
        'text candidate text',
        MAX_TEXT_CANDIDATE_RESULT_BYTES,
      );
      const finishReason = projectionText(record.finishReason, 'text candidate finishReason');
      if (finishReason !== 'stop' && finishReason !== 'length' && finishReason !== 'content-filter') {
        localAppProjectionError('text candidate finishReason');
      }
      return Object.freeze({
        text,
        finishReason,
        traceId: projectionText(record.traceId, 'text candidate traceId'),
      });
    },
  });
}

function optionalBoundedTextCandidateNumber(
  value: number | undefined,
  minimum: number,
  maximum: number,
  field: string,
): number | undefined {
  return value === undefined ? undefined : boundedTextCandidateNumber(value, minimum, maximum, field);
}

function optionalBoundedTextCandidateInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalidTextCandidateInput(`${field} is invalid`);
  }
  return value;
}

function invalidTextCandidateInput(reason: string): never {
  return localAppError(
    `Text candidate input is invalid: ${reason}.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_exact_text_candidate_input',
  );
}

function boundedTextCandidateNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return invalidTextCandidateInput(`${field} is invalid`);
  }
  return value;
}

function projectionUtf8Content(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string'
    || !value.trim()
    || new TextEncoder().encode(value).byteLength > maxBytes) {
    localAppProjectionError(field);
  }
  return value;
}

