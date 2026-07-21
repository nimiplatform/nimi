import type { NimiAppAIProfileFactoryRow, NimiFirstRunInstallLevel } from '@nimiplatform/sdk/app';
import type {
  NimiProductControlRecordProjection,
  NimiRuntimeLocalDeviceProfile,
  NimiRuntimeLocalEnvironmentPlanDependency,
} from '@nimiplatform/sdk/runtime';

import type { NimiFirstRunMaterializationProjection } from '../first-run/runtime-materialization.js';

export type DesktopFirstRunMaterializationInput = {
  readonly profile: NimiAppAIProfileFactoryRow;
  readonly runtimeDataRoot: string;
  readonly installLevel: NimiFirstRunInstallLevel | null;
};

export interface DesktopRendererFirstRunPort {
  available(): boolean;
  ensureRecordCreated(): Promise<NimiProductControlRecordProjection>;
  defaultDataRootDirectory(): Promise<string | null>;
  reconcileSetupState(): Promise<NimiProductControlRecordProjection>;
  pickDataRootDirectory(): Promise<string | null>;
  selectDataRoot(path: string): Promise<NimiProductControlRecordProjection>;
  completeDeviceEnvironmentScan(): Promise<NimiProductControlRecordProjection>;
  setInstallLevel(input: {
    readonly installLevel: NimiFirstRunInstallLevel;
    readonly aiProfileAlias?: string | null;
  }): Promise<NimiProductControlRecordProjection>;
  getRecord(): Promise<NimiProductControlRecordProjection>;
  admitReadyForUse(): Promise<NimiProductControlRecordProjection>;
  collectDeviceProfile(): Promise<NimiRuntimeLocalDeviceProfile>;
  resolveMaterialization(input: DesktopFirstRunMaterializationInput): Promise<NimiFirstRunMaterializationProjection>;
  startMaterialization(input: DesktopFirstRunMaterializationInput & { readonly confirmed: boolean }): Promise<NimiFirstRunMaterializationProjection>;
  retryMaterializationJob(input: DesktopFirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean }): Promise<NimiFirstRunMaterializationProjection>;
  repairMaterializationDependency(input: DesktopFirstRunMaterializationInput & {
    readonly dependency: NimiRuntimeLocalEnvironmentPlanDependency;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  }): Promise<NimiFirstRunMaterializationProjection>;
  cancelMaterializationJob(input: DesktopFirstRunMaterializationInput & { readonly jobId: string }): Promise<NimiFirstRunMaterializationProjection>;
  finalize(): Promise<{
    readonly prepared: NimiProductControlRecordProjection;
    readonly final: NimiProductControlRecordProjection;
  }>;
}

export function createUnavailableDesktopFirstRunPort(code: string): DesktopRendererFirstRunPort {
  const rejected = (): never => { throw new Error(code); };
  return Object.freeze({
    available: () => false,
    ensureRecordCreated: async () => rejected(),
    defaultDataRootDirectory: async () => rejected(),
    reconcileSetupState: async () => rejected(),
    pickDataRootDirectory: async () => rejected(),
    selectDataRoot: async () => rejected(),
    completeDeviceEnvironmentScan: async () => rejected(),
    setInstallLevel: async () => rejected(),
    getRecord: async () => rejected(),
    admitReadyForUse: async () => rejected(),
    collectDeviceProfile: async () => rejected(),
    resolveMaterialization: async () => rejected(),
    startMaterialization: async () => rejected(),
    retryMaterializationJob: async () => rejected(),
    repairMaterializationDependency: async () => rejected(),
    cancelMaterializationJob: async () => rejected(),
    finalize: async () => rejected(),
  });
}
