import type {
  AppLaunchReadiness,
  NimiAppAccountInventorySourceRow,
  NimiAppInventoryEntry,
  NimiAppInventoryInstallState,
  NimiAppInventoryNextAction,
  NimiAppInventorySource,
  NimiAppLocalRecordRow,
  NimiAppPackageReadinessUnavailable,
  NimiAppReleaseDescriptorRow,
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
  TrustTierId,
} from './inventory-types.js';
import type {
  NimiAppAccountInventoryProjection,
  NimiAppAccountInventoryRecord,
  NimiAppAccountInventoryRow,
} from './account-inventory.js';
import {
  parseNimiAppAccountInventoryRecord,
  parseOptionalNimiAppAccountInventoryProjection,
} from './account-inventory.js';

export type NimiAppAdmissionStatus =
  | 'admitted'
  | 'gated_by_avatar_master_gate'
  | 'permission_fabric_pending'
  | 'deferred'
  | 'retired';

export interface NimiAppRegistrySourceRow extends NimiAppRow {
  readonly ordinaryVisibility: NonNullable<NimiAppRow['ordinaryVisibility']>;
  readonly admissionStatus: NimiAppAdmissionStatus;
  readonly detail?: string;
}

export interface NimiAppRegistryTransportOptions {
  readonly loadRows: () => Promise<readonly NimiAppRegistrySourceRow[]> | readonly NimiAppRegistrySourceRow[];
  readonly loadReleaseDescriptors: () =>
    Promise<readonly NimiAppReleaseDescriptorRow[]> | readonly NimiAppReleaseDescriptorRow[];
  readonly loadAccountInventory?: () =>
    Promise<NimiAppAccountInventoryProjection | NimiAppAccountInventoryRecord | null | undefined>
    | NimiAppAccountInventoryProjection
    | NimiAppAccountInventoryRecord
    | null
    | undefined;
  readonly loadLocalRecords?: () =>
    Promise<readonly NimiAppLocalRecordRow[] | null | undefined>
    | readonly NimiAppLocalRecordRow[]
    | null
    | undefined;
  /** Selector-free Runtime K-APP-023 opaque-unavailable projection. */
  readonly loadPackageReadiness?: () =>
    Promise<NimiAppPackageReadinessUnavailable | undefined>
    | NimiAppPackageReadinessUnavailable
    | undefined;
}

export class NimiAppRegistryTransportError extends Error {
  readonly code: 'invalid-dependency' | 'source-error' | 'missing-registry-row';

  constructor(
    code: NimiAppRegistryTransportError['code'],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.code = code;
    this.name = 'NimiAppRegistryTransportError';
  }
}

export function createNimiAppRegistryTransport(options: NimiAppRegistryTransportOptions): NimiAppTransport {
  assertRegistryTransportOptions(options);
  return {
    async list(): Promise<readonly NimiAppInventoryEntry[]> {
      return composeInventory(options);
    },
    async get(appId: string): Promise<NimiAppInventoryEntry> {
      const entry = (await composeInventory(options)).find((candidate) => candidate.appId === appId);
      if (!entry) throw missingRow(appId);
      return entry;
    },
    async status(appId: string): Promise<NimiAppStatus> {
      const [rows, descriptors, packageReadiness] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
        loadPackageReadiness(options.loadPackageReadiness),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) throw missingRow(appId);
      return defaultStatus(row, descriptors, packageReadiness);
    },
  };
}

async function composeInventory(options: NimiAppRegistryTransportOptions): Promise<readonly NimiAppInventoryEntry[]> {
  const [rows, descriptors, accountResult, localResult, packageReadiness] = await Promise.all([
    loadRows(options.loadRows),
    loadReleaseDescriptors(options.loadReleaseDescriptors),
    loadOptionalAccountInventory(options.loadAccountInventory),
    loadOptionalLocalRecords(options.loadLocalRecords),
    loadOptionalPackageReadiness(options.loadPackageReadiness),
  ]);
  const catalogById = new Map<string, NimiAppRow>();
  for (const row of rows) {
    if (resolveOrdinaryVisibleDescriptor(row, descriptors).ok) catalogById.set(row.appId, row);
  }
  const accountById = new Map<string, NimiAppAccountInventoryRow>();
  for (const row of accountResult.record?.apps ?? []) accountById.set(row.appId, row);
  const localRecordById = new Map<string, NimiAppLocalRecordRow>();
  for (const row of localResult.rows ?? []) {
    if (localRecordById.has(row.appId)) {
      throw new NimiAppRegistryTransportError(
        'source-error',
        `Runtime local-record source contains ambiguous appId ${row.appId}`,
      );
    }
    localRecordById.set(row.appId, row);
  }
  const appIds = new Set([...catalogById.keys(), ...accountById.keys(), ...localRecordById.keys()]);
  return [...appIds].sort().map((appId) => composeInventoryEntry({
    appId,
    catalog: catalogById.get(appId),
    account: accountById.get(appId),
    localRecord: localRecordById.get(appId),
    accountDegraded: accountResult.degraded,
    localRecordDegraded: localResult.degraded,
    packageReadiness,
  }));
}

