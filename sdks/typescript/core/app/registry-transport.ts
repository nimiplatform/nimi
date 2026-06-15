import type {
  AppKind,
  AppLaunchReadiness,
  NimiAppInstallVerificationState,
  NimiAppInventoryEntry,
  NimiAppInventoryInstallState,
  NimiAppInventoryJobSummary,
  NimiAppInventoryNextAction,
  NimiAppInventorySource,
  NimiAppAccountInventorySourceRow,
  NimiAppLocalAdoptionRow,
  NimiAppOpenReadiness,
  NimiAppOrdinaryVisibility,
  NimiAppPackageReadinessRow,
  NimiAppReleaseDescriptorRow,
  NimiAppRow,
  NimiAppStatus,
  NimiAppTransport,
  TrustTierId,
} from './index.js';
import type {
  NimiAppAccountInventoryProjection,
  NimiAppAccountInventoryRecord,
  NimiAppAccountInventoryRow,
} from './account-inventory.js';

export type NimiAppAdmissionStatus =
  | 'admitted'
  | 'gated_by_avatar_master_gate'
  | 'permission_fabric_pending'
  | 'deferred'
  | 'retired';

export interface NimiAppRegistrySourceRow {
  readonly appId: string;
  readonly appKind: AppKind;
  readonly displayName: string;
  readonly publisher: string;
  readonly trustTier: TrustTierId;
  readonly ordinaryVisibility: NimiAppOrdinaryVisibility;
  readonly aiProfileSelectionRef: string;
  readonly capabilitySet: readonly string[];
  readonly releaseDescriptorRef: string;
  readonly installStoragePolicyRef: string;
  readonly sourceRule: string;
  readonly admissionStatus: NimiAppAdmissionStatus;
  readonly installedVersion?: string;
  readonly availableVersion?: string;
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
  readonly loadLocalAdoptions?: () =>
    Promise<readonly NimiAppLocalAdoptionRow[] | null | undefined>
    | readonly NimiAppLocalAdoptionRow[]
    | null
    | undefined;
  readonly loadPackageReadiness?: (
    appId: string,
  ) => Promise<NimiAppPackageReadinessRow | undefined> | NimiAppPackageReadinessRow | undefined;
  readonly loadActiveJobs?: (
    appId: string,
  ) => Promise<readonly NimiAppInventoryJobSummary[] | undefined> | readonly NimiAppInventoryJobSummary[] | undefined;
}

export class NimiAppRegistryTransportError extends Error {
  readonly code: 'invalid-dependency' | 'missing-registry-row' | 'source-error';

  constructor(
    code: NimiAppRegistryTransportError['code'],
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
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
      const entries = await composeInventory(options);
      const entry = entries.find((candidate) => candidate.appId === appId);
      if (!entry) throw missingRow(appId);
      return entry;
    },
    async status(appId: string): Promise<NimiAppStatus> {
      const [rows, descriptors] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) {
        throw missingRow(appId);
      }
      const packageReadiness = await loadPackageReadiness(options.loadPackageReadiness, appId);
      return defaultStatus(row, descriptors, packageReadiness);
    },
  };
}

async function composeInventory(options: NimiAppRegistryTransportOptions): Promise<readonly NimiAppInventoryEntry[]> {
  const [rows, descriptors] = await Promise.all([
    loadRows(options.loadRows),
    loadReleaseDescriptors(options.loadReleaseDescriptors),
  ]);
  const catalogById = new Map<string, NimiAppRow>();
  for (const row of rows) {
    if (resolveOrdinaryVisibleDescriptor(row, descriptors).ok) {
      catalogById.set(row.appId, toClientRow(row));
    }
  }

  const accountResult = await loadOptionalAccountInventory(options.loadAccountInventory);
  const accountById = new Map<string, NimiAppAccountInventoryRow>();
  if (accountResult.record) {
    for (const row of accountResult.record.apps) accountById.set(row.appId, row);
  }

  const localResult = await loadOptionalLocalAdoptions(options.loadLocalAdoptions);
  const localById = new Map<string, NimiAppLocalAdoptionRow>();
  if (localResult.rows) {
    for (const row of localResult.rows) localById.set(row.appId, row);
  }

  const appIds = new Set<string>([
    ...catalogById.keys(),
    ...accountById.keys(),
    ...localById.keys(),
  ]);

  const entries = await Promise.all([...appIds].sort().map(async (appId) => {
    const packageReadiness = await loadOptionalPackageReadiness(options.loadPackageReadiness, appId);
    const activeJobs = await loadOptionalActiveJobs(options.loadActiveJobs, appId);
    return composeInventoryEntry({
      appId,
      catalog: catalogById.get(appId),
      account: accountById.get(appId),
      local: localById.get(appId),
      accountDegraded: accountResult.degraded,
      localDegraded: localResult.degraded,
      packageReadiness,
      activeJobs,
    });
  }));

  return entries.filter(Boolean) as readonly NimiAppInventoryEntry[];
}

