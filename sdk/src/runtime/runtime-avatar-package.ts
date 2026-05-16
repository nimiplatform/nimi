import type { AgentRequestContext } from './generated/runtime/v1/agent_common.js';
import type { RuntimeCallOptions } from './types.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';

export type RuntimeAvatarPackageBackendKind = 'live2d' | 'vrm';
type RuntimeAvatarPackageKind = 'avatar';
type RuntimeAvatarPackageStatus = 'draft' | 'published' | 'archived';
type RuntimeAvatarPackageDiagnosticSeverity = 'blocking' | 'warning' | 'info';
type RuntimeAvatarPackageProvenanceSourceType =
  | 'first_party_curated'
  | 'imported_local_materialization';

type RuntimeAvatarPackageCompatibilityDiagnostic = {
  code: string;
  severity: RuntimeAvatarPackageDiagnosticSeverity;
  message?: string;
  source?: string;
};

type RuntimeAvatarPackageLive2DLayout = {
  model3JsonAssetId: string;
  model3JsonPath: string;
};

type RuntimeAvatarPackageVrmLayout = {
  vrmAssetId: string;
  vrmFilePath: string;
};

type RuntimeAvatarPackageModelLayout = {
  layoutVersion: number;
  backendKind: RuntimeAvatarPackageBackendKind;
  entryAssetId: string;
  runtimeRoot: string;
  requiredAssetIds: readonly string[];
  live2d?: RuntimeAvatarPackageLive2DLayout;
  vrm?: RuntimeAvatarPackageVrmLayout;
};

type RuntimeAvatarPackageProvenance = {
  sourceType: RuntimeAvatarPackageProvenanceSourceType;
  sourceFingerprint: string;
  admittedAt: string;
  validator: string;
};

type RuntimeAvatarPackageProjection = {
  avatarPackageRef: string;
  packageKind: RuntimeAvatarPackageKind;
  packageId: string;
  bundleId: string;
  bundleMemberAssetIds: readonly string[];
  backendKind: RuntimeAvatarPackageBackendKind;
  backendCapabilityProfileRef: string;
  avatarModelLayout: RuntimeAvatarPackageModelLayout;
  provenance: RuntimeAvatarPackageProvenance;
  compatibilityDiagnostics: readonly RuntimeAvatarPackageCompatibilityDiagnostic[];
  status: RuntimeAvatarPackageStatus;
  isReady: boolean;
  readinessIssues: readonly string[];
  version?: number;
  materializationRef?: string;
  observedAt?: string;
};

export type RuntimeAvatarPackageHandoff = {
  avatarPackageRef: string;
  backendKind: RuntimeAvatarPackageBackendKind;
  backendCapabilityProfileRef: string;
  readiness: 'launch_eligible';
  diagnosticIds: readonly string[];
  materializationRef: string;
};

export type RuntimeAvatarPackageResolveLaunchProjectionRequest = {
  accountId?: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  avatarInstanceId: string;
  subjectUserId?: string;
};

export type RuntimeAvatarPackageModule = {
  resolveLaunchProjection(
    request: RuntimeAvatarPackageResolveLaunchProjectionRequest,
    options?: RuntimeCallOptions,
  ): Promise<unknown>;
};

type ObjectLike = { readonly [key: string]: unknown };

type ProtectedScopeHelper = {
  getCallOptions(scopes: readonly string[], baseOptions?: RuntimeCallOptions): Promise<RuntimeCallOptions>;
};

type RuntimeAvatarPackageAgentClient = RuntimeAgentClient & {
  resolveAvatarPackageLaunchProjection?: (
    request: {
      context: AgentRequestContext;
      avatarInstanceId: string;
    },
    options?: RuntimeCallOptions,
  ) => Promise<unknown>;
};

const AVATAR_PACKAGE_READ_SCOPE = 'runtime.agent.avatar_package.read';
const RESOLVE_AVATAR_PACKAGE_LAUNCH_PROJECTION_METHOD_ID =
  '/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarPackageLaunchProjection';

const FORBIDDEN_PAYLOAD_FIELDS = [
  'packageDescriptor',
  'package_descriptor',
  'packagePath',
  'package_path',
  'packageBytes',
  'package_bytes',
  'assetBytes',
  'asset_bytes',
  'backendRuntimeRoot',
  'backend_runtime_root',
  'agentCenterMaterializationPath',
  'agent_center_materialization_path',
  'localActivationBinding',
  'local_activation_binding',
  'activationBinding',
  'activation_binding',
] as const;

function asObject(value: unknown, label: string): ObjectLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as ObjectLike;
}