function composeInventoryEntry(input: {
  readonly appId: string;
  readonly catalog?: NimiAppRow;
  readonly account?: NimiAppAccountInventoryRow;
  readonly localRecord?: NimiAppLocalRecordRow;
  readonly accountDegraded?: DegradedSource;
  readonly localRecordDegraded?: DegradedSource;
  readonly packageReadiness: OptionalSourceLoad<NimiAppPackageReadinessUnavailable>;
}): NimiAppInventoryEntry {
  const sources = {
    catalog: input.catalog ? present(input.catalog) : absent<NimiAppRow>(),
    account: input.account
      ? present(input.account)
      : input.accountDegraded
        ? degraded<NimiAppAccountInventorySourceRow>(input.accountDegraded)
        : absent<NimiAppAccountInventorySourceRow>(),
    localRecord: input.localRecord
      ? present(input.localRecord)
      : input.localRecordDegraded
        ? degraded<NimiAppLocalRecordRow>(input.localRecordDegraded)
        : absent<NimiAppLocalRecordRow>(),
    packageReadiness: input.packageReadiness.value
      ? present(input.packageReadiness.value)
      : input.packageReadiness.degraded
        ? degraded<NimiAppPackageReadinessUnavailable>(input.packageReadiness.degraded)
        : absent<NimiAppPackageReadinessUnavailable>(),
  };
  const installState = resolveInstallState(input.account, input.localRecord);
  const openReadiness = resolveOpenReadiness(input.catalog, input.account, input.localRecord);
  const nextActions = resolveNextActions(openReadiness, Boolean(input.account), Boolean(input.localRecord));
  const reasonCode = input.localRecord?.reasonCode
    ?? input.packageReadiness.value?.reasonCode
    ?? input.accountDegraded?.reasonCode
    ?? input.localRecordDegraded?.reasonCode;
  const detail = input.localRecord?.detail
    ?? input.packageReadiness.value?.detail
    ?? input.accountDegraded?.detail
    ?? input.localRecordDegraded?.detail;
  return {
    appId: input.appId,
    displayName: input.catalog?.displayName || input.localRecord?.displayName || input.appId,
    ...(input.catalog?.appKind ? { appKind: input.catalog.appKind } : {}),
    ...(input.catalog?.publisher ? { publisher: input.catalog.publisher } : {}),
    ...(input.catalog?.aiProfileSelectionRef ? { aiProfileSelectionRef: input.catalog.aiProfileSelectionRef } : {}),
    ...(input.catalog?.releaseDescriptorRef ? { releaseDescriptorRef: input.catalog.releaseDescriptorRef } : {}),
    ...(input.catalog?.installStoragePolicyRef
      ? { installStoragePolicyRef: input.catalog.installStoragePolicyRef }
      : {}),
    trustTier: input.localRecord?.trustClass ?? input.catalog?.trustTier ?? 'unknown',
    capabilitySet: input.catalog?.capabilitySet ?? [],
    sources,
    installState,
    openReadiness,
    activeJobs: [],
    nextActions,
    ...(reasonCode ? { reasonCode } : {}),
    ...(detail ? { detail } : {}),
  };
}

async function loadRows(
  load: NimiAppRegistryTransportOptions['loadRows'],
): Promise<readonly NimiAppRegistrySourceRow[]> {
  try {
    const rows = await load();
    if (!Array.isArray(rows)) {
      throw new NimiAppRegistryTransportError('source-error', 'Nimi App registry source did not return an array');
    }
    return rows;
  } catch (error) {
    if (error instanceof NimiAppRegistryTransportError) throw error;
    throw new NimiAppRegistryTransportError('source-error', 'Nimi App registry source failed', { cause: error });
  }
}

