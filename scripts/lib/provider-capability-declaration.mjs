// @nimi-authority: rule.nimi.runtime.model-catalog.r013
// A reviewed provider can retain custom-catalog support without inventing a
// built-in model row. This projects metadata; model admission remains Runtime-owned.
export function providerCapabilityDeclaration(runtime, derived, canonical, provider) {
  const declared = runtime?.capabilities;
  if (declared === undefined) return [...new Set(derived)].sort();
  if ((runtime?.inventory_mode || 'static_source') !== 'static_source') {
    throw new Error(`${provider} runtime.capabilities is only supported for static_source`);
  }
  if (!Array.isArray(declared) || declared.length === 0
    || declared.some((value) => typeof value !== 'string' || !canonical.has(value))
    || new Set(declared).size !== declared.length) {
    throw new Error(`${provider} runtime.capabilities must contain unique canonical capability tokens`);
  }
  for (const capability of derived) {
    if (!declared.includes(capability)) {
      throw new Error(`${provider} runtime.capabilities omits model capability ${capability}`);
    }
  }
  return [...declared].sort();
}
