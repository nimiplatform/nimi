import { parse as parseYaml } from 'yaml';
import {
  isVrmGeneratedRouteId,
  type VrmGeneratedRouteId,
} from './vrm-generated-motion-contract.js';
import {
  validateVrmCapabilityProfile,
  type VrmBoneName,
  type VrmCapabilityProfile,
} from './vrm-capability-profile.js';

export type AvatarMappingSourceKind =
  | 'deterministic_manifest'
  | 'static_name_match'
  | 'llm_semantic_match'
  | 'human_review';

export type AvatarMappingManualConfirmation = 'unconfirmed' | 'confirmed' | 'rejected';

export type AvatarMappingTargetKind =
  | 'humanoid_bone'
  | 'expression_preset'
  | 'lookat'
  | 'motion_group'
  | 'parameter_id'
  | 'manifest_entry';

export type AvatarMappingTargetField = {
  targetKind: AvatarMappingTargetKind;
  name: string;
  role: string | null;
};

export type AvatarMappingSidecar = {
  sidecarId: string;
  routeId: VrmGeneratedRouteId;
  backendKind: 'vrm';
  profileId: string;
  confidence: number;
  threshold: number;
  manualConfirmation: AvatarMappingManualConfirmation;
  sourceKind: AvatarMappingSourceKind;
  targetFields: AvatarMappingTargetField[];
};

export type AvatarMappingSupportResult =
  | { supported: true; sidecar: AvatarMappingSidecar | null; evidence: AvatarMappingSupportEvidence }
  | { supported: false; reason: string; evidence: AvatarMappingSupportEvidence };

export type AvatarMappingSupportEvidence = {
  routeId: string;
  providerKind: 'mapping_sidecar';
  reasonCode?: string;
  sidecarId?: string;
  confidence?: number;
  threshold?: number;
  manualConfirmation?: AvatarMappingManualConfirmation;
};

const DEFAULT_MAPPING_CONFIDENCE_THRESHOLD = 0.82;
const FORBIDDEN_FIELDS = new Set([
  'keyframes',
  'rotations',
  'curves',
  'easing',
  'duration',
  'apml_tag',
  'apmlTag',
]);

const SOURCE_KINDS = new Set<AvatarMappingSourceKind>([
  'deterministic_manifest',
  'static_name_match',
  'llm_semantic_match',
  'human_review',
]);

const MANUAL_CONFIRMATION_VALUES = new Set<AvatarMappingManualConfirmation>([
  'unconfirmed',
  'confirmed',
  'rejected',
]);

const TARGET_KINDS = new Set<AvatarMappingTargetKind>([
  'humanoid_bone',
  'expression_preset',
  'lookat',
  'motion_group',
  'parameter_id',
  'manifest_entry',
]);
const SIDECAR_FIELDS = new Set([
  'sidecar_id',
  'route_id',
  'backend_kind',
  'profile_id',
  'confidence',
  'threshold',
  'manual_confirmation',
  'source_kind',
  'target_fields',
]);
const TARGET_FIELDS = new Set(['target_kind', 'name', 'role']);

export function parseAvatarMappingSidecarDocument(text: string): AvatarMappingSidecar {
  return normalizeAvatarMappingSidecar(parseYaml(text));
}

