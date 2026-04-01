import type { MomentContinuationBeat, MomentRelationState, MomentStoryOpening } from './types.js';

const RELATION_STATES: MomentRelationState[] = [
  'distant',
  'approaching',
  'noticed',
  'addressed',
  'involved',
];

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function stripFences(raw: string): string {
  return raw
    .replace(/^```json\s*/iu, '')
    .replace(/^```\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();
}

function extractJsonFromText(raw: string): string {
  const cleaned = stripFences(raw);
  const fencedMatch = cleaned.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/u);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).trim();
  }
  if (firstBrace >= 0) {
    return cleaned.slice(firstBrace).trim();
  }
  return cleaned;
}

function sanitizeJsonStringLiterals(text: string): string {
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

function balanceJsonContainers(text: string): string {
  let json = text;
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i += 1) {
    const ch = json[i] || '';
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
    if (inString) {
      continue;
    }
    if (ch === '{') {
      openBraces += 1;
    } else if (ch === '}') {
      openBraces -= 1;
    } else if (ch === '[') {
      openBrackets += 1;
    } else if (ch === ']') {
      openBrackets -= 1;
    }
  }

  while (openBrackets > 0) {
    json += ']';
    openBrackets -= 1;
  }
  while (openBraces > 0) {
    json += '}';
    openBraces -= 1;
  }
  return json;
}

function quoteBareJsonKeys(text: string): string {
  return text.replace(
    /([{,]\s*)([^"{\[\]},:\s][^:{},\[\]]*?)(\s*:)/g,
    (_match, prefix: string, key: string, suffix: string) =>
      `${prefix}${JSON.stringify(String(key || '').trim())}${suffix}`,
  );
}

function insertMissingJsonKeySeparators(text: string): string {
  return text.replace(
    /([{,]\s*(?:"(?:\\.|[^"\\])*"|[A-Za-z_\u00C0-\uFFFF][\w\-\u00C0-\uFFFF]*))(\s+)(?=(?:"|[{[]|-?\d|true\b|false\b|null\b|[A-Za-z_\u00C0-\uFFFF]))/gu,
    (_match, property, whitespace) => `${property}:${whitespace}`,
  );
}

function quoteBareJsonValues(text: string): string {
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

function repairJson(text: string): string {
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

function extractObject(raw: string): Record<string, unknown> {
  const extracted = extractJsonFromText(raw);
  if (!extracted) {
    throw new Error('MOMENT_JSON_OBJECT_REQUIRED');
  }

  try {
    const parsed = JSON.parse(extracted) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to repair attempt.
  }

  try {
    const repaired = repairJson(extracted);
    const parsed = JSON.parse(repaired) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fail closed below.
  }

  throw new Error('MOMENT_JSON_OBJECT_REQUIRED');
}

function toActions(value: unknown): [string, string, string] {
  if (!Array.isArray(value)) {
    throw new Error('MOMENT_ACTIONS_REQUIRED');
  }
  const actions = value
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .slice(0, 3);
  if (actions.length !== 3) {
    throw new Error('MOMENT_ACTIONS_REQUIRED');
  }
  return [actions[0]!, actions[1]!, actions[2]!];
}

function toRelationState(value: unknown): MomentRelationState {
  const normalized = normalizeText(value).toLowerCase();
  if (RELATION_STATES.includes(normalized as MomentRelationState)) {
    return normalized as MomentRelationState;
  }
  return 'distant';
}

export function parseStoryOpening(raw: string, traceId?: string): MomentStoryOpening {
  const record = extractObject(raw);
  const title = normalizeText(record.title);
  const opening = normalizeText(record.opening);
  const sceneSummary = normalizeText(record.sceneSummary || record.scene_summary);
  const actions = toActions(record.actions);
  if (!title || !opening || !sceneSummary) {
    throw new Error('MOMENT_OPENING_FIELDS_REQUIRED');
  }
  return {
    title,
    opening,
    sceneSummary,
    actions,
    relationState: toRelationState(record.relationState || record.relation_state),
    traceId,
  };
}

export function parseContinuationBeat(raw: string, input: { userLine: string; traceId?: string }): MomentContinuationBeat {
  const record = extractObject(raw);
  const storyBeat = normalizeText(record.storyBeat || record.story_beat || record.beat);
  const actions = toActions(record.actions);
  if (!storyBeat) {
    throw new Error('MOMENT_CONTINUATION_FIELDS_REQUIRED');
  }
  return {
    userLine: input.userLine,
    storyBeat,
    actions,
    relationState: toRelationState(record.relationState || record.relation_state),
    traceId: input.traceId,
  };
}
