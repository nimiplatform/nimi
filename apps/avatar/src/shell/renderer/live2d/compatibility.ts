import type { Live2DBackendResources } from './backend-session.js';
import type { Model3Settings, ModelManifest } from './model-loader.js';

export const LIVE2D_ADAPTER_MANIFEST_KIND = 'nimi.avatar.live2d.adapter';
export const DEFAULT_MOUTH_OPEN_PARAMETER = 'ParamMouthOpenY';

export type Live2DCompatibilityTier =
  | 'unsupported'
  | 'render_only'
  | 'semantic_basic'
  | 'companion_complete';

export type Live2DCompatibilityDiagnosticCode =
  | 'AVATAR_LIVE2D_COMPAT_MANIFEST_MISSING'
  | 'AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID'
  | 'AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH'
  | 'AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED'
  | 'AVATAR_LIVE2D_COMPAT_MOTION_MISSING'
  | 'AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING'
  | 'AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE'
  | 'AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING'
  | 'AVATAR_LIVE2D_COMPAT_PHYSICS_UNAVAILABLE'
  | 'AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING'
  | 'AVATAR_LIVE2D_COMPAT_UNSUPPORTED_SEMANTIC';

export type Live2DCompatibilityDiagnostic = {
  code: Live2DCompatibilityDiagnosticCode;
  message: string;
  path?: string;
};

export type Live2DFeatureDisposition = {
  status: 'supported' | 'unsupported' | 'not_applicable';
  reason?: string;
};

type ActivityMotionMapping = {
  group?: string;
  weak_group?: string;
  strong_group?: string;
  disposition?: Live2DFeatureDisposition;
};

export type Live2DAdapterManifestV1 = {
  manifest_kind: typeof LIVE2D_ADAPTER_MANIFEST_KIND;
  schema_version: 1;
  adapter_id: string;
  target_model: {
    model_id: string;
    model3: string | 'auto';
    expected_runtime_digest?: string;
  };
  license: {
    redistribution: 'allowed' | 'forbidden' | 'unknown';
    evidence: string;
    fixture_use: 'committable' | 'operator_local_only' | 'not_allowed';
  };
  compatibility: {
    requested_tier: Exclude<Live2DCompatibilityTier, 'unsupported'>;
  };
  semantics: {
    motions: {
      idle: { group: string };
      activities?: Record<string, ActivityMotionMapping>;
      missing_activity: 'diagnostic_no_success' | 'idle_degraded_with_diagnostic';
    };
    expressions: {
      map?: Record<string, string>;
      disposition: Live2DFeatureDisposition;
    };
    poses: {
      map?: Record<string, string>;
      disposition: Live2DFeatureDisposition;
    };
    lipsync: {
      mouth_open_y_parameter?: string;
      disposition: Live2DFeatureDisposition;
    };
    physics: {
      mode: 'model_physics' | 'absent' | 'unsupported';
      disposition: Live2DFeatureDisposition;
    };
    hit_regions: {
      map?: {
        head?: string[];
        face?: string[];
        body?: string[];
        accessory?: string[];
      };
      fallback: 'alpha_mask_only' | 'fail_closed';
      disposition: Live2DFeatureDisposition;
    };
    nas_fallback: {
      default_idle_motion: string;
      missing_handler: 'backend_default_with_diagnostic' | 'no_default';
    };
  };
};

export type Live2DCompatibilityReport = {
  tier: Live2DCompatibilityTier;
  adapter: Live2DAdapterManifestV1 | null;
  diagnostics: Live2DCompatibilityDiagnostic[];
  activityMotionGroups: Map<string, ActivityMotionMapping>;
  idleMotionGroup: string;
  mouthOpenParameterId: string;
  missingActivity: 'diagnostic_no_success' | 'idle_degraded_with_diagnostic';
};

export type Live2DCompatibilityInput = {
  model: ModelManifest;
  settings: Model3Settings;
  resources: Live2DBackendResources;
  adapter?: Live2DAdapterManifestV1 | null;
};

const BASIC_REQUIRED_ACTIVITY_IDS = ['idle', 'neutral', 'greet', 'listening', 'thinking'] as const;
const COMPLETE_REQUIRED_ACTIVITY_IDS = [
  'happy',
  'sad',
  'shy',
  'angry',
  'surprised',
  'confused',
  'excited',
  'worried',
  'embarrassed',
  'neutral',
  'greet',
  'farewell',
  'agree',
  'disagree',
  'listening',
  'thinking',
  'idle',
  'celebrating',
  'sleeping',
  'focused',
] as const;