function composeInventoryEntry(input: {
  readonly appId: string;
  readonly catalog?: NimiAppRow;
  readonly account?: NimiAppAccountInventoryRow;
  readonly local?: NimiAppLocalAdoptionRow;
  readonly accountDegraded?: DegradedSource;
  readonly localDegraded?: DegradedSource;
  readonly packageReadiness: OptionalSourceLoad<NimiAppPackageReadinessRow>;
  readonly activeJobs: OptionalSourceLoad<readonly NimiAppInventoryJobSummary[]>;
}): NimiAppInventoryEntry {
  const sources = {
    catalog: input.catalog ? present(input.catalog) : absent<NimiAppRow>(),
    account: input.account
      ? present(toAccountInventorySourceRow(input.account))
      : input.accountDegraded
        ? degraded<NimiAppAccountInventorySourceRow>(input.accountDegraded)
        : absent<NimiAppAccountInventorySourceRow>(),
    local: input.local
      ? present(input.local)
      : input.localDegraded
        ? degraded<NimiAppLocalAdoptionRow>(input.localDegraded)
        : absent<NimiAppLocalAdoptionRow>(),
    packageReadiness: input.packageReadiness.value
      ? present(input.packageReadiness.value)
      : input.packageReadiness.degraded
        ? degraded<NimiAppPackageReadinessRow>(input.packageReadiness.degraded)
        : absent<NimiAppPackageReadinessRow>(),
  };
  const activeJobs = input.activeJobs.value ? [...input.activeJobs.value] : [];
  const installState = resolveInstallState(input.account, input.local, input.packageReadiness.value, activeJobs);
  const openReadiness = resolveOpenReadiness(input.account, input.local, input.packageReadiness.value, installState);
  return {
    appId: input.appId,
    displayName: input.catalog?.displayName || input.local?.displayName || input.appId,
    ...(input.catalog?.appKind ? { appKind: input.catalog.appKind } : {}),
    ...(input.catalog?.publisher ? { publisher: input.catalog.publisher } : input.local ? { publisher: 'Local' } : {}),
    ...(input.catalog?.aiProfileSelectionRef ? { aiProfileSelectionRef: input.catalog.aiProfileSelectionRef } : {}),
    ...(input.catalog?.releaseDescriptorRef ? { releaseDescriptorRef: input.catalog.releaseDescriptorRef } : {}),
    ...(input.catalog?.installStoragePolicyRef ? { installStoragePolicyRef: input.catalog.installStoragePolicyRef } : {}),
    trustTier: resolveInventoryTrustTier(input.catalog, input.local),
    capabilitySet: input.catalog ? [...input.catalog.capabilitySet] : [],
    sources,
    installState,
    openReadiness,
    activeJobs,
    nextActions: resolveNextActions({
      account: input.account,
      local: input.local,
      catalog: input.catalog,
      openReadiness,
      installState,
      activeJobs,
    }),
    ...(input.packageReadiness.value?.reasonCode ? { reasonCode: input.packageReadiness.value.reasonCode } : {}),
    ...(input.packageReadiness.value?.detail ? { detail: input.packageReadiness.value.detail } : {}),
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
    throw new NimiAppRegistryTransportError('source-error', 'Nimi App registry source failed', error);
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
    throw new NimiAppRegistryTransportError('source-error', 'Nimi App release descriptor source failed', error);
  }
}

