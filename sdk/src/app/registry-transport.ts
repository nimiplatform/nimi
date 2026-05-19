import type { NimiAppTransport } from './transport.js';
import type {
  AppKind,
  AppLaunchReadiness,
  NimiAppHealthRepairAction,
  NimiAppInstallEvidenceRow,
  NimiAppLifecycleEvent,
  NimiAppLaunchScopeRef,
  NimiAppOperationResult,
  NimiAppOrdinaryVisibility,
  NimiAppReleaseDescriptorRow,
  NimiAppRow,
  NimiAppStatus,
  NimiAppSubscription,
  TrustTierId,
} from './types.js';

export type NimiAppAdmissionStatus =
  | 'admitted'
  | 'gated_by_avatar_master_gate'
  | 'pending_wave_4'
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
  readonly loadInstallEvidence?: () => Promise<readonly NimiAppInstallEvidenceRow[]> | readonly NimiAppInstallEvidenceRow[];
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
      const [rows, descriptors, installEvidence] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
        loadInstallEvidence(options.loadInstallEvidence),
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
      return defaultStatus(row, descriptors, installEvidence);
    },
    async install(appId: string): Promise<NimiAppOperationResult> {
      const [rows, descriptors] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      return failClosedOperation('install', appId, row, descriptors);
    },
    async update(appId: string): Promise<NimiAppOperationResult> {
      const [rows, descriptors] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      return failClosedOperation('update', appId, row, descriptors);
    },
    async uninstall(appId: string): Promise<NimiAppOperationResult> {
      const [rows, descriptors] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      return failClosedOperation('uninstall', appId, row, descriptors);
    },
    async launch(appId: string, scopeRef: NimiAppLaunchScopeRef): Promise<NimiAppOperationResult> {
      const [rows, descriptors, installEvidence] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
        loadInstallEvidence(options.loadInstallEvidence),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      if (!scopeRef || !scopeRef.scopeId) {
        return {
          appId,
          operation: 'launch',
          state: 'failed',
          reason: 'canonical-scope-ref-required',
          detail: 'app.launch requires an explicit AIScopeRef',
        };
      }
      const status = row ? defaultStatus(row, descriptors, installEvidence) : undefined;
      if (status?.launchReadiness === 'ready') {
        return {
          appId,
          operation: 'launch',
          state: 'unsupported',
          reason: 'runtime-mediated-app-launch-not-connected',
          detail: 'Descriptor and install evidence are verified, but the runtime app launcher is not connected.',
        };
      }
      return failClosedOperation('launch', appId, row, descriptors);
    },
    subscribe(_callback: (event: NimiAppLifecycleEvent) => void): NimiAppSubscription {
      return {
        subscribed: false,
        reason: 'app-lifecycle-subscription-transport-not-connected',
        unsubscribe: () => {},
      };
    },
    async healthRepair(appId: string, _action: NimiAppHealthRepairAction): Promise<NimiAppOperationResult> {
      const [rows, descriptors] = await Promise.all([
        loadRows(options.loadRows),
        loadReleaseDescriptors(options.loadReleaseDescriptors),
      ]);
      const row = rows.find((candidate) => candidate.appId === appId);
      return failClosedOperation('health-repair', appId, row, descriptors);
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

async function loadInstallEvidence(
  load: NimiAppRegistryTransportOptions['loadInstallEvidence'],
): Promise<readonly NimiAppInstallEvidenceRow[]> {
  if (!load) return [];
  try {
    const rows = await load();
    if (!Array.isArray(rows)) {
      throw new NimiAppRegistryTransportError('source-error', 'Nimi App install evidence source did not return an array');
    }
    return rows;
  } catch (error) {
    if (error instanceof NimiAppRegistryTransportError) throw error;
    throw new NimiAppRegistryTransportError('source-error', 'Nimi App install evidence source failed', error);
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
  installEvidence: readonly NimiAppInstallEvidenceRow[],
): NimiAppStatus {
  const descriptorResolution = resolveOrdinaryVisibleDescriptor(row, descriptors);
  const evidence = descriptorResolution.descriptor
    ? findInstallEvidence(row, descriptorResolution.descriptor, installEvidence)
    : undefined;
  const readiness = admissionToReadiness(row, descriptorResolution, evidence);
  return {
    appId: row.appId,
    launchReadiness: readiness,
    releaseDescriptorRef: row.releaseDescriptorRef,
    installStoragePolicyRef: row.installStoragePolicyRef,
    storageRoots: evidence?.storageRoots,
    verificationState: evidence?.verificationState ?? (readiness === 'install-required' ? 'not-installed' : 'blocked'),
    installedVersion: evidence?.installedVersion ?? row.installedVersion,
    availableVersion: row.availableVersion,
    detail: row.detail || defaultStatusDetail(row, readiness, descriptorResolution, evidence),
  };
}

function admissionToReadiness(
  row: NimiAppRegistrySourceRow,
  descriptorResolution: DescriptorResolution,
  evidence: NimiAppInstallEvidenceRow | undefined,
): AppLaunchReadiness {
  switch (row.admissionStatus) {
    case 'admitted':
      if (!descriptorResolution.ok) return 'unsupported';
      if (!evidence) return 'install-required';
      if (evidence.verificationState === 'digest-verified') {
        if (!evidence.installedVersion) return 'install-required';
        return evidence.installedVersion !== descriptorResolution.descriptor.version
          ? 'update-required'
          : 'ready';
      }
      if (evidence.verificationState === 'digest-mismatch') return 'repair-required';
      return 'install-required';
    case 'gated_by_avatar_master_gate':
      return 'blocked-by-master-gate';
    case 'pending_wave_4':
    case 'deferred':
    case 'retired':
      return 'unsupported';
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

function findInstallEvidence(
  row: NimiAppRegistrySourceRow,
  descriptor: NimiAppReleaseDescriptorRow,
  installEvidence: readonly NimiAppInstallEvidenceRow[],
): NimiAppInstallEvidenceRow | undefined {
  return installEvidence.find((evidence) =>
    evidence.appId === row.appId
    && evidence.releaseDescriptorRef === descriptor.descriptorId
    && evidence.storagePolicyRef === descriptor.storagePolicyRef
    && evidence.sha256 === descriptor.sha256
    && hasStorageRoots(evidence)
  );
}

function hasStorageRoots(evidence: NimiAppInstallEvidenceRow): boolean {
  const roots = evidence.storageRoots;
  return Boolean(
    roots?.releaseRoot
    && roots.dataRoot
    && roots.cacheRoot
    && roots.tempRoot,
  );
}

function defaultStatusDetail(
  row: NimiAppRegistrySourceRow,
  readiness: AppLaunchReadiness,
  descriptorResolution: DescriptorResolution,
  evidence: NimiAppInstallEvidenceRow | undefined,
): string | undefined {
  if (readiness === 'unsupported') {
    return descriptorResolution.ok
      ? 'registry row is unsupported'
      : `registry row is not installable: ${descriptorResolution.reason}`;
  }
  if (readiness === 'blocked-by-master-gate') {
    return 'app is blocked by master product gate';
  }
  if (readiness === 'install-required' && !evidence) {
    return 'descriptor resolved, but no digest-verified install evidence exists';
  }
  if (readiness === 'repair-required') {
    return 'installed artifact digest does not match release descriptor';
  }
  return undefined;
}

function missingRow(appId: string): NimiAppRegistryTransportError {
  return new NimiAppRegistryTransportError(
    'missing-registry-row',
    `Nimi App registry row missing for app "${appId}"`,
  );
}

function failClosedOperation(
  operation: NimiAppOperationResult['operation'],
  appId: string,
  row: NimiAppRegistrySourceRow | undefined,
  descriptors: readonly NimiAppReleaseDescriptorRow[],
): NimiAppOperationResult {
  if (!row) {
    return {
      appId,
      operation,
      state: 'failed',
      reason: 'registry-row-missing',
    };
  }
  const descriptorResolution = resolveOrdinaryVisibleDescriptor(row, descriptors);
  if (!descriptorResolution.ok) {
    return {
      appId,
      operation,
      state: 'blocked',
      reason: descriptorResolution.reason,
    };
  }
  return {
    appId,
    operation,
    state: 'unsupported',
    reason: operation === 'install'
      ? 'install-gateway-not-connected'
      : 'runtime-mediated-app-lifecycle-not-connected',
    detail: `release descriptor ${descriptorResolution.descriptor.descriptorId} resolved; operation requires the runtime install/launch gateway`,
  };
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