export function normalizeAvatarMappingSidecar(raw: unknown): AvatarMappingSidecar {
  assertNoForbiddenFields(raw);
  if (!isObject(raw)) {
    throw new Error('vrm-mapping-sidecar: top-level value is not an object');
  }
  assertExactFields(raw, SIDECAR_FIELDS, 'sidecar');

  const sidecarId = readRequiredString(raw, 'sidecar_id');
  const routeId = readRequiredString(raw, 'route_id');
  if (!isVrmGeneratedRouteId(routeId)) {
    throw new Error(`vrm-mapping-sidecar: unknown route_id "${routeId}"`);
  }

  const backendKind = readRequiredString(raw, 'backend_kind');
  if (backendKind !== 'vrm') {
    throw new Error(`vrm-mapping-sidecar: unsupported backend_kind "${backendKind}"`);
  }

  const targetFieldsRaw = raw['target_fields'];
  if (!Array.isArray(targetFieldsRaw) || targetFieldsRaw.length === 0) {
    throw new Error('vrm-mapping-sidecar: target_fields must be a non-empty array');
  }

  return {
    sidecarId,
    routeId,
    backendKind,
    profileId: readRequiredString(raw, 'profile_id'),
    confidence: readProbability(raw, 'confidence'),
    threshold: readMappingThreshold(raw),
    manualConfirmation: readEnum(
      raw,
      'manual_confirmation',
      MANUAL_CONFIRMATION_VALUES,
    ),
    sourceKind: readEnum(raw, 'source_kind', SOURCE_KINDS),
    targetFields: targetFieldsRaw.map((entry, index) => normalizeTargetField(entry, index)),
  };
}

export function evaluateAvatarMappingSidecarSupport(
  sidecar: AvatarMappingSidecar,
  profile: VrmCapabilityProfile,
): AvatarMappingSupportResult {
  const evidence = baseEvidence(sidecar);
  try {
    validateVrmCapabilityProfile(profile);
  } catch (error) {
    return unsupported(`capability_profile_invalid:${toErrorMessage(error)}`, evidence);
  }
  if (sidecar.backendKind !== profile.backendKind) {
    return unsupported('mapping_backend_kind_mismatch', evidence);
  }
  if (sidecar.profileId !== profile.profileId) {
    return unsupported('mapping_profile_id_mismatch', evidence);
  }
  if (!profile.generatedMotion.supportedRoutes.includes(sidecar.routeId)) {
    return unsupported('capability_profile_route_unsupported', evidence);
  }
  if (sidecar.confidence < sidecar.threshold) {
    return unsupported('mapping_confidence_below_threshold', evidence);
  }
  if (sidecar.manualConfirmation === 'rejected') {
    return unsupported('mapping_rejected', evidence);
  }
  if (
    sidecar.sourceKind === 'llm_semantic_match' &&
    sidecar.manualConfirmation !== 'confirmed'
  ) {
    return unsupported('mapping_manual_confirmation_required', evidence);
  }

  for (const target of sidecar.targetFields) {
    const targetFailure = evaluateTargetField(target, profile);
    if (targetFailure !== null) {
      return unsupported(targetFailure, evidence);
    }
  }

  return { supported: true, sidecar, evidence };
}

export function evaluateAvatarMappingSidecarsForRoute(
  sidecars: readonly unknown[] | null | undefined,
  profile: VrmCapabilityProfile,
  routeId: string,
): AvatarMappingSupportResult {
  if (sidecars === undefined || sidecars === null) {
    return {
      supported: true,
      sidecar: null,
      evidence: { routeId, providerKind: 'mapping_sidecar' },
    };
  }
  if (!isVrmGeneratedRouteId(routeId)) {
    return unsupported('route_not_admitted', { routeId, providerKind: 'mapping_sidecar' });
  }

  let matchingSidecar: AvatarMappingSidecar | null = null;
  for (const raw of sidecars) {
    let normalized: AvatarMappingSidecar;
    try {
      normalized = normalizeAvatarMappingSidecar(raw);
    } catch (error) {
      return unsupported(`mapping_sidecar_invalid:${toErrorMessage(error)}`, {
        routeId,
        providerKind: 'mapping_sidecar',
      });
    }
    if (normalized.routeId === routeId) matchingSidecar = normalized;
  }

  if (matchingSidecar === null) {
    return unsupported('mapping_sidecar_missing', {
      routeId,
      providerKind: 'mapping_sidecar',
    });
  }
  return evaluateAvatarMappingSidecarSupport(matchingSidecar, profile);
}

