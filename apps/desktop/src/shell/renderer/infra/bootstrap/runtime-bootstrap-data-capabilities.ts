import { CORE_WORLD_DATA_CAPABILITY_SET } from './runtime-bootstrap-utils';
import { registerCoreDataCapabilities } from './core-capabilities';
import { registerCreatorDataCapabilities } from './creator-capabilities';
import { registerWorldDataCapabilities } from './world-capabilities';

let coreWorldDataCapabilitiesReady = false;
let coreWorldDataCapabilitiesPromise: Promise<void> | null = null;

async function registerAllCoreWorldDataCapabilities(): Promise<void> {
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