async function loadPackageReadiness(
  load: NimiAppRegistryTransportOptions['loadPackageReadiness'],
  appId: string,
): Promise<NimiAppPackageReadinessRow | undefined> {
  if (!load) return undefined;
  try {
    const projection = await load(appId);
    if (!projection) return undefined;
    if (projection.appId !== appId) {
      throw new NimiAppRegistryTransportError(
        'source-error',
        `Nimi App package readiness source returned ${projection.appId} for ${appId}`,
      );
    }
    return projection;
  } catch (error) {
    if (error instanceof NimiAppRegistryTransportError) throw error;
    throw new NimiAppRegistryTransportError('source-error', 'Nimi App package readiness source failed', error);
  }
}

function toClientRow(row: NimiAppRegistrySourceRow): NimiAppRow {
  return {
    appId: row.appId,
    appKind: row.appKind,
    displayName: row.displayName,
    trustTier: row.trustTier,
    publisher: row.publisher,
    aiProfileSelectionRef: row.aiProfileSelectionRef,
    capabilitySet: [...row.capabilitySet],
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    sourceRule: row.sourceRule,
  };
}

function defaultStatus(
  row: NimiAppRegistrySourceRow,
  descriptors: readonly NimiAppReleaseDescriptorRow[],
  packageReadiness: NimiAppPackageReadinessRow | undefined,
): NimiAppStatus {
  const descriptorResolution = resolveOrdinaryVisibleDescriptor(row, descriptors);
  const readiness = admissionToReadiness(row, descriptorResolution, packageReadiness);
  return {
    appId: row.appId,
    launchReadiness: readiness,
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    verificationState: normalizeVerificationState(packageReadiness?.verificationState, readiness),
    installedVersion: packageReadiness?.installedVersion ?? packageReadiness?.activeVersion ?? row.installedVersion,
    availableVersion: row.availableVersion,
    detail: row.detail || defaultStatusDetail(readiness, descriptorResolution, packageReadiness),
  };
}

function normalizeVerificationState(
  value: string | undefined,
  readiness: AppLaunchReadiness,
): NimiAppInstallVerificationState {
  switch (value) {
    case 'digest-verified':
    case 'bundled-source':
    case 'digest-mismatch':
    case 'blocked':
    case 'unsupported':
    case 'not-installed':
      return value;
    default:
      return readiness === 'install-required' ? 'not-installed' : 'blocked';
  }
}

function admissionToReadiness(
  row: NimiAppRegistrySourceRow,
  descriptorResolution: DescriptorResolution,
  packageReadiness: NimiAppPackageReadinessRow | undefined,
): AppLaunchReadiness {
  switch (row.admissionStatus) {
    case 'admitted':
      if (!descriptorResolution.ok) return 'unsupported';
      if (!packageReadiness) return 'install-required';
      return packageReadinessToReadiness(packageReadiness);
    case 'gated_by_avatar_master_gate':
      return 'blocked-by-master-gate';
    case 'permission_fabric_pending':
    case 'deferred':
    case 'retired':
      return 'unsupported';
  }
}

function packageReadinessToReadiness(packageReadiness: NimiAppPackageReadinessRow): AppLaunchReadiness {
  switch (packageReadiness.state) {
    case 'ready':
      return 'ready';
    case 'install_required':
      return 'install-required';
    case 'update_required':
      return 'update-required';
    case 'repair_required':
    case 'blocked':
      return 'repair-required';
  }
}

type DescriptorResolution =
  | { readonly ok: true; readonly descriptor: NimiAppReleaseDescriptorRow }
  | { readonly ok: false; readonly reason: string; readonly descriptor?: NimiAppReleaseDescriptorRow };

type DegradedSource = {
  readonly reasonCode: string;
  readonly detail: string;
};

type OptionalSourceLoad<T> =
  | { readonly value?: T; readonly degraded?: undefined }
  | { readonly value?: undefined; readonly degraded: DegradedSource };

