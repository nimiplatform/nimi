import { asRecord, normalizeText } from './helpers.js';
import type { RuntimeAgentMessage } from './types-runtime-modules.js';

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function optionalContentString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseTranscript(value: unknown): RuntimeAgentMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const transcript = value.flatMap((item) => {
    const payload = asRecord(item);
    const role = normalizeText(payload.role) as RuntimeAgentMessage['role'] | '';
    const content = optionalContentString(payload.content);
    const name = optionalString(payload.name);
    if (!role || content === undefined) {
      return [];
    }
    return [{
      role,
      content,
      ...(name ? { name } : {}),
    }];
  });
  return transcript.length > 0 ? transcript : undefined;
}
