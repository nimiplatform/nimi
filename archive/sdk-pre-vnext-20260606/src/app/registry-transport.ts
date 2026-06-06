// T4 Fork B: createNimiAppRegistryTransport builds a pure read-projection
// transport — list / get / status only. Nimi App lifecycle mutation (install /
// update / uninstall / open / healthRepair) is owned by the runtime-mediated
// `runtime.appLifecycle` surface; this transport carries no mutation stubs.
// App-scoped storage roots are also Runtime-owned (`GetAppStorage`), so this
// registry transport must not project storage roots from host-scanned install
// evidence. Package readiness is Runtime-owned (`GetAppPackageReadiness`), so
// Runtime-backed consumers pass a typed readiness loader instead of scanned
// install evidence.

import type { NimiAppTransport } from './transport.js';
import type {
  AppKind,
  AppLaunchReadiness,
  NimiAppOrdinaryVisibility,
  NimiAppPackageReadinessRow,
  NimiAppReleaseDescriptorRow,
  NimiAppRow,
  NimiAppStatus,
  TrustTierId,
} from './types.js';

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
  readonly loadReleaseDescriptors: () => Promise<readonly NimiAppReleaseDescriptorRow[]> | readonly NimiAppReleaseDescriptorRow[];
  readonly loadPackageReadiness?: (appId: string) => Promise<NimiAppPackageReadinessRow | undefined> | NimiAppPackageReadinessRow | undefined;
}

export class NimiAppRegistryTransportError extends Error {
  readonly code: 'invalid-dependency' | 'missing-registry-row' | 'source-error';

  constructor(
    code: NimiAppRegistryTransportError['code'],
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'NimiAppRegistryTransportError';
  }
}

export function createNimiAppRegistryTransport(options: NimiAppRegistryTransportOptions): NimiAppTransport {
  assertRegistryTransportOptions(options);
  return {
    async list(): Promise<readonly NimiAppRow[]> {
      const [rows, descriptors] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
      ]);
      return rows
        .filter((row) => resolveOrdinaryVisibleDescriptor(row, descriptors).ok)
        .map(toClientRow);
    },
    async get(appId: string): Promise<NimiAppRow> {
      const [rows, descriptors] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!row) {
        throw missingRow(appId);
      }
      if (!resolveOrdinaryVisibleDescriptor(row, descriptors).ok) {
        throw new NimiAppRegistryTransportError(
          'missing-registry-row',
          `Nimi App "${appId}" is not ordinary-visible with a resolved release descriptor and storage policy`,
        );
      }
      return toClientRow(row);
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
      if (!resolveOrdinaryVisibleDescriptor(row, descriptors).ok) {
        throw new NimiAppRegistryTransportError(
          'missing-registry-row',
          `Nimi App "${appId}" is not ordinary-visible with a resolved release descriptor and storage policy`,
        );
      }
      const packageReadiness = await loadPackageReadiness(options.loadPackageReadiness, appId);
      return defaultStatus(row, descriptors, packageReadiness);
    },
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
): NimiAppStatus['verificationState'] {
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
