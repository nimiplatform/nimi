import type { RuntimeModFactory, RuntimeModRegistration } from '../../types';
import { createRuntimeModFlowId, emitRuntimeModRuntimeLog } from '../../logging';
import { isRuntimeModFactory } from '../types';

export function buildRuntimeModsFromFactories(
  factories: RuntimeModFactory[],
): RuntimeModRegistration[] {
  const registrations: RuntimeModRegistration[] = [];
  for (const factory of factories) {
    if (!isRuntimeModFactory(factory)) continue;
    const registration = factory();
    if (!registration?.modId) continue;
    registrations.push(registration);
  }
  return registrations;
}

export function discoverInjectedRuntimeModFactories(): RuntimeModFactory[] {
  // Injected factories are reserved for dev/test instrumentation only.
  // Production/default mods must go through manifest + entry sideload discovery.
  if (typeof window === 'undefined') return [];
  const factories = window.__NIMI_RUNTIME_MOD_FACTORIES__;
  if (!Array.isArray(factories)) return [];
  return factories.filter((factory) => isRuntimeModFactory(factory));
}

export function discoverInjectedRuntimeMods(): RuntimeModRegistration[] {
  const flowId = createRuntimeModFlowId('runtime-mod-discover-injected');
  const startedAt = Date.now();
  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:runtime-mod:discover:start',
    flowId,
    source: 'discoverInjectedRuntimeMods',
    details: { sourceType: 'injected' },
  });
  emitRuntimeModRuntimeLog({
    level: 'debug',
    message: 'action:discover-injected-runtime-mods:start',
    flowId,
    source: 'discoverInjectedRuntimeMods',
  });
  const registrations = buildRuntimeModsFromFactories(discoverInjectedRuntimeModFactories());
  const normalized = registrations.map((registration) => ({
    ...registration,
    sourceType: registration.sourceType || 'injected',
  }));
  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:runtime-mod:discover:done',
    flowId,
    source: 'discoverInjectedRuntimeMods',
    costMs: Date.now() - startedAt,
    details: {
      sourceType: 'injected',
      registrationCount: normalized.length,
    },
  });
  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:discover-injected-runtime-mods:done',
    flowId,
    source: 'discoverInjectedRuntimeMods',
    costMs: Date.now() - startedAt,
    details: {
      registrationCount: normalized.length,
    },
  });
  return normalized;
}
