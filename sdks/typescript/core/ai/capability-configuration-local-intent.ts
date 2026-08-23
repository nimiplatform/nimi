/**
 * Rejects the retired exact-Loadout Local mutation shape before protobuf
 * serialization can silently discard it. Full AIConfig validation remains
 * Runtime-owned; this guard only enforces the Local route hard cut.
 */
export function assertRouteOnlyLocalAIConfigIntents(
  capabilities: readonly unknown[],
  invalid: (message: string) => never,
): void {
  capabilities.forEach((value, index) => {
    const intent = asRecord(value);
    const route = asRecord(intent?.route);
    if (route?.oneofKind !== 'local') return;

    if (!hasExactKeys(route, ['oneofKind', 'local'])) {
      invalid(`AIConfig capability ${index} Local route must contain only the Local intent`);
    }
    const local = asRecord(route.local);
    if (!local || Object.keys(local).length !== 0) {
      invalid(`AIConfig capability ${index} Local intent must not contain a Loadout reference`);
    }
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index]);
}
