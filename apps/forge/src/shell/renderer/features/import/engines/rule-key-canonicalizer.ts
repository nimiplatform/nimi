import type {
  AgentRuleLayer,
  WorldRuleDomain,
} from '../types.js';

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function normalizeSegments(value: string): string[] {
  return String(value || '')
    .split(/[:/]/)
    .map((segment) => slugify(segment))
    .filter(Boolean);
}

function layerPrefix(layer: AgentRuleLayer): string {
  switch (layer) {
    case 'DNA':
      return 'identity:self';
    case 'BEHAVIORAL':
      return 'behavior';
    case 'RELATIONAL':
      return 'relational';
    case 'CONTEXTUAL':
    default:
      return 'context';
  }
}

export function canonicalizeWorldRuleKey(input: {
  domain: WorldRuleDomain;
  suggestedRuleKey?: string;
  subjectKey?: string;
  semanticSlot?: string;
  title?: string;
}): string {
  const domainPrefix = slugify(input.domain);
  const suggestedSegments = normalizeSegments(input.suggestedRuleKey || '');
  const preferredSegments = suggestedSegments.length > 1
    ? suggestedSegments.slice(1)
    : suggestedSegments;
  const subjectSegments = normalizeSegments(input.subjectKey || '');
  const semanticSegments = normalizeSegments(input.semanticSlot || '');
  const titleSegments = normalizeSegments(input.title || '');
  const suffix = [
    ...subjectSegments.slice(0, 2),
    ...(semanticSegments.length > 0 ? semanticSegments : preferredSegments.length > 0 ? preferredSegments : titleSegments),
  ].filter(Boolean);

  return [domainPrefix, ...suffix.slice(0, 4)].join(':') || `${domainPrefix}:rule`;
}

export function canonicalizeAgentRuleKey(input: {
  layer: AgentRuleLayer;
  suggestedRuleKey?: string;
  semanticSlot?: string;
  title?: string;
}): string {
  const prefix = layerPrefix(input.layer);
  const suggestedSegments = normalizeSegments(input.suggestedRuleKey || '');
  const semanticSegments = normalizeSegments(input.semanticSlot || '');
  const titleSegments = normalizeSegments(input.title || '');
  const suffix = semanticSegments.length > 0
    ? semanticSegments
    : suggestedSegments.length > 1
      ? suggestedSegments.slice(-2)
      : suggestedSegments.length > 0
        ? suggestedSegments
        : titleSegments;

  return [prefix, ...suffix.slice(0, 3)].join(':') || `${prefix}:rule`;
}

export function canonicalizeHandleSeed(name: string): string {
  return slugify(name).slice(0, 32);
}