async function loadOptionalAccountInventory(
  load: NimiAppRegistryTransportOptions['loadAccountInventory'],
): Promise<{ readonly record?: NimiAppAccountInventoryRecord; readonly degraded?: DegradedSource }> {
  if (!load) return {};
  try {
    const projection = await load();
    if (!projection) return {};
    if ('exists' in projection) {
      if (projection.exists !== true) return {};
      if (!projection.record) {
        return {
          degraded: sourceDegraded('SDK_APP_ACCOUNT_INVENTORY_RECORD_MISSING', 'account inventory exists without record'),
        };
      }
      return { record: projection.record };
    }
    return { record: projection };
  } catch (error) {
    return {
      degraded: sourceDegraded('SDK_APP_ACCOUNT_INVENTORY_SOURCE_FAILED', errorDetail(error)),
    };
  }
}

async function loadOptionalLocalAdoptions(
  load: NimiAppRegistryTransportOptions['loadLocalAdoptions'],
): Promise<{ readonly rows?: readonly NimiAppLocalAdoptionRow[]; readonly degraded?: DegradedSource }> {
  if (!load) return {};
  try {
    const rows = await load();
    if (!rows) return {};
    if (!Array.isArray(rows)) {
      return {
        degraded: sourceDegraded('SDK_APP_LOCAL_ADOPTIONS_SOURCE_INVALID', 'local app adoptions source did not return an array'),
      };
    }
    return { rows };
  } catch (error) {
    return {
      degraded: sourceDegraded('SDK_APP_LOCAL_ADOPTIONS_SOURCE_FAILED', errorDetail(error)),
    };
  }
}

async function loadOptionalPackageReadiness(
  load: NimiAppRegistryTransportOptions['loadPackageReadiness'],
  appId: string,
): Promise<OptionalSourceLoad<NimiAppPackageReadinessRow>> {
  if (!load) return {};
  try {
    const projection = await load(appId);
    if (!projection) return {};
    if (projection.appId !== appId) {
      return {
        degraded: sourceDegraded(
          'SDK_APP_PACKAGE_READINESS_APP_ID_MISMATCH',
          `package readiness source returned ${projection.appId} for ${appId}`,
        ),
      };
    }
    return { value: projection };
  } catch (error) {
    return {
      degraded: sourceDegraded('SDK_APP_PACKAGE_READINESS_SOURCE_FAILED', errorDetail(error)),
    };
  }
}

async function loadOptionalActiveJobs(
  load: NimiAppRegistryTransportOptions['loadActiveJobs'],
  appId: string,
): Promise<OptionalSourceLoad<readonly NimiAppInventoryJobSummary[]>> {
  if (!load) return {};
  try {
    const jobs = await load(appId);
    if (!jobs) return {};
    if (!Array.isArray(jobs)) {
      return {
        degraded: sourceDegraded('SDK_APP_ACTIVE_JOBS_SOURCE_INVALID', 'active jobs source did not return an array'),
      };
    }
    return { value: jobs.filter((job) => job.appId === appId) };
  } catch (error) {
    return {
      degraded: sourceDegraded('SDK_APP_ACTIVE_JOBS_SOURCE_FAILED', errorDetail(error)),
    };
  }
}

function present<T>(value: T): NimiAppInventorySource<T> {
  return { status: 'present', value };
}

function absent<T>(): NimiAppInventorySource<T> {
  return { status: 'absent' };
}

function degraded<T>(source: DegradedSource): NimiAppInventorySource<T> {
  return {
    status: 'degraded',
    reasonCode: source.reasonCode,
    detail: source.detail,
  };
}

function sourceDegraded(reasonCode: string, detail: string): DegradedSource {
  return { reasonCode, detail };
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error || 'source failed');
}

function toAccountInventorySourceRow(row: NimiAppAccountInventoryRow): NimiAppAccountInventorySourceRow {
  return { ...row };
}

function resolveInventoryTrustTier(
  catalog: NimiAppRow | undefined,
  local: NimiAppLocalAdoptionRow | undefined,
): NimiAppInventoryEntry['trustTier'] {
  if (catalog) return catalog.trustTier;
  if (local?.trust === 'developer-local') return 'local-developer';
  if (local) return 'local-explicit';
  return 'unknown';
}

