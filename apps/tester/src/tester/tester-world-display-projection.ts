import { display as worldDisplay } from '@nimiplatform/sdk/world';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function createTesterWorldDisplayProjection(world: unknown): string {
  const worldRecord = asRecord(world);
  const worldview = asRecord(worldRecord.worldview);
  const semantic = worldDisplay.toSemanticBundle({
    ...worldRecord,
    worldview: {
      ...worldview,
      coreSystem: { name: 'Tester Core', rules: [{ key: 'tester', title: 'Tester Rule', value: 'shared' }] },
    },
  });
  const detail = worldDisplay.toData({ id: 'tester-world', name: 'Tester World', status: 'ACTIVE', type: 'CREATOR' });

  return `${semantic.operationRules.length}/${detail.name}`;
}
