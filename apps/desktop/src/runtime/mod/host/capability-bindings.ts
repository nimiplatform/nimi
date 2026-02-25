import { expandCapabilitiesFromDeclarations } from '@runtime/hook/contracts/capabilities';
import type { RuntimeModRegistration } from '../types';

export function resolveRegistrationCapabilities(input: RuntimeModRegistration): {
  baselineCapabilities: string[];
  manifestCapabilities: string[];
} {
  const requested = expandCapabilitiesFromDeclarations(input.capabilities || []);
  const manifest = expandCapabilitiesFromDeclarations(input.manifestCapabilities || []);
  return {
    baselineCapabilities: requested,
    manifestCapabilities: manifest,
  };
}

export function resolveDeclaredDataCapabilities(capabilities: string[]): string[] {
  const result = new Set<string>();
  for (const capability of capabilities) {
    const normalized = String(capability || '').trim();
    if (!normalized || normalized.endsWith('*')) {
      continue;
    }
    if (normalized.startsWith('data.query.')) {
      result.add(normalized.slice('data.query.'.length));
      continue;
    }
    if (normalized.startsWith('data.register.')) {
      result.add(normalized.slice('data.register.'.length));
    }
  }
  return Array.from(result);
}
