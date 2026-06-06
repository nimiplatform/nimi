import type { WorldEvolutionSelectorReadProvider } from './world-evolution-selector-read-types.js';

export { createWorldEvolutionSelectorReadError } from './world-evolution-selector-read-errors.js';
export { createWorldEvolutionSelectorReadFacade } from './world-evolution-selector-read-readers.js';
export type {
  WorldEvolutionSelectorReadFacade,
  WorldEvolutionSelectorReadProvider,
} from './world-evolution-selector-read-types.js';

const RUNTIME_PROVIDER_REGISTRY = new WeakMap<object, WorldEvolutionSelectorReadProvider>();

export function setRuntimeWorldEvolutionSelectorReadProvider(
  runtime: object,
  provider: WorldEvolutionSelectorReadProvider | null,
): void {
  if (!provider) {
    RUNTIME_PROVIDER_REGISTRY.delete(runtime);
    return;
  }
  RUNTIME_PROVIDER_REGISTRY.set(runtime, provider);
}

export function getRuntimeWorldEvolutionSelectorReadProvider(runtime: object): WorldEvolutionSelectorReadProvider | null {
  return RUNTIME_PROVIDER_REGISTRY.get(runtime) || null;
}
