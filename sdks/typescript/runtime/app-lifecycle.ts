import type {
  NimiRuntimeAppLifecycleClient,
  NimiRuntimeAppLifecycleGeneratedClient,
} from './app-lifecycle-types';
import { requireNimiRuntimeAppId } from './app-lifecycle-decoder-utils';
import { decodeNimiRuntimeAccountAppInventoryProjection } from './app-lifecycle-inventory-decoders';
import {
  decodeNimiRuntimeAppPackageReadinessProjection,
  decodeNimiRuntimeAppStorageProjection,
} from './app-lifecycle-projection-decoders';

export * from './app-lifecycle-types';
export {
  decodeNimiRuntimeAccountAppInventoryProjection,
  decodeNimiRuntimeAccountAppInventoryRecord,
  decodeNimiRuntimeAccountAppInventoryRow,
} from './app-lifecycle-inventory-decoders';
export {
  decodeNimiRuntimeAppPackageReadinessProjection,
  decodeNimiRuntimeAppStorageProjection,
} from './app-lifecycle-projection-decoders';

export function createNimiRuntimeAppLifecycleClient(input: {
  readonly client: NimiRuntimeAppLifecycleGeneratedClient;
}): NimiRuntimeAppLifecycleClient {
  const { client } = input;
  return {
    async accountInventory(options) {
      const response = await client.getAccountAppInventory({}, options);
      return decodeNimiRuntimeAccountAppInventoryProjection(response);
    },
    async storage(storageInput, options) {
      const appId = requireNimiRuntimeAppId(storageInput?.appId);
      const response = await client.getAppStorage({ appId }, options);
      return decodeNimiRuntimeAppStorageProjection(response.projection);
    },
    async packageReadiness(options) {
      const response = await client.getAppPackageReadiness({ appId: '' }, options);
      return decodeNimiRuntimeAppPackageReadinessProjection(response.projection);
    },
  };
}
