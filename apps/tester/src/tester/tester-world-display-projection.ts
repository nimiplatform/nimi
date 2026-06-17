import type { WorldCoreDto } from '@nimiplatform/sdk/realm';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readCoreString(core: Record<string, unknown>, section: string, key: string, fallback: string): string {
  const value = asRecord(core[section])[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function createTesterWorldDisplayProjection(world: Pick<WorldCoreDto, 'core' | 'id' | 'visibility'>): string {
  const name = readCoreString(world.core, 'identity', 'name', world.id);
  const timeScale = readCoreString(world.core, 'timeline', 'timeScale', 'default');
  return `${world.visibility}/${name}/${timeScale}`;
}
