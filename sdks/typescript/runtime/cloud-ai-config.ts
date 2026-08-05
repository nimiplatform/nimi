import type { CapabilityImplementationIdentity } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration.js';
import type { NimiRuntimeModelCatalogProvider } from './model-catalog.js';

export interface NimiRuntimeCloudImplementationOption {
  readonly optionId: string;
  readonly label: string;
  readonly capabilityContract: string;
  readonly provider: string;
  readonly implementation: CapabilityImplementationIdentity;
}

/**
 * Projects the current Runtime model-catalog provider rows into the Cloud
 * implementation choices shown by first-party configuration surfaces.
 * Connector inventory is deliberately absent: provider API/dialect belongs to
 * Driver configuration and account authorization is selected separately.
 */
export function projectNimiRuntimeCloudImplementationOptions(
  providers: readonly NimiRuntimeModelCatalogProvider[],
  capabilityContract: string,
): readonly NimiRuntimeCloudImplementationOption[] {
  const capability = exactText(capabilityContract);
  if (!capability) return Object.freeze([]);
  const options = new Map<string, NimiRuntimeCloudImplementationOption>();
  for (const entry of providers) {
    const provider = exactText(entry.provider);
    const executionModule = exactText(entry.executionModule);
    if (
      !provider
      || !executionModule
      || exactText(entry.runtimePlane) !== 'remote'
      || !entry.managedSupported
      || !entry.capabilities.includes(capability)
    ) {
      continue;
    }
    options.set(provider, Object.freeze({
      optionId: provider,
      label: providerLabel(provider),
      capabilityContract: capability,
      provider,
      implementation: Object.freeze({
        // Runtime's current admitted implementation set is provider-catalog
        // keyed. These values remain independent of ConnectorGrant identity.
        implementationId: provider,
        driverId: executionModule,
        driverDialect: provider,
      }),
    }));
  }
  return Object.freeze(
    [...options.values()].sort((left, right) => left.label.localeCompare(right.label)),
  );
}

function providerLabel(provider: string): string {
  return provider
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function exactText(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
    ? value
    : '';
}