function diagnostic(
  code: Live2DCompatibilityDiagnosticCode,
  message: string,
  path?: string,
): Live2DCompatibilityDiagnostic {
  return path ? { code, message, path } : { code, message };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readDisposition(value: unknown): Live2DFeatureDisposition | null {
  const record = readRecord(value);
  const status = record?.['status'];
  if (status !== 'supported' && status !== 'unsupported' && status !== 'not_applicable') {
    return null;
  }
  if (!record) return null;
  const reason = readString(record, 'reason') ?? undefined;
  if (status !== 'supported' && !reason) {
    return null;
  }
  return reason ? { status, reason } : { status };
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string' || !entry.trim()) {
      return undefined;
    }
    out[key] = entry;
  }
  return out;
}

function readStringArrayMap(value: unknown): Record<string, string[]> | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const out: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (!Array.isArray(entry) || entry.some((item) => typeof item !== 'string' || !item.trim())) {
      return undefined;
    }
    out[key] = entry;
  }
  return out;
}

function parseActivityMappings(value: unknown): Record<string, ActivityMotionMapping> | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const out: Record<string, ActivityMotionMapping> = {};
  for (const [activityId, entry] of Object.entries(record)) {
    const mapping = readRecord(entry);
    if (!mapping) return undefined;
    const disposition = mapping['disposition'] === undefined ? undefined : readDisposition(mapping['disposition']) ?? undefined;
    if (mapping['disposition'] !== undefined && !disposition) return undefined;
    out[activityId] = {
      group: readString(mapping, 'group') ?? undefined,
      weak_group: readString(mapping, 'weak_group') ?? undefined,
      strong_group: readString(mapping, 'strong_group') ?? undefined,
      disposition,
    };
  }
  return out;
}

function parseManifestObject(value: unknown): Live2DAdapterManifestV1 | null {
  const root = readRecord(value);
  if (!root) return null;
  if (root['manifest_kind'] !== LIVE2D_ADAPTER_MANIFEST_KIND || root['schema_version'] !== 1) {
    return null;
  }
  const adapterId = readString(root, 'adapter_id');
  const target = readRecord(root['target_model']);
  const license = readRecord(root['license']);
  const compatibility = readRecord(root['compatibility']);
  const semantics = readRecord(root['semantics']);
  if (!adapterId || !target || !license || !compatibility || !semantics) {
    return null;
  }
  const modelId = readString(target, 'model_id');
  const model3 = readString(target, 'model3');
  const redistribution = license['redistribution'];
  const fixtureUse = license['fixture_use'];
  const requestedTier = compatibility['requested_tier'];
  const motions = readRecord(semantics['motions']);
  const expressions = readRecord(semantics['expressions']);
  const poses = readRecord(semantics['poses']);
  const lipsync = readRecord(semantics['lipsync']);
  const physics = readRecord(semantics['physics']);
  const hitRegions = readRecord(semantics['hit_regions']);
  const nasFallback = readRecord(semantics['nas_fallback']);
  if (
    !modelId ||
    !model3 ||
    (redistribution !== 'allowed' && redistribution !== 'forbidden' && redistribution !== 'unknown') ||
    (fixtureUse !== 'committable' && fixtureUse !== 'operator_local_only' && fixtureUse !== 'not_allowed') ||
    (requestedTier !== 'render_only' && requestedTier !== 'semantic_basic' && requestedTier !== 'companion_complete') ||
    !motions ||
    !expressions ||
    !poses ||
    !lipsync ||
    !physics ||
    !hitRegions ||
    !nasFallback
  ) {
    return null;
  }
  const idle = readRecord(motions['idle']);
  const idleGroup = idle ? readString(idle, 'group') : null;
  const missingActivity = motions['missing_activity'];
  const expressionDisposition = readDisposition(expressions['disposition']);
  const poseDisposition = readDisposition(poses['disposition']);
  const lipsyncDisposition = readDisposition(lipsync['disposition']);
  const physicsDisposition = readDisposition(physics['disposition']);
  const hitRegionDisposition = readDisposition(hitRegions['disposition']);
  const physicsMode = physics['mode'];
  const hitFallback = hitRegions['fallback'];
  const defaultIdleMotion = readString(nasFallback, 'default_idle_motion');
  const missingHandler = nasFallback['missing_handler'];
  if (
    !idleGroup ||
    (missingActivity !== 'diagnostic_no_success' && missingActivity !== 'idle_degraded_with_diagnostic') ||
    !expressionDisposition ||
    !poseDisposition ||
    !lipsyncDisposition ||
    !physicsDisposition ||
    !hitRegionDisposition ||
    (physicsMode !== 'model_physics' && physicsMode !== 'absent' && physicsMode !== 'unsupported') ||
    (hitFallback !== 'alpha_mask_only' && hitFallback !== 'fail_closed') ||
    !defaultIdleMotion ||
    (missingHandler !== 'backend_default_with_diagnostic' && missingHandler !== 'no_default')
  ) {
    return null;
  }
  return {
    manifest_kind: LIVE2D_ADAPTER_MANIFEST_KIND,
    schema_version: 1,
    adapter_id: adapterId,
    target_model: {
      model_id: modelId,
      model3,
      expected_runtime_digest: readString(target, 'expected_runtime_digest') ?? undefined,
    },
    license: {
      redistribution,
      evidence: readString(license, 'evidence') ?? '',
      fixture_use: fixtureUse,
    },
    compatibility: { requested_tier: requestedTier },
    semantics: {
      motions: {
        idle: { group: idleGroup },
        activities: parseActivityMappings(motions['activities']),
        missing_activity: missingActivity,
      },
      expressions: {
        map: readStringMap(expressions['map']),
        disposition: expressionDisposition,
      },
      poses: {
        map: readStringMap(poses['map']),
        disposition: poseDisposition,
      },
      lipsync: {
        mouth_open_y_parameter: readString(lipsync, 'mouth_open_y_parameter') ?? undefined,
        disposition: lipsyncDisposition,
      },
      physics: {
        mode: physicsMode,
        disposition: physicsDisposition,
      },
      hit_regions: {
        map: readStringArrayMap(hitRegions['map']),
        fallback: hitFallback,
        disposition: hitRegionDisposition,
      },
      nas_fallback: {
        default_idle_motion: defaultIdleMotion,
        missing_handler: missingHandler,
      },
    },
  };
}

