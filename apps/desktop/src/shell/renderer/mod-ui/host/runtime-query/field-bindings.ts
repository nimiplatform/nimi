import type { UiExtensionContext } from '@renderer/mod-ui/contracts';
import type { ActionDefinition, QueryResultsMap, SelectedIndexMap } from './types';

const ALLOWLIST_RUNTIME_FIELDS = new Set([
  'targetType',
  'targetAccountId',
  'agentId',
  'worldId',
  'provider',
  'localProviderEndpoint',
  'localProviderModel',
  'localOpenAiEndpoint',
  'localOpenAiApiKey',
  'mode',
  'turnIndex',
  'userConfirmedUpload',
]);

export function readPathValue(source: unknown, path: string): unknown {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    return undefined;
  }
  const segments = normalizedPath.split('.').map((item) => item.trim()).filter(Boolean);
  let cursor: unknown = source;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export function summarizeRecord(record: Record<string, unknown>, index: number): string {
  const candidates = [
    record.id,
    record.name,
    record.label,
    record.handle,
    readPathValue(record, 'agent.displayName'),
    readPathValue(record, 'provider'),
    readPathValue(record, 'modelHint'),
  ]
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  return `[${index}] ${candidates.slice(0, 2).join(' | ') || 'record'}`;
}

export function applyRuntimeFields(
  context: Pick<UiExtensionContext, 'setRuntimeFields'>,
  fields: Record<string, string>,
): void {
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWLIST_RUNTIME_FIELDS.has(key)) {
      continue;
    }
    if (key === 'turnIndex') {
      const parsed = Number.parseInt(String(value || '1'), 10);
      normalized[key] = Number.isFinite(parsed) ? parsed : 1;
      continue;
    }
    if (key === 'userConfirmedUpload') {
      normalized[key] = String(value).toLowerCase() === 'true';
      continue;
    }
    normalized[key] = String(value ?? '');
  }
  context.setRuntimeFields(normalized);
}

export function resolveActionFields(
  action: ActionDefinition,
  queryResults: QueryResultsMap,
  selectedIndexMap: SelectedIndexMap,
): Record<string, string> {
  if (action.type === 'set-fields') {
    return action.fields;
  }
  const records = queryResults[action.queryId] || [];
  const selectedIndex = selectedIndexMap[action.queryId] ?? 0;
  const selected = records[selectedIndex] || records[0] || null;
  const fields: Record<string, string> = {
    ...action.defaults,
  };
  if (!selected) {
    return fields;
  }
  for (const [targetField, sourcePath] of Object.entries(action.bindings)) {
    const value = readPathValue(selected, sourcePath);
    if (value === undefined || value === null) {
      continue;
    }
    fields[targetField] = String(value);
  }
  return fields;
}
