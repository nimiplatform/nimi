export type LocalRuntimeEngineId = 'llama' | 'media' | 'speech' | 'sidecar';

export const LOCAL_RUNTIME_ENGINE_IDS = Object.freeze([
  'llama',
  'media',
  'speech',
  'sidecar',
] as const satisfies readonly LocalRuntimeEngineId[]);

export function parseLocalRuntimeEngineId(value: unknown): LocalRuntimeEngineId | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if ((LOCAL_RUNTIME_ENGINE_IDS as readonly string[]).includes(normalized)) {
    return normalized as LocalRuntimeEngineId;
  }
  return undefined;
}

export function isLocalRuntimeEngineId(value: unknown): value is LocalRuntimeEngineId {
  return parseLocalRuntimeEngineId(value) !== undefined;
}

export function normalizeLocalRuntimeEngineId(
  value: unknown,
  fallback: LocalRuntimeEngineId = 'llama',
): LocalRuntimeEngineId {
  return parseLocalRuntimeEngineId(value) ?? fallback;
}
