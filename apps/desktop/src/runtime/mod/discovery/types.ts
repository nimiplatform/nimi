import type { RuntimeModFactory } from '../types';

export type RuntimeModModule = Record<string, unknown>;
export type RuntimeModImporter = () => Promise<RuntimeModModule>;

export function isRuntimeModFactory(value: unknown): value is RuntimeModFactory {
  return typeof value === 'function';
}

export function resolveRuntimeModFactory(moduleExports: RuntimeModModule): RuntimeModFactory | null {
  const directFactory = moduleExports.createRuntimeMod;
  if (isRuntimeModFactory(directFactory)) {
    return directFactory;
  }

  for (const [exportName, exportedValue] of Object.entries(moduleExports)) {
    if (!isRuntimeModFactory(exportedValue)) continue;
    if (!/^create[A-Z].*RuntimeMod$/.test(exportName)) continue;
    return exportedValue;
  }

  return null;
}
