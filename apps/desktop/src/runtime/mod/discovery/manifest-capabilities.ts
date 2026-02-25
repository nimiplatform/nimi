export function extractManifestCapabilities(manifest: Record<string, unknown> | undefined): string[] {
  if (!manifest) return [];

  const result = new Set<string>();
  const pushArrayValues = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const normalized = String(item || '').trim();
      if (normalized) result.add(normalized);
    }
  };

  pushArrayValues(manifest.capabilities);
  return Array.from(result);
}
