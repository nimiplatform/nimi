export type LocalRuntimeEngineId = 'llama' | 'media' | 'speech' | 'sidecar';
export type LocalRuntimeEngineRuntimeModeId = 'supervised' | 'attached-endpoint';

export const LOCAL_RUNTIME_ENGINE_IDS = Object.freeze([
  'llama',
  'media',
  'speech',
  'sidecar',
] as const satisfies readonly LocalRuntimeEngineId[]);

export const LOCAL_RUNTIME_ENGINE_RUNTIME_MODE_IDS = Object.freeze([
  'supervised',
  'attached-endpoint',
] as const satisfies readonly LocalRuntimeEngineRuntimeModeId[]);

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

export function parseLocalRuntimeEngineRuntimeModeId(
  value: unknown,
): LocalRuntimeEngineRuntimeModeId | undefined {
  if (typeof value === 'number') {
    if (value === 1) return 'supervised';
    if (value === 2) return 'attached-endpoint';
    return undefined;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '1' || normalized === 'supervised' || normalized === 'local_engine_runtime_mode_supervised') {
    return 'supervised';
  }
  if (
    normalized === '2'
    || normalized === 'attached-endpoint'
    || normalized === 'attached_endpoint'
    || normalized === 'local_engine_runtime_mode_attached_endpoint'
  ) {
    return 'attached-endpoint';
  }
  return undefined;
}

export function normalizeLocalRuntimeEngineRuntimeModeId(
  value: unknown,
  fallback: LocalRuntimeEngineRuntimeModeId = 'attached-endpoint',
): LocalRuntimeEngineRuntimeModeId {
  return parseLocalRuntimeEngineRuntimeModeId(value) ?? fallback;
}

export function toLocalRuntimeEngineRuntimeModeRequestValue(value: unknown): number {
  const parsed = parseLocalRuntimeEngineRuntimeModeId(value);
  if (parsed === 'supervised') return 1;
  if (parsed === 'attached-endpoint') return 2;
  return 0;
}