function resolveInstallState(
  account: NimiAppAccountInventoryRow | undefined,
  local: NimiAppLocalAdoptionRow | undefined,
  readiness: NimiAppPackageReadinessRow | undefined,
  activeJobs: readonly NimiAppInventoryJobSummary[],
): NimiAppInventoryInstallState {
  const activeJob = activeJobs.find((job) => job.state === 'queued' || job.state === 'in_progress');
  if (activeJob?.kind === 'install') return 'installing';
  if (activeJob?.kind === 'update') return 'updating';
  if (activeJob?.kind === 'repair') return 'repair-required';
  if (local?.state === 'adopted') return 'adopted-local';
  if (local?.state === 'repair-required') return 'repair-required';
  if (account?.installState === 'installed') return 'installed';
  if (account?.installState === 'adopted-local') return 'adopted-local';
  if (account?.installState === 'removed') return 'removed';
  if (readiness?.state === 'repair_required' || readiness?.state === 'blocked') return 'repair-required';
  return account ? 'not-installed' : 'unknown';
}

function resolveOpenReadiness(
  account: NimiAppAccountInventoryRow | undefined,
  local: NimiAppLocalAdoptionRow | undefined,
  readiness: NimiAppPackageReadinessRow | undefined,
  installState: NimiAppInventoryInstallState,
): NimiAppOpenReadiness {
  if (!account) return 'sign-in-required';
  if (!isLaunchableAccountInventoryRow(account)) {
    return 'unsupported';
  }
  if (account.installState !== 'installed' && account.installState !== 'adopted-local') {
    return 'install-required';
  }
  if (local?.state === 'repair-required' || installState === 'repair-required') return 'repair-required';
  if (account.installState === 'adopted-local' && local?.state === 'adopted') return 'ready';
  if (!readiness) return 'install-required';
  return packageReadinessToReadiness(readiness);
}

function isLaunchableAccountInventoryRow(account: NimiAppAccountInventoryRow): boolean {
  return account.accountState === 'verified' || account.accountState === 'entitled';
}

function resolveNextActions(input: {
  readonly account?: NimiAppAccountInventoryRow;
  readonly local?: NimiAppLocalAdoptionRow;
  readonly catalog?: NimiAppRow;
  readonly openReadiness: NimiAppOpenReadiness;
  readonly installState: NimiAppInventoryInstallState;
  readonly activeJobs: readonly NimiAppInventoryJobSummary[];
}): readonly NimiAppInventoryNextAction[] {
  if (input.activeJobs.some((job) => job.state === 'queued' || job.state === 'in_progress')) {
    return [];
  }
  const actions = new Set<NimiAppInventoryNextAction>();
  const launchableAccount = input.account && isLaunchableAccountInventoryRow(input.account);
  if (input.openReadiness === 'ready') actions.add('open');
  if (input.openReadiness === 'sign-in-required') actions.add('sign-in');
  if (input.openReadiness === 'permission-required') actions.add('review-permissions');
  if (input.openReadiness === 'repair-required' || input.installState === 'repair-required') actions.add('repair');
  if (input.openReadiness === 'update-required') actions.add('update');
  if (launchableAccount && input.installState === 'not-installed' && input.catalog) actions.add('install');
  if (launchableAccount && input.installState === 'not-installed' && !input.catalog) actions.add('connect-local');
  if (launchableAccount && input.installState === 'installed' && input.catalog) {
    actions.add('uninstall');
  }
  if (input.local && input.local.state !== 'removed') actions.add('remove-local-adoption');
  return [...actions];
}

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
  if (descriptor.digestAlgorithm !== 'sha256') return false;
  if (descriptor.mutableSourceAllowed) return false;
  if (descriptor.installDigestVerificationRequired.length === 0) return false;
  if (descriptor.admissionPath.length === 0) return false;
  if (descriptor.descriptorClass === 'bundled-with-nimi') {
    return descriptor.sourceKind === 'nimi-bundle';
  }
  if (descriptor.descriptorClass !== 'external-immutable-artifact') return false;
  if (descriptor.sourceKind === 'nimi-bundle') return false;
  return !isMutableSourceRef(descriptor.sourceKind, descriptor.sourceRef);
}