function valueOf(input: ObjectLike, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return input[key];
    }
  }
  return undefined;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireRequestString(
  input: RuntimeAvatarPackageResolveLaunchProjectionRequest,
  key: keyof RuntimeAvatarPackageResolveLaunchProjectionRequest,
): string {
  const value = normalizedText(input[key]);
  if (!value) {
    throw new Error(`runtime avatar package launch projection request missing ${String(key)}`);
  }
  return value;
}

async function buildAvatarPackageProjectionPayload(input: {
  appId: string;
  request: RuntimeAvatarPackageResolveLaunchProjectionRequest;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): Promise<{
  context: AgentRequestContext;
  avatarInstanceId: string;
}> {
  const ownerUserId = requireRequestString(input.request, 'ownerUserId');
  const realmAgentId = requireRequestString(input.request, 'realmAgentId');
  const localAgentRef = requireRequestString(input.request, 'localAgentRef');
  const avatarInstanceId = requireRequestString(input.request, 'avatarInstanceId');
  const accountId = normalizedText(input.request.accountId);
  if (accountId && accountId !== ownerUserId) {
    throw new Error('runtime avatar package launch projection accountId must match ownerUserId');
  }
  if (localAgentRef !== `local-agent:${ownerUserId}:${realmAgentId}`) {
    throw new Error('runtime avatar package launch projection localAgentRef must match ownerUserId and realmAgentId');
  }
  const subjectUserId = await input.resolveSubjectUserId(
    normalizedText(input.request.subjectUserId) || accountId || ownerUserId,
  );
  return {
    context: {
      appId: input.appId,
      subjectUserId,
      ownerUserId,
      realmAgentId,
      localAgentRef,
    },
    avatarInstanceId,
  };
}

export function createRuntimeAvatarPackageModule(input: {
  appId: string;
  agent: RuntimeAgentClient;
  protectedAccess: ProtectedScopeHelper;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): RuntimeAvatarPackageModule {
  return {
    async resolveLaunchProjection(request, options) {
      const method = (input.agent as RuntimeAvatarPackageAgentClient).resolveAvatarPackageLaunchProjection;
      if (typeof method !== 'function') {
        throw new Error(
          `Runtime Avatar package projection method is unavailable: ${RESOLVE_AVATAR_PACKAGE_LAUNCH_PROJECTION_METHOD_ID}`,
        );
      }
      const payload = await buildAvatarPackageProjectionPayload({
        appId: input.appId,
        request,
        resolveSubjectUserId: input.resolveSubjectUserId,
      });
      const callOptions = await input.protectedAccess.getCallOptions([AVATAR_PACKAGE_READ_SCOPE], options);
      return method(payload, callOptions);
    },
  };
}

function requiredString(input: ObjectLike, label: string, ...keys: string[]): string {
  const value = valueOf(input, ...keys);
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new Error(`runtime avatar package projection missing ${label}`);
}

function optionalString(input: ObjectLike, label: string, ...keys: string[]): string | undefined {
  const value = valueOf(input, ...keys);
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new Error(`runtime avatar package projection invalid ${label}`);
}

function requiredBoolean(input: ObjectLike, label: string, ...keys: string[]): boolean {
  const value = valueOf(input, ...keys);
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(`runtime avatar package projection missing ${label}`);
}

function optionalNumber(input: ObjectLike, label: string, ...keys: string[]): number | undefined {
  const value = valueOf(input, ...keys);
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`runtime avatar package projection invalid ${label}`);
}

function requiredPositiveInteger(input: ObjectLike, label: string, ...keys: string[]): number {
  const value = valueOf(input, ...keys);
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`runtime avatar package projection missing ${label}`);
}

function requiredStringArray(input: ObjectLike, label: string, ...keys: string[]): readonly string[] {
  const value = valueOf(input, ...keys);
  if (!Array.isArray(value)) {
    throw new Error(`runtime avatar package projection missing ${label}`);
  }
  const out = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`runtime avatar package projection invalid ${label}`);
    }
    return item.trim();
  });
  return Object.freeze([...out]);
}

function optionalStringArray(input: ObjectLike, label: string, ...keys: string[]): readonly string[] {
  const value = valueOf(input, ...keys);
  if (value === undefined || value === null) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new Error(`runtime avatar package projection invalid ${label}`);
  }
  const out = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`runtime avatar package projection invalid ${label}`);
    }
    return item.trim();
  });
  return Object.freeze([...out]);
}

function requireNoForbiddenPayloadFields(input: ObjectLike, label: string): void {
  for (const field of FORBIDDEN_PAYLOAD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new Error(`runtime avatar package projection must not include ${label}.${field}`);
    }
  }
}