async function loadReleaseDescriptors(
  load: NimiAppRegistryTransportOptions['loadReleaseDescriptors'],
): Promise<readonly NimiAppReleaseDescriptorRow[]> {
  try {
    const rows = await load();
    if (!Array.isArray(rows)) {
      throw new NimiAppRegistryTransportError('source-error', 'Nimi App release descriptor source did not return an array');
    }
    return rows;
  } catch (error) {
    if (error instanceof NimiAppRegistryTransportError) throw error;
    throw new NimiAppRegistryTransportError('source-error', 'Nimi App release descriptor source failed', { cause: error });
  }
}

function defaultStatus(
  row: NimiAppRegistrySourceRow,
  descriptors: readonly NimiAppReleaseDescriptorRow[],
  packageReadiness: NimiAppPackageReadinessUnavailable | undefined,
): NimiAppStatus {
  const descriptorResolution = resolveOrdinaryVisibleDescriptor(row, descriptors);
  const launchReadiness = admissionToReadiness(row, descriptorResolution);
  return {
    appId: row.appId,
    launchReadiness,
    ...(descriptorResolution.ok ? { releaseDescriptorRef: row.releaseDescriptorRef } : {}),
    ...(packageReadiness?.reasonCode ? { reasonCode: packageReadiness.reasonCode } : {}),
    detail: row.detail || defaultStatusDetail(launchReadiness, descriptorResolution, packageReadiness),
  };
}

function admissionToReadiness(
  row: NimiAppRegistrySourceRow,
  descriptorResolution: DescriptorResolution,
): AppLaunchReadiness {
  switch (row.admissionStatus) {
    case 'admitted':
      return descriptorResolution.ok ? 'package-unavailable' : 'unsupported';
    case 'gated_by_avatar_master_gate':
      return 'blocked-by-master-gate';
    case 'permission_fabric_pending':
    case 'deferred':
    case 'retired':
      return 'unsupported';
  }
}

type DegradedSource = { readonly reasonCode: string; readonly detail: string };
type OptionalSourceLoad<T> =
  | { readonly value?: T; readonly degraded?: undefined }
  | { readonly value?: undefined; readonly degraded: DegradedSource };

async function loadOptionalAccountInventory(
  load: NimiAppRegistryTransportOptions['loadAccountInventory'],
): Promise<{ readonly record?: NimiAppAccountInventoryRecord; readonly degraded?: DegradedSource }> {
  if (!load) return {};
  try {
    const raw = await load();
    if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
      return { record: parseNimiAppAccountInventoryRecord(raw) };
    }
    const projection = parseOptionalNimiAppAccountInventoryProjection(raw);
    if (!projection) return {};
    if (!projection.exists) return projection.reasonCode
      ? { degraded: sourceDegraded(projection.reasonCode, projection.detail || 'account inventory unavailable') }
      : {};
    if (!projection.record) throw new Error('account inventory exists without record');
    return { record: projection.record };
  } catch (error) {
    return { degraded: sourceDegraded('SDK_APP_ACCOUNT_INVENTORY_SOURCE_FAILED', errorDetail(error)) };
  }
}

async function loadOptionalLocalRecords(
  load: NimiAppRegistryTransportOptions['loadLocalRecords'],
): Promise<{ readonly rows?: readonly NimiAppLocalRecordRow[]; readonly degraded?: DegradedSource }> {
  if (!load) return {};
  try {
    const rows = await load();
    if (rows == null) return {};
    if (!Array.isArray(rows)) throw new Error('Runtime local-record source did not return an array');
    for (const [index, row] of rows.entries()) validateLocalRecord(row, index);
    return { rows };
  } catch (error) {
    return { degraded: sourceDegraded('SDK_APP_LOCAL_RECORD_SOURCE_FAILED', errorDetail(error)) };
  }
}

async function loadOptionalPackageReadiness(
  load: NimiAppRegistryTransportOptions['loadPackageReadiness'],
): Promise<OptionalSourceLoad<NimiAppPackageReadinessUnavailable>> {
  if (!load) return {};
  try {
    const value = await load();
    if (!value) return {};
    validatePackageReadiness(value);
    return { value };
  } catch (error) {
    return { degraded: sourceDegraded('SDK_APP_PACKAGE_READINESS_SOURCE_FAILED', errorDetail(error)) };
  }
}

async function loadPackageReadiness(
  load: NimiAppRegistryTransportOptions['loadPackageReadiness'],
): Promise<NimiAppPackageReadinessUnavailable | undefined> {
  if (!load) return undefined;
  try {
    const value = await load();
    if (!value) return undefined;
    validatePackageReadiness(value);
    return value;
  } catch (error) {
    if (error instanceof NimiAppRegistryTransportError) throw error;
    throw new NimiAppRegistryTransportError(
      'source-error',
      `Runtime package readiness source failed: ${errorDetail(error)}`,
      { cause: error },
    );
  }
}

