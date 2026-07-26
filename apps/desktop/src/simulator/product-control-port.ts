import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';

import type { DesktopRendererFirstRunPort } from '../shell/renderer/renderer/first-run-port.js';
import type { DesktopSimulatorJsonValue } from './protocol.js';

type JsonRecord = { readonly [key: string]: DesktopSimulatorJsonValue };

function record(value: DesktopSimulatorJsonValue | undefined): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DESKTOP_SIMULATOR_PRODUCT_CONTROL_PROJECTION_INVALID');
  }
  return value as JsonRecord;
}

export function createDesktopSimulatorProductControlPort(
  getProjection: () => DesktopSimulatorJsonValue,
): DesktopRendererFirstRunPort {
  const read = (): NimiProductControlRecordProjection => {
    const projection = record(getProjection());
    const productControl = record(projection.productControl);
    if (productControl.status !== 'ready_for_use') {
      throw new Error('DESKTOP_SIMULATOR_PRODUCT_CONTROL_PROJECTION_INVALID');
    }
    return Object.freeze({
      path: 'sim-product-control',
      exists: true,
      state: 'ready_for_use' as const,
      record: null,
      error: null,
      configMutation: null,
    });
  };
  const unavailable = (): never => {
    throw new Error('DESKTOP_SIMULATOR_FIRST_RUN_UNADMITTED');
  };
  return Object.freeze({
    available: () => true,
    getRecord: async () => read(),
    ensureRecordCreated: async () => unavailable(),
    reconcileSetupState: async () => unavailable(),
    pickDataRootDirectory: async () => unavailable(),
    selectDataRoot: async () => unavailable(),
    completeDeviceEnvironmentScan: async () => unavailable(),
    setInstallLevel: async () => unavailable(),
    admitReadyForUse: async () => unavailable(),
    collectDeviceProfile: async () => unavailable(),
    resolveMaterialization: async () => unavailable(),
    startMaterialization: async () => unavailable(),
    retryMaterializationJob: async () => unavailable(),
    repairMaterializationDependency: async () => unavailable(),
    cancelMaterializationJob: async () => unavailable(),
    finalize: async () => unavailable(),
  });
}
