// JSON extraction and repair utilities for LLM output.
// Adapted from nimi-mods/runtime/local-chat/src/json-repair.ts for relay main process.

export function extractJsonFromText(text: string): string {
  const trimmed = text.trim();
  // Strategy 1: extract from markdown code fence anywhere in text
  const fenceMatch = trimmed.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/);
  const fencedJson = fenceMatch?.[1];
  if (fencedJson) return fencedJson.trim();
  // Strategy 2: find first { and last } to extract JSON object
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  if (firstBrace !== -1) {
    return trimmed.slice(firstBrace);
  }
  return trimmed;
}

/**
 * Attempt to repair common JSON issues from LLM output:
 * - Raw control chars inside strings: escape them
 * - Unterminated strings: close them
 * - Unclosed arrays/objects: close them
 * - Missing colon between object key and value
 * - Unquoted object keys: quote them
 * - Bare string values after colon: quote them
 * - Trailing commas before } or ]
 */
export function repairJson(text: string): string {
  let json = text;
  json = sanitizeJsonStringLiterals(json);
  json = balanceJsonContainers(json);
  json = insertMissingJsonKeySeparators(json);
  json = quoteBareJsonKeys(json);
  json = insertMissingJsonKeySeparators(json);
  json = quoteBareJsonValues(json);
  json = json.replace(/,\s*([}\]])/g, '$1');
  return json;
}

export function sanitizeJsonStringLiterals(text: string): string {
  let sanitized = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] || '';
    if (inString) {
      if (escaped) {
        if (ch === '\n') {
          sanitized += 'n';
          escaped = false;
          continue;
        }
        if (ch === '\r') {
          sanitized += 'r';
          escaped = false;
          continue;
        }
        if (ch === '\t') {
          sanitized += 't';
          escaped = false;
          continue;
        }
        sanitized += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        sanitized += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        sanitized += ch;
        inString = false;
        continue;
      }
      if (ch === '\n') {
        sanitized += '\\n';
        continue;
      }
      if (ch === '\r') {
        sanitized += '\\r';
        continue;
      }
      if (ch === '\t') {
        sanitized += '\\t';
        continue;
      }
      sanitized += ch;
      continue;
    }
    if (ch === '"') {
      sanitized += ch;
      inString = true;
      escaped = false;
      continue;
    }
    sanitized += ch;
  }
  if (inString) {
    if (escaped) {
      sanitized += '\\';
    }
    sanitized += '"';
  }
  return sanitized;
}

export function balanceJsonContainers(text: string): string {
  let json = text;
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }
  while (openBrackets > 0) {
    json += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    json += '}';
    openBraces--;
  }
  return json;
}

export function quoteBareJsonKeys(text: string): string {
  return text.replace(
    /([{,]\s*)([^"{\[\]},:\s][^:{},\[\]]*?)(\s*:)/g,
    (_match, prefix: string, key: string, suffix: string) =>
      `${prefix}${JSON.stringify(String(key || '').trim())}${suffix}`,
  );
}

export function insertMissingJsonKeySeparators(text: string): string {
  return text.replace(
    /([{,]\s*(?:"(?:\\.|[^"\\])*"|[A-Za-z_\u00C0-\uFFFF][\w\-\u00C0-\uFFFF]*))(\s+)(?=(?:"|[{[]|-?\d|true\b|false\b|null\b|[A-Za-z_\u00C0-\uFFFF]))/gu,
    (_match, property, whitespace) => `${property}:${whitespace}`,
  );
}

export function quoteBareJsonValues(text: string): string {
  return text.replace(
    /(:\s*)([^"{\[\]},\s][^,\]}]*)(?=\s*[,}\]])/g,
    (_match, prefix: string, rawValue: string) => {
      const value = String(rawValue || '').trim();
      if (!value) {
        return prefix;
      }
      if (/^(?:true|false|null)$/u.test(value)) {
        return `${prefix}${value}`;
      }
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(value)) {
        return `${prefix}${value}`;
      }
      return `${prefix}${JSON.stringify(value)}`;
    },
  );
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const extracted = extractJsonFromText(String(text || '').trim());
  if (!extracted) {
    throw new Error('RELAY_AI_GENERATE_OBJECT_EMPTY_TEXT');
  }
  // Try strict parse first
  try {
    const parsed = JSON.parse(extracted);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to repair attempt
  }
  // Try repaired parse
  const repaired = repairJson(extracted);
  const parsed = JSON.parse(repaired);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RELAY_AI_GENERATE_OBJECT_INVALID_JSON_OBJECT');
  }
  return parsed as Record<string, unknown>;
}
