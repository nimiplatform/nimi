import { desktopBridge } from '../bridge.js';
import { firstRunRuntimeLocalClient } from '../first-run/first-run-runtime-local-client.js';
import {
  cancelDesktopNimiFirstRunMaterializationJob,
  repairDesktopNimiFirstRunMaterializationDependency,
  resolveDesktopNimiFirstRunMaterializationProjection,
  retryDesktopNimiFirstRunMaterializationJob,
  startDesktopNimiFirstRunMaterialization,
} from '../first-run/runtime-materialization.js';
import type { DesktopRendererFirstRunPort } from './first-run-port.js';

export function createDesktopProductionFirstRunPort(): DesktopRendererFirstRunPort {
  let finalizationInFlight: ReturnType<DesktopRendererFirstRunPort['finalize']> | null = null;
  const finalize = async () => {
    const prepared = await desktopBridge.prepareProductFirstRunLocalAiReady();
    if (prepared.state !== 'local_ai_ready' && prepared.state !== 'ready_for_use') {
      return { prepared, final: prepared };
    }
    return { prepared, final: await desktopBridge.admitProductReadyForUse() };
  };
  return Object.freeze({
    available: desktopBridge.hasShellHostInvoke,
    ensureRecordCreated: desktopBridge.ensureProductControlRecordCreated,
    defaultDataRootDirectory: desktopBridge.defaultProductDataRootDirectory,
    reconcileSetupState: desktopBridge.reconcileProductFirstRunSetupState,
    pickDataRootDirectory: desktopBridge.pickProductDataRootDirectory,
    selectDataRoot: desktopBridge.selectProductDataRoot,
    completeDeviceEnvironmentScan: desktopBridge.completeProductFirstRunDeviceEnvironmentScan,
    setInstallLevel: desktopBridge.setProductFirstRunInstallLevel,
    getRecord: desktopBridge.getProductControlRecord,
    admitReadyForUse: desktopBridge.admitProductReadyForUse,
    collectDeviceProfile: firstRunRuntimeLocalClient.collectDeviceProfile,
    resolveMaterialization: (input: Parameters<DesktopRendererFirstRunPort['resolveMaterialization']>[0]) => resolveDesktopNimiFirstRunMaterializationProjection({
      ...input,
      runtime: firstRunRuntimeLocalClient,
    }),
    startMaterialization: (input: Parameters<DesktopRendererFirstRunPort['startMaterialization']>[0]) => startDesktopNimiFirstRunMaterialization({
      ...input,
      runtime: firstRunRuntimeLocalClient,
    }),
    retryMaterializationJob: (input: Parameters<DesktopRendererFirstRunPort['retryMaterializationJob']>[0]) => retryDesktopNimiFirstRunMaterializationJob({
      ...input,
      runtime: firstRunRuntimeLocalClient,
    }),
    repairMaterializationDependency: (input: Parameters<DesktopRendererFirstRunPort['repairMaterializationDependency']>[0]) => repairDesktopNimiFirstRunMaterializationDependency({
      ...input,
      runtime: firstRunRuntimeLocalClient,
    }),
    cancelMaterializationJob: (input: Parameters<DesktopRendererFirstRunPort['cancelMaterializationJob']>[0]) => cancelDesktopNimiFirstRunMaterializationJob({
      ...input,
      runtime: firstRunRuntimeLocalClient,
    }),
    finalize() {
      if (!finalizationInFlight) {
        finalizationInFlight = finalize().finally(() => { finalizationInFlight = null; });
      }
      return finalizationInFlight;
    },
  });
}
