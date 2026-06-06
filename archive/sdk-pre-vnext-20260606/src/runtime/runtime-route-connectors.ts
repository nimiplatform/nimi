import type {
  RuntimeCanonicalCapability,
  RuntimeRouteConnectorOption,
} from './runtime-route-core.js';
import {
  runtimeRouteModelSupportsCapability,
} from './runtime-route-capability-coverage.js';

export type RuntimeRouteConnectorDescriptorProjectionInput = {
  id?: string;
  label?: string;
  vendor?: string;
  provider?: string;
};

export type RuntimeRouteConnectorModelDescriptorProjectionInput = {
  modelId?: string;
  capabilities?: string[];
};

export type RuntimeRouteConnectorProjectionInput = {
  descriptor: RuntimeRouteConnectorDescriptorProjectionInput;
  modelDescriptors: RuntimeRouteConnectorModelDescriptorProjectionInput[];
};

export function projectRuntimeRouteConnectors(
  connectors: RuntimeRouteConnectorProjectionInput[] | undefined,
  capability: RuntimeCanonicalCapability,
): RuntimeRouteConnectorOption[] {
  return (connectors || [])
    .map((connector): RuntimeRouteConnectorOption | null => {
      const descriptor = connector.descriptor || {};
      const id = String(descriptor.id || '').trim();
      if (!id) {
        return null;
      }
      const matchingModels = (connector.modelDescriptors || [])
        .filter((item) => runtimeRouteModelSupportsCapability(item.capabilities, capability))
        .map((item) => String(item.modelId || '').trim())
        .filter(Boolean);
      if (matchingModels.length === 0) {
        return null;
      }
      const modelCapabilities = (connector.modelDescriptors || []).reduce<Record<string, string[]>>((accumulator, item) => {
        if (!runtimeRouteModelSupportsCapability(item.capabilities, capability)) {
          return accumulator;
        }
        const modelId = String(item.modelId || '').trim();
        if (modelId) {
          accumulator[modelId] = Array.isArray(item.capabilities) ? [...item.capabilities] : [];
        }
        return accumulator;
      }, {});
      return {
        id,
        label: String(descriptor.label || ''),
        vendor: String(descriptor.vendor || '').trim() || undefined,
        provider: String(descriptor.provider || '').trim() || undefined,
        models: matchingModels,
        modelCapabilities,
        modelProfiles: [],
      };
    })
    .filter((connector): connector is RuntimeRouteConnectorOption => connector !== null);
}