function defaultStatusDetail(
  readiness: AppLaunchReadiness,
  descriptorResolution: DescriptorResolution,
  packageReadiness: NimiAppPackageReadinessRow | undefined,
): string | undefined {
  if (readiness === 'unsupported') {
    return descriptorResolution.ok
      ? 'registry row is unsupported'
      : `registry row is not installable: ${descriptorResolution.reason}`;
  }
  if (readiness === 'blocked-by-master-gate') {
    return 'app is blocked by master product gate';
  }
  if (packageReadiness?.detail) {
    return packageReadiness.detail;
  }
  if (readiness === 'install-required' && !packageReadiness) {
    return 'descriptor resolved, but no Runtime package readiness projection exists';
  }
  if (readiness === 'repair-required') {
    return 'Runtime package readiness requires repair';
  }
  return undefined;
}

function missingRow(appId: string): NimiAppRegistryTransportError {
  return new NimiAppRegistryTransportError(
    'missing-registry-row',
    `Nimi App registry row missing for app "${appId}"`,
  );
}

function assertRegistryTransportOptions(options: NimiAppRegistryTransportOptions): void {
  if (typeof options?.loadRows !== 'function') {
    throw new NimiAppRegistryTransportError('invalid-dependency', 'loadRows callback is required');
  }
  if (typeof options.loadReleaseDescriptors !== 'function') {
    throw new NimiAppRegistryTransportError('invalid-dependency', 'loadReleaseDescriptors callback is required');
  }
}

function isMutableSourceRef(sourceKind: NimiAppReleaseDescriptorRow['sourceKind'], ref: string): boolean {
  const normalized = ref.trim().toLowerCase();
  if (normalized === '' || normalized === 'main' || normalized === 'master' || normalized === 'latest' || normalized === 'next' || normalized === 'stable') {
    return true;
  }
  if (normalized.startsWith('tag:') || /[*^~<>|=]/.test(normalized)) {
    return true;
  }
  return normalized.includes('/tree/')
    || normalized.includes('refs/heads/')
    || normalized.includes('refs/tags/')
    || normalized.includes('/releases/tag/')
    || normalized.includes('#main')
    || normalized.includes('#master')
    || normalized.endsWith('@latest')
    || normalized.endsWith('@next')
    || normalized.includes('@beta')
    || normalized.includes('@canary')
    || /@\d+\.x(?:$|[/?#])/.test(normalized)
    || mutableBySourceKind(sourceKind, normalized);
}

function mutableBySourceKind(sourceKind: NimiAppReleaseDescriptorRow['sourceKind'], normalizedRef: string): boolean {
  if (sourceKind === 'npm-package') {
    return !exactNpmPackageVersionRef(normalizedRef);
  }
  if (sourceKind === 'github-commit') {
    return !exactGitCommitRef(normalizedRef);
  }
  if (sourceKind === 'github-release') {
    return bareGitTagRef(normalizedRef) || !immutableGithubReleaseArtifactRef(normalizedRef);
  }
  return true;
}

function exactNpmPackageVersionRef(ref: string): boolean {
  const at = ref.lastIndexOf('@');
  if (at <= 0 || at === ref.length - 1) return false;
  const version = ref.slice(at + 1);
  const core = version.split('-', 1)[0] ?? '';
  return /^\d+\.\d+\.\d+$/.test(core);
}

function exactGitCommitRef(ref: string): boolean {
  return /^[0-9a-f]{40}$/.test(ref) || /\/commit\/[0-9a-f]{40}$/.test(ref);
}

function bareGitTagRef(ref: string): boolean {
  if (ref.includes('/') || ref.includes(':') || ref.includes('#')) return false;
  return ref.startsWith('v') || ref.startsWith('release-');
}

function immutableGithubReleaseArtifactRef(ref: string): boolean {
  const marker = '/releases/download/';
  const index = ref.indexOf(marker);
  if (index < 0) return false;
  const rest = ref.slice(index + marker.length);
  const [releaseSegment, artifactSegment] = rest.split('/', 2);
  if (!releaseSegment || !artifactSegment) return false;
  return !['latest', 'main', 'master', 'next', 'stable'].includes(releaseSegment);
}
