import type { AvatarRuntimeCarrier } from './carrier/avatar-carrier.js';

export type CreatorCapabilityId =
  | 'motion'
  | 'expression'
  | 'hit_region'
  | 'lipsync';

export type CreatorCapabilityStatus = 'passed' | 'unsupported' | 'failed';

export type CreatorCapabilityItem = {
  id: CreatorCapabilityId;
  status: CreatorCapabilityStatus;
  labelKey: string;
  proofKey: string;
  proofParams: Record<string, string | number>;
};

export type CreatorCapabilityReport = {
  backendKind: string;
  modelId: string;
  items: CreatorCapabilityItem[];
};

const LABEL_KEYS: Record<CreatorCapabilityId, string> = {
  motion: 'Avatar.creator_capabilities.motion.label',
  expression: 'Avatar.creator_capabilities.expression.label',
  hit_region: 'Avatar.creator_capabilities.hit_region.label',
  lipsync: 'Avatar.creator_capabilities.lipsync.label',
};

export function deriveCreatorCapabilityReport(
  carrier: AvatarRuntimeCarrier | null,
): CreatorCapabilityReport | null {
  if (!carrier) return null;
  if (
    !carrier.backend
    || typeof carrier.backend.metadata !== 'function'
  ) {
    return null;
  }
  const meta = carrier.backend.metadata();
  const backendKind = carrier.backend.kind;
  return {
    backendKind,
    modelId: carrier.model.modelId,
    items: [
      deriveMotion(backendKind, meta),
      deriveExpression(backendKind, meta),
      deriveHitRegion(carrier, meta),
      deriveLipsync(meta),
    ],
  };
}

function deriveMotion(
  backendKind: string,
  meta: Record<string, unknown>,
): CreatorCapabilityItem {
  if (backendKind === 'vrm') {
    const routes = readStringList(meta, 'generated_motion_routes');
    return {
      id: 'motion',
      status: routes.length > 0 ? 'passed' : 'unsupported',
      labelKey: LABEL_KEYS.motion,
      proofKey: routes.length > 0
        ? 'Avatar.creator_capabilities.motion.proof_vrm'
        : 'Avatar.creator_capabilities.motion.proof_missing',
      proofParams: { count: routes.length },
    };
  }
  const groups = readNumber(meta, 'motion_group_count');
  return {
    id: 'motion',
    status: groups > 0 ? 'passed' : 'unsupported',
    labelKey: LABEL_KEYS.motion,
    proofKey: groups > 0
      ? 'Avatar.creator_capabilities.motion.proof_live2d'
      : 'Avatar.creator_capabilities.motion.proof_missing',
    proofParams: { count: groups },
  };
}

function deriveExpression(
  backendKind: string,
  meta: Record<string, unknown>,
): CreatorCapabilityItem {
  if (backendKind === 'vrm') {
    const present = meta['expression_manager_present'] === true;
    return {
      id: 'expression',
      status: present ? 'passed' : 'unsupported',
      labelKey: LABEL_KEYS.expression,
      proofKey: present
        ? 'Avatar.creator_capabilities.expression.proof_vrm'
        : 'Avatar.creator_capabilities.expression.proof_missing',
      proofParams: {},
    };
  }
  const expressions = readNumber(meta, 'expression_count');
  const adapterId = readString(meta, 'adapter_id');
  return {
    id: 'expression',
    status: expressions > 0 || adapterId ? 'passed' : 'unsupported',
    labelKey: LABEL_KEYS.expression,
    proofKey: expressions > 0
      ? 'Avatar.creator_capabilities.expression.proof_live2d'
      : adapterId
        ? 'Avatar.creator_capabilities.expression.proof_adapter'
        : 'Avatar.creator_capabilities.expression.proof_missing',
    proofParams: { count: expressions, adapter: adapterId || 'unknown' },
  };
}

function deriveHitRegion(
  carrier: AvatarRuntimeCarrier,
  meta: Record<string, unknown>,
): CreatorCapabilityItem {
  const bounds = carrier.backend.nominalBounds;
  const strategy = readString(meta, 'hit_region_strategy') || 'bbox';
  const validBounds = bounds.width > 0 && bounds.height > 0;
  return {
    id: 'hit_region',
    status: validBounds ? 'passed' : 'failed',
    labelKey: LABEL_KEYS.hit_region,
    proofKey: validBounds
      ? 'Avatar.creator_capabilities.hit_region.proof_present'
      : 'Avatar.creator_capabilities.hit_region.proof_missing',
    proofParams: {
      strategy,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    },
  };
}

function deriveLipsync(meta: Record<string, unknown>): CreatorCapabilityItem {
  const present = meta['lipsync_profile_present'] === true;
  return {
    id: 'lipsync',
    status: present ? 'passed' : 'unsupported',
    labelKey: LABEL_KEYS.lipsync,
    proofKey: present
      ? 'Avatar.creator_capabilities.lipsync.proof_present'
      : 'Avatar.creator_capabilities.lipsync.proof_missing',
    proofParams: {},
  };
}

function readString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(meta: Record<string, unknown>, key: string): number {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readStringList(meta: Record<string, unknown>, key: string): string[] {
  const value = meta[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