function validatePackageReadiness(value: NimiAppPackageReadinessUnavailable): void {
  if (value.state !== 'unavailable' || !value.reasonCode?.trim()) {
    throw new Error('Runtime package readiness must be typed unavailable');
  }
  for (const forbidden of [
    'appId', 'releaseDescriptorRef', 'storagePolicyRef', 'expectedVersion', 'activeVersion',
    'installedVersion', 'sha256', 'verificationState', 'path', 'evidence', 'jobId',
  ]) {
    if (forbidden in (value as unknown as Record<string, unknown>)) {
      throw new Error(`Runtime package readiness leaked forbidden field ${forbidden}`);
    }
  }
}

function validateLocalRecord(row: NimiAppLocalRecordRow, index: number): void {
  if (!row || typeof row !== 'object' || !row.appId?.trim() || !row.displayName?.trim()) {
    throw new Error(`Runtime local-record source row ${index} is invalid`);
  }
  if (!['verified', 'user_imported', 'local_development'].includes(row.trustClass)) {
    throw new Error(`Runtime local-record source row ${index} has invalid trustClass`);
  }
  if (!['active', 'dormant', 'removed'].includes(row.recordState)) {
    throw new Error(`Runtime local-record source row ${index} has invalid recordState`);
  }
}

function resolveInstallState(
  account: NimiAppAccountInventoryRow | undefined,
  localRecord: NimiAppLocalRecordRow | undefined,
): NimiAppInventoryInstallState {
  if (localRecord?.recordState === 'active') return 'local-record-active';
  if (localRecord?.recordState === 'dormant') return 'local-record-dormant';
  if (localRecord?.recordState === 'removed') return 'removed';
  return account?.installState ?? (account ? 'not-present' : 'unknown');
}

function resolveOpenReadiness(
  catalog: NimiAppRow | undefined,
  account: NimiAppAccountInventoryRow | undefined,
  localRecord: NimiAppLocalRecordRow | undefined,
): NimiAppInventoryEntry['openReadiness'] {
  if (localRecord && !account) return 'sign-in-required';
  if (account && !isLaunchableAccountInventoryRow(account)) return 'unsupported';
  if (localRecord?.recordState === 'dormant') return 'local-record-dormant';
  if (localRecord?.recordState === 'removed') return 'unsupported';
  if (localRecord?.recordState === 'active') {
    if (localRecord.sessionState !== 'session-bound') return 'unsupported';
    return localRecord.grantPosture === 'granted' ? 'ready' : 'permission-required';
  }
  return catalog ? 'package-unavailable' : 'unsupported';
}

function resolveNextActions(
  openReadiness: NimiAppInventoryEntry['openReadiness'],
  hasAccount: boolean,
  hasLocalRecord: boolean,
): readonly NimiAppInventoryNextAction[] {
  const actions = new Set<NimiAppInventoryNextAction>();
  if (!hasAccount && hasLocalRecord) actions.add('sign-in');
  if (openReadiness === 'ready') actions.add('open');
  if (openReadiness === 'permission-required') actions.add('review-permissions');
  return [...actions];
}

function isLaunchableAccountInventoryRow(account: NimiAppAccountInventoryRow): boolean {
  return account.accountState === 'verified' || account.accountState === 'entitled';
}

type DescriptorResolution =
  | { readonly ok: true; readonly descriptor: NimiAppReleaseDescriptorRow }
  | { readonly ok: false; readonly reason: string; readonly descriptor?: NimiAppReleaseDescriptorRow };

function resolveOrdinaryVisibleDescriptor(
  row: NimiAppRegistrySourceRow,
  descriptors: readonly NimiAppReleaseDescriptorRow[],
): DescriptorResolution {
  if (row.admissionStatus !== 'admitted') return { ok: false, reason: 'app-not-admitted' };
  if (row.ordinaryVisibility !== 'ordinary-visible') return { ok: false, reason: 'app-not-ordinary-visible' };
  if (row.appKind !== 'nimi-app') return { ok: false, reason: 'app-kind-not-nimi-app' };
  const descriptor = descriptors.find((candidate) => candidate.descriptorId === row.releaseDescriptorRef);
  if (!descriptor) return { ok: false, reason: 'release-descriptor-missing' };
  if (!isDescriptorValidForRow(row, descriptor)) {
    return { ok: false, reason: 'release-descriptor-invalid-for-registry-row', descriptor };
  }
  return { ok: true, descriptor };
}

