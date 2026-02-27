import { SERVICE_REGISTRY_FACTORY_SECTION } from './render-service-registry-factory.mjs';
import { SERVICE_REGISTRY_RUNTIME_SECTION } from './render-service-registry-runtime.mjs';
import { SERVICE_REGISTRY_TYPES_SECTION } from './render-service-registry-types.mjs';

export function renderServiceRegistryFile() {
  return [
    ...SERVICE_REGISTRY_TYPES_SECTION,
    ...SERVICE_REGISTRY_RUNTIME_SECTION,
    ...SERVICE_REGISTRY_FACTORY_SECTION,
  ].join('\n');
}