function decodeBackendKind(value: string): RuntimeAvatarPackageBackendKind {
  if (value === 'live2d' || value === 'vrm') {
    return value;
  }
  throw new Error(`runtime avatar package projection unsupported backend_kind: ${value}`);
}

function decodeStatus(value: string): RuntimeAvatarPackageStatus {
  if (value === 'draft' || value === 'published' || value === 'archived') {
    return value;
  }
  throw new Error(`runtime avatar package projection unsupported status: ${value}`);
}

function decodeSeverity(value: string): RuntimeAvatarPackageDiagnosticSeverity {
  if (value === 'blocking' || value === 'warning' || value === 'info') {
    return value;
  }
  throw new Error(`runtime avatar package projection unsupported diagnostic severity: ${value}`);
}

function decodeProvenanceSource(value: string): RuntimeAvatarPackageProvenanceSourceType {
  if (value === 'first_party_curated' || value === 'imported_local_materialization') {
    return value;
  }
  if (value === 'future_reviewed_ugc') {
    throw new Error('runtime avatar package projection future_reviewed_ugc requires AM-MOD admission');
  }
  throw new Error(`runtime avatar package projection unsupported provenance source_type: ${value}`);
}

function assertSafeRelativePath(value: string, label: string): void {
  if (!value || value.startsWith('/') || value.startsWith('\\')) {
    throw new Error(`runtime avatar package projection ${label} must be a relative path`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) || /^[a-z]:[\\/]/iu.test(value)) {
    throw new Error(`runtime avatar package projection ${label} must not be absolute or URL`);
  }
  if (value.includes('\\') || value.split('/').includes('..')) {
    throw new Error(`runtime avatar package projection ${label} must be normalized`);
  }
}

function assertUnderRuntimeRoot(filePath: string, runtimeRoot: string, label: string): void {
  assertSafeRelativePath(filePath, label);
  const normalizedRoot = runtimeRoot.endsWith('/') ? runtimeRoot.slice(0, -1) : runtimeRoot;
  if (filePath !== normalizedRoot && !filePath.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`runtime avatar package projection ${label} must be under runtime_root`);
  }
}

function requireAssetInBundle(assetId: string, bundleMemberAssetIds: readonly string[], label: string): void {
  if (!bundleMemberAssetIds.includes(assetId)) {
    throw new Error(`runtime avatar package projection ${label} must belong to bundleMemberAssetIds`);
  }
}

function decodeLive2DLayout(input: ObjectLike, bundleMemberAssetIds: readonly string[], runtimeRoot: string): RuntimeAvatarPackageLive2DLayout {
  const model3JsonAssetId = requiredString(input, 'avatar_model_layout.live2d.model3_json_asset_id', 'model3JsonAssetId', 'model3_json_asset_id');
  const model3JsonPath = requiredString(input, 'avatar_model_layout.live2d.model3_json_path', 'model3JsonPath', 'model3_json_path');
  requireAssetInBundle(model3JsonAssetId, bundleMemberAssetIds, 'avatar_model_layout.live2d.model3_json_asset_id');
  assertUnderRuntimeRoot(model3JsonPath, runtimeRoot, 'avatar_model_layout.live2d.model3_json_path');
  if (!model3JsonPath.endsWith('.model3.json')) {
    throw new Error('runtime avatar package projection live2d model3_json_path must end with .model3.json');
  }
  return { model3JsonAssetId, model3JsonPath };
}

function decodeVrmLayout(input: ObjectLike, bundleMemberAssetIds: readonly string[], runtimeRoot: string): RuntimeAvatarPackageVrmLayout {
  const vrmAssetId = requiredString(input, 'avatar_model_layout.vrm.vrm_asset_id', 'vrmAssetId', 'vrm_asset_id');
  const vrmFilePath = requiredString(input, 'avatar_model_layout.vrm.vrm_file_path', 'vrmFilePath', 'vrm_file_path');
  requireAssetInBundle(vrmAssetId, bundleMemberAssetIds, 'avatar_model_layout.vrm.vrm_asset_id');
  assertUnderRuntimeRoot(vrmFilePath, runtimeRoot, 'avatar_model_layout.vrm.vrm_file_path');
  if (!vrmFilePath.endsWith('.vrm')) {
    throw new Error('runtime avatar package projection vrm_file_path must end with .vrm');
  }
  return { vrmAssetId, vrmFilePath };
}