function isDescriptorValidForRow(
  row: NimiAppRegistrySourceRow,
  descriptor: NimiAppReleaseDescriptorRow,
): boolean {
  if (descriptor.appId !== row.appId) return false;
  if (descriptor.packageKind !== 'nimi-app') return false;
  if (descriptor.storagePolicyRef !== row.installStoragePolicyRef) return false;
  if (descriptor.digestAlgorithm !== 'sha256' || descriptor.mutableSourceAllowed) return false;
  if (!descriptor.installDigestVerificationRequired || !descriptor.admissionPath) return false;
  if (descriptor.descriptorClass === 'bundled-with-nimi') return descriptor.sourceKind === 'nimi-bundle';
  if (descriptor.descriptorClass !== 'external-immutable-artifact' || descriptor.sourceKind === 'nimi-bundle') return false;
  return !isMutableSourceRef(descriptor.sourceKind, descriptor.sourceRef);
}

function isMutableSourceRef(sourceKind: NimiAppReleaseDescriptorRow['sourceKind'], ref: string): boolean {
  const normalized = ref.trim().toLowerCase();
  if (!normalized || ['main', 'master', 'latest', 'next', 'stable'].includes(normalized)) return true;
  if (normalized.startsWith('tag:') || /[*^~<>|=]/.test(normalized)) return true;
  if (normalized.includes('/tree/') || normalized.includes('refs/heads/') || normalized.includes('refs/tags/')) return true;
  if (normalized.includes('/releases/tag/') || normalized.includes('#main') || normalized.includes('#master')) return true;
  if (/@(?:latest|next|beta|canary)$/.test(normalized) || /@\d+\.x(?:$|[/?#])/.test(normalized)) return true;
  if (sourceKind === 'npm-package') return !exactNpmPackageVersionRef(normalized);
  if (sourceKind === 'github-commit') return !/^[a-f0-9]{40}$/.test(normalized.replace(/^commit:/, ''));
  if (sourceKind === 'github-release') return !immutableGithubReleaseArtifactRef(normalized);
  return true;
}

function exactNpmPackageVersionRef(ref: string): boolean {
  const at = ref.lastIndexOf('@');
  if (at <= 0 || at === ref.length - 1) return false;
  return /^\d+\.\d+\.\d+$/.test((ref.slice(at + 1).split('-', 1)[0] ?? ''));
}

function immutableGithubReleaseArtifactRef(ref: string): boolean {
  return /(?:^|\/)releases\/download\/[^/]+\/[^/]+$/.test(ref)
    || /^github-release:[^#]+#[^#]+#[^#]+$/.test(ref);
}

function defaultStatusDetail(
  readiness: AppLaunchReadiness,
  descriptorResolution: DescriptorResolution,
  packageReadiness: NimiAppPackageReadinessUnavailable | undefined,
): string {
  if (readiness === 'unsupported') {
    return descriptorResolution.ok
      ? 'registry row is unsupported'
      : `registry row is not available: ${descriptorResolution.reason}`;
  }
  if (readiness === 'blocked-by-master-gate') return 'app is blocked by master product gate';
  return packageReadiness?.detail || 'immutable package materialization is unavailable until 0P';
}

function present<T>(value: T): NimiAppInventorySource<T> {
  return { status: 'present', value };
}

function absent<T>(): NimiAppInventorySource<T> {
  return { status: 'absent' };
}

function degraded<T>(source: DegradedSource): NimiAppInventorySource<T> {
  return { status: 'degraded', reasonCode: source.reasonCode, detail: source.detail };
}

function sourceDegraded(reasonCode: string, detail: string): DegradedSource {
  return { reasonCode, detail };
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function missingRow(appId: string): NimiAppRegistryTransportError {
  return new NimiAppRegistryTransportError('missing-registry-row', `Nimi App registry row missing for app "${appId}"`);
}

function assertRegistryTransportOptions(options: NimiAppRegistryTransportOptions): void {
  if (typeof options?.loadRows !== 'function') {
    throw new NimiAppRegistryTransportError('invalid-dependency', 'loadRows callback is required');
  }
  if (typeof options.loadReleaseDescriptors !== 'function') {
    throw new NimiAppRegistryTransportError('invalid-dependency', 'loadReleaseDescriptors callback is required');
  }
}
