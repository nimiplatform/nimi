import en from './en.json' with { type: 'json' };
import zh from './zh.json' with { type: 'json' };

export type AIStudioMessageBundle = Readonly<Record<string, unknown>>;
export type AIStudioMessageBundles = Readonly<Record<'en' | 'zh', AIStudioMessageBundle>>;

export const aiStudioCoreMessageBundles = Object.freeze({ en, zh }) satisfies AIStudioMessageBundles;

function cloneMessageValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneMessageValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneMessageValue(child)]),
    );
  }
  return value;
}

function mergeMessageObject(
  target: Record<string, unknown>,
  source: AIStudioMessageBundle,
  prefix = '',
): void {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const current = target[key];
    if (
      current && typeof current === 'object' && !Array.isArray(current)
      && value && typeof value === 'object' && !Array.isArray(value)
    ) {
      mergeMessageObject(current as Record<string, unknown>, value as AIStudioMessageBundle, path);
      continue;
    }
    if (Object.hasOwn(target, key)) {
      throw new Error(`Duplicate i18n message owner: ${path}`);
    }
    target[key] = cloneMessageValue(value);
  }
}

export function mergeAIStudioMessageBundles(
  bundles: readonly AIStudioMessageBundle[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const bundle of bundles) mergeMessageObject(merged, bundle);
  return merged;
}
