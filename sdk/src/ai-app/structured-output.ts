export type AppAiStructuredOutputParseFailureReason =
  | 'json-missing'
  | 'json-invalid'
  | 'validation-failed';

export type AppAiStructuredOutputParseSuccess<TValue> = {
  ok: true;
  value: TValue;
  raw: string;
  jsonText: string;
};

export type AppAiStructuredOutputParseFailure = {
  ok: false;
  reason: AppAiStructuredOutputParseFailureReason;
  message: string;
  raw: string;
  jsonText?: string;
  error?: unknown;
};

export type AppAiStructuredOutputParseResult<TValue> =
  | AppAiStructuredOutputParseSuccess<TValue>
  | AppAiStructuredOutputParseFailure;

export type AppAiStructuredOutputRepairRequest = {
  reason: AppAiStructuredOutputParseFailure['reason'];
  message: string;
  originalText: string;
  jsonText?: string;
  instruction: string;
};

export type AppAiStructuredJsonParseInput<TValue> = {
  raw: string;
  validate?: (value: unknown) => TValue;
  expect?: 'object' | 'array' | 'json';
};

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : trimmed;
}

function findBalancedJsonCandidate(raw: string): string | undefined {
  const text = stripMarkdownFence(raw);
  let startIndex = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{' || char === '[') {
      startIndex = index;
      break;
    }
  }
  if (startIndex < 0) {
    return undefined;
  }

  const opening = text[startIndex];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === opening) {
      depth += 1;
      continue;
    }
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function matchesExpectedShape(value: unknown, expect: 'object' | 'array' | 'json'): boolean {
  if (expect === 'json') {
    return true;
  }
  if (expect === 'array') {
    return Array.isArray(value);
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAppAiStructuredJson<TValue = unknown>(
  input: AppAiStructuredJsonParseInput<TValue>,
): AppAiStructuredOutputParseResult<TValue> {
  const raw = input.raw;
  const jsonText = findBalancedJsonCandidate(raw);
  if (!jsonText) {
    return {
      ok: false,
      reason: 'json-missing',
      message: 'No balanced JSON object or array was found in the AI output.',
      raw,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      ok: false,
      reason: 'json-invalid',
      message: error instanceof Error ? error.message : 'AI output JSON could not be parsed.',
      raw,
      jsonText,
      error,
    };
  }

  const expect = input.expect ?? 'object';
  if (!matchesExpectedShape(parsed, expect)) {
    return {
      ok: false,
      reason: 'validation-failed',
      message: `AI output JSON did not match expected ${expect} shape.`,
      raw,
      jsonText,
    };
  }

  try {
    const value = input.validate ? input.validate(parsed) : parsed as TValue;
    return {
      ok: true,
      value,
      raw,
      jsonText,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'validation-failed',
      message: error instanceof Error ? error.message : 'AI output JSON validation failed.',
      raw,
      jsonText,
      error,
    };
  }
}

export function buildAppAiStructuredOutputRepairRequest(input: {
  failure: AppAiStructuredOutputParseFailure;
  originalText: string;
  instruction?: string;
}): AppAiStructuredOutputRepairRequest {
  const instruction = normalizeText(input.instruction)
    || 'Return only valid JSON matching the requested schema. Do not include markdown fences or explanatory prose.';
  return {
    reason: input.failure.reason,
    message: input.failure.message,
    originalText: input.originalText,
    jsonText: input.failure.jsonText,
    instruction,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