export function parseLive2DAdapterManifest(raw: string): Live2DAdapterManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = parseManifestObject(parsed);
  if (!manifest) {
    throw new Error('AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID: invalid Live2D adapter manifest v1');
  }
  return manifest;
}

function hasMotion(resources: Live2DBackendResources, group: string): boolean {
  return resources.motionGroups.has(group);
}

function hitAreaNames(settings: Model3Settings): Set<string> {
  const names = new Set<string>();
  for (const area of settings.HitAreas ?? []) {
    names.add(area.Id);
    names.add(area.Name);
  }
  return names;
}

function declaredParameterIds(settings: Model3Settings): Set<string> {
  const ids = new Set<string>();
  for (const group of settings.Groups ?? []) {
    for (const id of group.Ids ?? []) {
      ids.add(id);
    }
  }
  return ids;
}

function requestedTierRank(tier: Exclude<Live2DCompatibilityTier, 'unsupported'>): number {
  return tier === 'render_only' ? 1 : tier === 'semantic_basic' ? 2 : 3;
}

function computedTier(maxRank: number, diagnostics: Live2DCompatibilityDiagnostic[]): Live2DCompatibilityTier {
  if (diagnostics.length > 0) return 'unsupported';
  if (maxRank >= 3) return 'companion_complete';
  if (maxRank >= 2) return 'semantic_basic';
  return 'render_only';
}

function validateMotionMapping(input: {
  diagnostics: Live2DCompatibilityDiagnostic[];
  resources: Live2DBackendResources;
  mapping: ActivityMotionMapping;
  path: string;
}): void {
  for (const [key, group] of Object.entries(input.mapping)) {
    if ((key === 'group' || key === 'weak_group' || key === 'strong_group') && typeof group === 'string' && !hasMotion(input.resources, group)) {
      input.diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_MOTION_MISSING', `motion group is missing: ${group}`, `${input.path}.${key}`));
    }
  }
}

