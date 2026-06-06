import {
  toNimiRealmWorldDisplayData,
  toNimiRealmWorldDisplaySemanticBundle,
} from '@nimiplatform/sdk/realm';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function createTesterWorldDisplayProjection(world: unknown): string {
  const worldRecord = asRecord(world);
  const worldview = asRecord(worldRecord.worldview);
  const semantic = toNimiRealmWorldDisplaySemanticBundle({
    ...worldRecord,
    worldview: {
      ...worldview,
      truth: {
        coreSystem: {
          powerSystems: [],
          levels: [],
          taboos: [],
        },
        operation: {
          title: 'Tester Operation',
          rules: [{ key: 'tester', title: 'Tester Rule', value: 'shared' }],
        },
      },
    },
  });
  const detail = toNimiRealmWorldDisplayData({ id: 'tester-world', name: 'Tester World', status: 'ACTIVE', type: 'CREATOR' });

  return `${semantic.operationRules.length}/${detail.name}`;
}
