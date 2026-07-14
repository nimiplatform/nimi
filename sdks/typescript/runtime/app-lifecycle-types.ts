import type {
  GetAccountAppInventoryRequest,
  GetAccountAppInventoryResponse,
  GetAppPackageReadinessRequest,
  GetAppPackageReadinessResponse,
  GetAppStorageRequest,
  GetAppStorageResponse,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import type { NimiRuntimeAppStorageProjection } from './app-storage';

export type NimiRuntimeAccountAppInventoryState =
  | 'verified'
  | 'entitled'
  | 'disabled'
  | 'removed'
  | 'revoked';

export type NimiRuntimeAccountAppInstallState =
  | 'not-present'
  | 'local-record-active'
  | 'removed';

export type NimiRuntimeAccountAppInventoryRow = {
  readonly appId: string;
  readonly accountState: NimiRuntimeAccountAppInventoryState;
  readonly installState: NimiRuntimeAccountAppInstallState;
  readonly lastOpenedAt?: string;
  readonly dataPolicy: string;
  readonly verifiedAt?: string;
  readonly source?: string;
  readonly detail?: string;
};

export type NimiRuntimeAccountAppInventoryRecord = {
  readonly schemaVersion: 2;
  readonly accountId: string;
  readonly updatedAt: string;
  readonly apps: readonly NimiRuntimeAccountAppInventoryRow[];
};

export type NimiRuntimeAccountAppInventoryProjection = {
  readonly exists: boolean;
  readonly record?: NimiRuntimeAccountAppInventoryRecord;
  readonly reasonCode?: string;
  readonly detail?: string;
};

/**
 * The only 0K SDK projection of immutable-package readiness. Runtime keeps the
 * frozen opaque lineage/attestation/digest slots private and returns no app,
 * descriptor, version, evidence, or filesystem selector through this shape.
 */
export type NimiRuntimeAppPackageReadinessProjection = {
  readonly state: 'unavailable';
  readonly reasonCode: string;
  readonly detail?: string;
};

export interface NimiRuntimeAppLifecycleGeneratedClient {
  getAccountAppInventory(
    request: GetAccountAppInventoryRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAccountAppInventoryResponse>;
  getAppStorage(
    request: GetAppStorageRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAppStorageResponse>;
  getAppPackageReadiness(
    request: GetAppPackageReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAppPackageReadinessResponse>;
}

export interface NimiRuntimeAppLifecycleClient {
  accountInventory(options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAccountAppInventoryProjection>;
  storage(
    input: { readonly appId: string },
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiRuntimeAppStorageProjection>;
  packageReadiness(options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppPackageReadinessProjection>;
}
