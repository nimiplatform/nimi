import type { QueryDefinition } from './types';

type RuntimeQueryExecutor = {
  queryData: (input: {
    modId: string;
    capability: string;
    query: Record<string, unknown>;
  }) => Promise<unknown>;
};

function toRecordList(input: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(input)) {
    return input.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
  }
  if (!input || typeof input !== 'object') {
    return [];
  }
  const root = input as Record<string, unknown>;
  if (Array.isArray(root.items)) {
    return root.items.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
  }
  return [root];
}

export async function executeRuntimeQuery(
  executor: RuntimeQueryExecutor,
  modId: string,
  query: QueryDefinition,
): Promise<Array<Record<string, unknown>>> {
  const result = await executor.queryData({
    modId,
    capability: query.capability,
    query: query.query,
  });
  return toRecordList(result);
}