export function validateLive2DCompatibility(input: Live2DCompatibilityInput): Live2DCompatibilityReport {
  const diagnostics: Live2DCompatibilityDiagnostic[] = [];
  const adapter = input.adapter ?? null;
  if (!adapter) {
    return {
      tier: 'render_only',
      adapter: null,
      diagnostics,
      activityMotionGroups: new Map(),
      idleMotionGroup: 'Idle',
      mouthOpenParameterId: DEFAULT_MOUTH_OPEN_PARAMETER,
      missingActivity: 'idle_degraded_with_diagnostic',
    };
  }

  if (adapter.target_model.model_id !== input.model.modelId) {
    diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH', `adapter targets ${adapter.target_model.model_id}, model is ${input.model.modelId}`, 'target_model.model_id'));
  }
  if (adapter.license.fixture_use === 'committable' && adapter.license.redistribution !== 'allowed') {
    diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED', 'committable fixtures require redistribution=allowed', 'license'));
  }
  const activities = adapter.semantics.motions.activities ?? {};
  if (!hasMotion(input.resources, adapter.semantics.motions.idle.group)) {
    diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_MOTION_MISSING', `idle motion group is missing: ${adapter.semantics.motions.idle.group}`, 'semantics.motions.idle.group'));
  }
  for (const [activityId, mapping] of Object.entries(activities)) {
    validateMotionMapping({
      diagnostics,
      resources: input.resources,
      mapping,
      path: `semantics.motions.activities.${activityId}`,
    });
  }
  const rank = requestedTierRank(adapter.compatibility.requested_tier);
  if (rank >= 2) {
    for (const activityId of BASIC_REQUIRED_ACTIVITY_IDS) {
      if (activityId === 'idle') continue;
      const mapping = activities[activityId];
      if (!mapping?.group) {
        diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_UNSUPPORTED_SEMANTIC', `semantic_basic requires motion mapping for ${activityId}`, `semantics.motions.activities.${activityId}`));
      }
    }
  }
  if (rank >= 3) {
    for (const activityId of COMPLETE_REQUIRED_ACTIVITY_IDS) {
      if (activityId === 'idle') continue;
      const mapping = activities[activityId];
      if (!mapping?.group) {
        diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_UNSUPPORTED_SEMANTIC', `companion_complete requires motion mapping for ${activityId}`, `semantics.motions.activities.${activityId}`));
      }
    }
  }
  for (const [semanticId, expressionId] of Object.entries(adapter.semantics.expressions.map ?? {})) {
    if (!input.resources.expressions.has(expressionId)) {
      diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING', `expression mapping ${semanticId} points to missing expression ${expressionId}`, `semantics.expressions.map.${semanticId}`));
    }
  }
  if ((Object.keys(adapter.semantics.poses.map ?? {}).length > 0 || adapter.semantics.poses.disposition.status === 'supported') && !input.resources.posePath) {
    diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE', 'pose support is claimed but pose3.json is absent', 'semantics.poses'));
  }
  if (adapter.semantics.lipsync.disposition.status === 'supported') {
    const parameterId = adapter.semantics.lipsync.mouth_open_y_parameter;
    const ids = declaredParameterIds(input.settings);
    if (!parameterId || ids.size === 0 || !ids.has(parameterId)) {
      diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING', `lipsync parameter is not declared: ${parameterId ?? '<missing>'}`, 'semantics.lipsync.mouth_open_y_parameter'));
    }
  }
  if ((adapter.semantics.physics.mode === 'model_physics' || adapter.semantics.physics.disposition.status === 'supported') && !input.resources.physicsPath) {
    diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_PHYSICS_UNAVAILABLE', 'physics support is claimed but physics3.json is absent', 'semantics.physics'));
  }
  if (adapter.semantics.hit_regions.disposition.status === 'supported') {
    const available = hitAreaNames(input.settings);
    for (const [semanticRegion, aliases] of Object.entries(adapter.semantics.hit_regions.map ?? {})) {
      if (aliases.length > 0 && aliases.every((alias) => !available.has(alias))) {
        diagnostics.push(diagnostic('AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING', `hit region mapping ${semanticRegion} points to absent hit areas`, `semantics.hit_regions.map.${semanticRegion}`));
      }
    }
  }

  const tier = computedTier(rank, diagnostics);
  const activityMotionGroups = new Map<string, ActivityMotionMapping>();
  for (const [activityId, mapping] of Object.entries(activities)) {
    activityMotionGroups.set(activityId, mapping);
  }
  return {
    tier,
    adapter,
    diagnostics,
    activityMotionGroups,
    idleMotionGroup: adapter.semantics.motions.idle.group,
    mouthOpenParameterId: adapter.semantics.lipsync.disposition.status === 'supported'
      ? adapter.semantics.lipsync.mouth_open_y_parameter ?? DEFAULT_MOUTH_OPEN_PARAMETER
      : DEFAULT_MOUTH_OPEN_PARAMETER,
    missingActivity: adapter.semantics.motions.missing_activity,
  };
}

export function assertLive2DCompatibilitySupported(report: Live2DCompatibilityReport): void {
  if (report.tier !== 'unsupported') {
    return;
  }
  const detail = report.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join('; ');
  throw new Error(detail || 'AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID: unsupported Live2D adapter compatibility');
}