function decodeLayout(
  input: unknown,
  parentBackendKind: RuntimeAvatarPackageBackendKind,
  bundleMemberAssetIds: readonly string[],
): RuntimeAvatarPackageModelLayout {
  const layout = asObject(input, 'avatar_model_layout');
  requireNoForbiddenPayloadFields(layout, 'avatar_model_layout');
  const layoutVersion = requiredPositiveInteger(layout, 'avatar_model_layout.layout_version', 'layoutVersion', 'layout_version');
  const backendKind = decodeBackendKind(requiredString(layout, 'avatar_model_layout.backend_kind', 'backendKind', 'backend_kind'));
  if (backendKind !== parentBackendKind) {
    throw new Error('runtime avatar package projection avatar_model_layout.backend_kind must match package backend_kind');
  }
  const entryAssetId = requiredString(layout, 'avatar_model_layout.entry_asset_id', 'entryAssetId', 'entry_asset_id');
  const runtimeRoot = requiredString(layout, 'avatar_model_layout.runtime_root', 'runtimeRoot', 'runtime_root');
  const requiredAssetIds = requiredStringArray(layout, 'avatar_model_layout.required_asset_ids', 'requiredAssetIds', 'required_asset_ids');
  assertSafeRelativePath(runtimeRoot, 'avatar_model_layout.runtime_root');
  requireAssetInBundle(entryAssetId, bundleMemberAssetIds, 'avatar_model_layout.entry_asset_id');
  for (const assetId of requiredAssetIds) {
    requireAssetInBundle(assetId, bundleMemberAssetIds, 'avatar_model_layout.required_asset_ids');
  }

  if (backendKind === 'live2d') {
    const live2d = decodeLive2DLayout(asObject(valueOf(layout, 'live2d', 'live2D'), 'avatar_model_layout.live2d'), bundleMemberAssetIds, runtimeRoot);
    if (live2d.model3JsonAssetId !== entryAssetId) {
      throw new Error('runtime avatar package projection live2d model3_json_asset_id must match entry_asset_id');
    }
    return { layoutVersion, backendKind, entryAssetId, runtimeRoot, requiredAssetIds, live2d };
  }

  const vrm = decodeVrmLayout(asObject(valueOf(layout, 'vrm'), 'avatar_model_layout.vrm'), bundleMemberAssetIds, runtimeRoot);
  if (vrm.vrmAssetId !== entryAssetId) {
    throw new Error('runtime avatar package projection vrm_asset_id must match entry_asset_id');
  }
  return { layoutVersion, backendKind, entryAssetId, runtimeRoot, requiredAssetIds, vrm };
}

function decodeProvenance(input: unknown): RuntimeAvatarPackageProvenance {
  const provenance = asObject(input, 'provenance');
  return {
    sourceType: decodeProvenanceSource(requiredString(provenance, 'provenance.source_type', 'sourceType', 'source_type')),
    sourceFingerprint: requiredString(provenance, 'provenance.source_fingerprint', 'sourceFingerprint', 'source_fingerprint'),
    admittedAt: requiredString(provenance, 'provenance.admitted_at', 'admittedAt', 'admitted_at'),
    validator: requiredString(provenance, 'provenance.validator', 'validator'),
  };
}

function decodeDiagnostic(input: unknown): RuntimeAvatarPackageCompatibilityDiagnostic {
  const diagnostic = asObject(input, 'compatibility_diagnostic');
  const message = optionalString(diagnostic, 'compatibility_diagnostic.message', 'message');
  const source = optionalString(diagnostic, 'compatibility_diagnostic.source', 'source');
  return {
    code: requiredString(diagnostic, 'compatibility_diagnostic.code', 'code'),
    severity: decodeSeverity(requiredString(diagnostic, 'compatibility_diagnostic.severity', 'severity')),
    ...(message ? { message } : {}),
    ...(source ? { source } : {}),
  };
}

function decodeDiagnostics(input: unknown): readonly RuntimeAvatarPackageCompatibilityDiagnostic[] {
  if (!Array.isArray(input)) {
    throw new Error('runtime avatar package projection missing compatibility_diagnostics');
  }
  return Object.freeze(input.map(decodeDiagnostic));
}