function normalizeTargetField(raw: unknown, index: number): AvatarMappingTargetField {
  if (!isObject(raw)) {
    throw new Error(`vrm-mapping-sidecar: target_fields[${index}] is not an object`);
  }
  assertExactFields(raw, TARGET_FIELDS, `target_fields[${index}]`);
  const targetKind = readEnum(raw, 'target_kind', TARGET_KINDS);
  const role = raw['role'];
  return {
    targetKind,
    name: readRequiredString(raw, 'name'),
    role: typeof role === 'string' && role.trim().length > 0 ? role.trim() : null,
  };
}

function evaluateTargetField(
  target: AvatarMappingTargetField,
  profile: VrmCapabilityProfile,
): string | null {
  if (target.targetKind === 'humanoid_bone') {
    if (!isVrmBoneName(target.name)) return `mapping_target_unknown_bone:${target.name}`;
    return profile.humanoidBones[target.name] ? null : `mapping_target_missing_bone:${target.name}`;
  }
  if (target.targetKind === 'expression_preset') {
    if (!profile.expressionManagerPresent || !profile.expressionPresets.present) {
      return 'mapping_target_expression_manager_missing';
    }
    return profile.expressionPresets.names.includes(target.name)
      ? null
      : `mapping_target_unknown_expression_preset:${target.name}`;
  }
  if (target.targetKind === 'lookat') {
    return profile.lookat.supported ? null : 'mapping_target_lookat_missing';
  }
  return `mapping_target_unsupported_for_vrm:${target.targetKind}`;
}

function baseEvidence(sidecar: AvatarMappingSidecar): AvatarMappingSupportEvidence {
  return {
    routeId: sidecar.routeId,
    providerKind: 'mapping_sidecar',
    sidecarId: sidecar.sidecarId,
    confidence: sidecar.confidence,
    threshold: sidecar.threshold,
    manualConfirmation: sidecar.manualConfirmation,
  };
}

function unsupported(
  reason: string,
  evidence: AvatarMappingSupportEvidence,
): AvatarMappingSupportResult {
  return {
    supported: false,
    reason,
    evidence: { ...evidence, reasonCode: reason },
  };
}

function assertNoForbiddenFields(value: unknown, path: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenFields(entry, [...path, String(index)]));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      const location = [...path, key].join('.') || key;
      throw new Error(`vrm-mapping-sidecar: forbidden field "${location}"`);
    }
    assertNoForbiddenFields(nested, [...path, key]);
  }
}

function assertExactFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`vrm-mapping-sidecar: ${label} contains unadmitted field "${key}"`);
    }
  }
}

function readRequiredString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`vrm-mapping-sidecar: missing/invalid ${key}`);
  }
  return value.trim();
}

function readProbability(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`vrm-mapping-sidecar: ${key} must be in [0, 1]`);
  }
  return value;
}

function readMappingThreshold(raw: Record<string, unknown>): number {
  const threshold = readProbability(raw, 'threshold');
  if (threshold < DEFAULT_MAPPING_CONFIDENCE_THRESHOLD) {
    throw new Error(
      `vrm-mapping-sidecar: threshold must be >= default threshold ${DEFAULT_MAPPING_CONFIDENCE_THRESHOLD}`,
    );
  }
  return threshold;
}

function readEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<T>,
): T {
  const value = raw[key];
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new Error(`vrm-mapping-sidecar: ${key} has unsupported value "${String(value)}"`);
  }
  return value as T;
}

function isVrmBoneName(value: string): value is VrmBoneName {
  return [
    'hips',
    'spine',
    'chest',
    'neck',
    'head',
    'leftUpperArm',
    'leftLowerArm',
    'leftHand',
    'rightUpperArm',
    'rightLowerArm',
    'rightHand',
    'leftUpperLeg',
    'leftLowerLeg',
    'rightUpperLeg',
    'rightLowerLeg',
  ].includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
