import { CORE_WORLD_DATA_CAPABILITY_SET } from './runtime-bootstrap-utils';
import { registerCoreDataCapabilities } from './runtime-bootstrap-data-capabilities/core-capabilities';
import { registerCreatorDataCapabilities } from './runtime-bootstrap-data-capabilities/creator-capabilities';
import { registerRuntimeRouteDataCapabilities } from './runtime-bootstrap-data-capabilities/runtime-route-capabilities';
import { registerWorldDataCapabilities } from './runtime-bootstrap-data-capabilities/world-capabilities';

let coreWorldDataCapabilitiesReady = false;
let coreWorldDataCapabilitiesPromise: Promise<void> | null = null;

async function registerAllCoreWorldDataCapabilities(): Promise<void> {
  await registerRuntimeRouteDataCapabilities();
  await registerCoreDataCapabilities();
  await registerWorldDataCapabilities();
  await registerCreatorDataCapabilities();
}

export async function ensureCoreWorldDataCapabilitiesRegistered(): Promise<void> {
  if (coreWorldDataCapabilitiesReady) return;
  if (coreWorldDataCapabilitiesPromise) {
    await coreWorldDataCapabilitiesPromise;
    return;
  }
  coreWorldDataCapabilitiesPromise = registerAllCoreWorldDataCapabilities()
    .then(() => {
      coreWorldDataCapabilitiesReady = true;
    })
    .finally(() => {
      coreWorldDataCapabilitiesPromise = null;
    });
  await coreWorldDataCapabilitiesPromise;
}

export function isCoreWorldDataCapability(capability: string): boolean {
  return CORE_WORLD_DATA_CAPABILITY_SET.has(capability);
}