function decodeAvatarPackageProjection(input: unknown): RuntimeAvatarPackageProjection {
  const projection = asObject(input, 'runtime avatar package projection');
  requireNoForbiddenPayloadFields(projection, 'package');
  const packageKind = requiredString(projection, 'package_kind', 'packageKind', 'package_kind');
  if (packageKind !== 'avatar') {
    throw new Error(`runtime avatar package projection package_kind must be avatar, got ${packageKind}`);
  }
  const backendKind = decodeBackendKind(requiredString(projection, 'backend_kind', 'backendKind', 'backend_kind'));
  const bundleMemberAssetIds = requiredStringArray(projection, 'bundle_member_asset_ids', 'bundleMemberAssetIds', 'bundle_member_asset_ids');
  const avatarModelLayout = decodeLayout(
    valueOf(projection, 'avatarModelLayout', 'avatar_model_layout'),
    backendKind,
    bundleMemberAssetIds,
  );
  const materializationRef = optionalString(projection, 'materialization_ref', 'materializationRef', 'materialization_ref');
  const observedAt = optionalString(projection, 'observed_at', 'observedAt', 'observed_at');
  const version = optionalNumber(projection, 'version', 'version');
  return {
    avatarPackageRef: requiredString(projection, 'avatar_package_ref', 'avatarPackageRef', 'avatar_package_ref'),
    packageKind: 'avatar',
    packageId: requiredString(projection, 'package_id', 'packageId', 'package_id'),
    bundleId: requiredString(projection, 'bundle_id', 'bundleId', 'bundle_id'),
    bundleMemberAssetIds,
    backendKind,
    backendCapabilityProfileRef: requiredString(projection, 'backend_capability_profile_ref', 'backendCapabilityProfileRef', 'backend_capability_profile_ref'),
    avatarModelLayout,
    provenance: decodeProvenance(valueOf(projection, 'provenance')),
    compatibilityDiagnostics: decodeDiagnostics(valueOf(projection, 'compatibilityDiagnostics', 'compatibility_diagnostics')),
    status: decodeStatus(requiredString(projection, 'status', 'status')),
    isReady: requiredBoolean(projection, 'is_ready', 'isReady', 'is_ready'),
    readinessIssues: optionalStringArray(projection, 'readiness_issues', 'readinessIssues', 'readiness_issues'),
    ...(version !== undefined ? { version } : {}),
    ...(materializationRef ? { materializationRef } : {}),
    ...(observedAt ? { observedAt } : {}),
  };
}

function getAvatarPackageBlockingDiagnostics(
  projection: RuntimeAvatarPackageProjection,
): readonly RuntimeAvatarPackageCompatibilityDiagnostic[] {
  return Object.freeze(projection.compatibilityDiagnostics.filter((diagnostic) => diagnostic.severity === 'blocking'));
}

function isAvatarPackageLaunchEligible(projection: RuntimeAvatarPackageProjection): boolean {
  return projection.packageKind === 'avatar'
    && (projection.backendKind === 'live2d' || projection.backendKind === 'vrm')
    && projection.status === 'published'
    && projection.isReady
    && projection.readinessIssues.length === 0
    && getAvatarPackageBlockingDiagnostics(projection).length === 0
    && Boolean(projection.backendCapabilityProfileRef)
    && Boolean(projection.materializationRef);
}

function assertAvatarPackageLaunchEligible(projection: RuntimeAvatarPackageProjection): void {
  if (isAvatarPackageLaunchEligible(projection)) {
    return;
  }
  const reasons: string[] = [];
  if (projection.status !== 'published') reasons.push('package status is not published');
  if (!projection.isReady) reasons.push('package readiness is false');
  if (projection.readinessIssues.length > 0) reasons.push(`readiness issues: ${projection.readinessIssues.join(', ')}`);
  const blocking = getAvatarPackageBlockingDiagnostics(projection);
  if (blocking.length > 0) reasons.push(`blocking diagnostics: ${blocking.map((diagnostic) => diagnostic.code).join(', ')}`);
  if (!projection.backendCapabilityProfileRef) reasons.push('backend capability profile ref is missing');
  if (!projection.materializationRef) reasons.push('local materialization ref is missing');
  throw new Error(`runtime avatar package projection is not launch eligible: ${reasons.join('; ') || 'unknown reason'}`);
}

function toAvatarPackageHandoff(projection: RuntimeAvatarPackageProjection): RuntimeAvatarPackageHandoff {
  assertAvatarPackageLaunchEligible(projection);
  return {
    avatarPackageRef: projection.avatarPackageRef,
    backendKind: projection.backendKind,
    backendCapabilityProfileRef: projection.backendCapabilityProfileRef,
    readiness: 'launch_eligible',
    diagnosticIds: Object.freeze(projection.compatibilityDiagnostics.map((diagnostic) => diagnostic.code)),
    materializationRef: projection.materializationRef!,
  };
}

export function decodeAvatarPackageHandoff(input: unknown): RuntimeAvatarPackageHandoff {
  return toAvatarPackageHandoff(decodeAvatarPackageProjection(input));
}
