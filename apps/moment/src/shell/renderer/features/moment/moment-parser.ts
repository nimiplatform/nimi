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

function extractObject(raw: string): Record<string, unknown> {
  const cleaned = stripFences(raw);
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('MOMENT_JSON_OBJECT_REQUIRED');
  }
  const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MOMENT_JSON_OBJECT_REQUIRED');
  }
  return parsed as Record<string, unknown>;
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
  const presence = normalizeText(record.presence);
  const mystery = normalizeText(record.mystery);
  const sceneSummary = normalizeText(record.sceneSummary || record.scene_summary);
  const actions = toActions(record.actions);
  if (!title || !opening || !presence || !mystery || !sceneSummary) {
    throw new Error('MOMENT_OPENING_FIELDS_REQUIRED');
  }
  return {
    title,
    opening,
    presence,
    mystery,
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
