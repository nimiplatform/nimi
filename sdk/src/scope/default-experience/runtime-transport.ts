import type { RuntimeLocalServiceClient } from '../../runtime/types-client-interfaces.js';
import type { LocalDeviceProfile } from '../../runtime/generated/runtime/v1/local_runtime_types.js';
import type {
  ApplicableScope,
  ApplyResult,
  ColdStartProjection,
  ColdStartState,
  ComputePosture,
  DefaultExperienceProfile,
  HostProfile,
  ProfilePreferences,
  ScopeRef,
  UpstreamInputs,
} from './types.js';
import type { DefaultExperienceTransport } from './transport.js';

export interface RuntimeDefaultExperienceProfileRow extends DefaultExperienceProfile {
  readonly localComputePackRefs?: readonly string[];
  readonly dependencyFamilyRefs?: readonly string[];
}

export interface RuntimeDefaultExperienceTransportOptions {
  readonly localRuntime: Pick<
    RuntimeLocalServiceClient,
    'collectDeviceProfile' | 'resolveLocalEnvironmentActivationGate'
  >;
  readonly loadProfiles: () => Promise<readonly RuntimeDefaultExperienceProfileRow[]> | readonly RuntimeDefaultExperienceProfileRow[];
  readonly runtimeDataRoot?: string;
  readonly consumerId?: string;
  readonly applyProfile?: (scopeRef: ScopeRef, profileId: string) => Promise<ApplyResult>;
}

export class RuntimeDefaultExperienceTransportError extends Error {
  readonly code:
    | 'invalid-dependency'
    | 'missing-catalog'
    | 'missing-host-profile'
    | 'missing-profile'
    | 'unsupported-apply'
    | 'runtime-error';

  constructor(
    code: RuntimeDefaultExperienceTransportError['code'],
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'RuntimeDefaultExperienceTransportError';
  }
}

export function createRuntimeDefaultExperienceTransport(
  options: RuntimeDefaultExperienceTransportOptions,
): DefaultExperienceTransport {
  assertRuntimeDefaultExperienceOptions(options);
  return {
    hostProfile: () => collectHostProfile(options.localRuntime),
    recommendProfile: async (scope, preferences) => {
      const [host, profiles] = await Promise.all([
        collectHostProfile(options.localRuntime),
        resolveProfiles(options.loadProfiles),
      ]);
      return selectProfileForHost(profiles, host, scope, preferences);
    },
    applyProfile: async (scopeRef, profileId) => {
      if (!options.applyProfile) {
        throw new RuntimeDefaultExperienceTransportError(
          'unsupported-apply',
          'Runtime Default Experience transport cannot apply AIConfig without a host-owned applyProfile callback',
        );
      }
      return options.applyProfile(scopeRef, profileId);
    },
    projectColdStart: async (inputs) => projectColdStartFromInputs(inputs),
  };
}

export async function resolveDefaultExperienceMaterializationState(
  localRuntime: Pick<RuntimeLocalServiceClient, 'collectDeviceProfile' | 'resolveLocalEnvironmentActivationGate'>,
  profile: RuntimeDefaultExperienceProfileRow,
  options: { readonly consumerId?: string; readonly runtimeDataRoot?: string } = {},
): Promise<ColdStartProjection> {
  if (!localRuntime) {
    throw new RuntimeDefaultExperienceTransportError('invalid-dependency', 'localRuntime is required');
  }
  const packIds = profile.localComputePackRefs ?? [];
  if (packIds.length === 0) {
    return { state: 'ready' };
  }
  let hostProfile: LocalDeviceProfile;
  try {
    const response = await localRuntime.collectDeviceProfile({ extraPorts: [] });
    if (!response.profile) {
      throw new RuntimeDefaultExperienceTransportError(
        'missing-host-profile',
        'collectDeviceProfile response missing profile',
      );
    }
    hostProfile = response.profile;
  } catch (error) {
    if (error instanceof RuntimeDefaultExperienceTransportError) throw error;
    throw new RuntimeDefaultExperienceTransportError('runtime-error', 'collectDeviceProfile failed', error);
  }

  const states: ColdStartProjection[] = [];
  for (const packId of packIds) {
    try {
      const response = await localRuntime.resolveLocalEnvironmentActivationGate({
        consumerId: options.consumerId ?? profile.alias,
        packId,
        hostProfile,
        runtimeDataRoot: options.runtimeDataRoot ?? '',
        assetId: '',
        localAssetId: '',
        companionAssetId: '',
        parentAssetId: '',
      });
      states.push(mapActivationState(response.gate?.state, response.gate?.detail));
    } catch (error) {
      throw new RuntimeDefaultExperienceTransportError(
        'runtime-error',
        `resolveLocalEnvironmentActivationGate failed for pack "${packId}"`,
        error,
      );
    }
  }
  return worstProjection(states);
}

async function collectHostProfile(
  localRuntime: Pick<RuntimeLocalServiceClient, 'collectDeviceProfile'>,
): Promise<HostProfile> {
  try {
    const response = await localRuntime.collectDeviceProfile({ extraPorts: [] });
    if (!response.profile) {
      throw new RuntimeDefaultExperienceTransportError(
        'missing-host-profile',
        'collectDeviceProfile response missing profile',
      );
    }
    return toHostProfile(response.profile);
  } catch (error) {
    if (error instanceof RuntimeDefaultExperienceTransportError) throw error;
    throw new RuntimeDefaultExperienceTransportError('runtime-error', 'collectDeviceProfile failed', error);
  }
}

function toHostProfile(profile: LocalDeviceProfile): HostProfile {
  const refs = hostCapabilityRefs(profile);
  return {
    profileId: refs[0] ?? `${profile.os || 'unknown'}-${profile.arch || 'unknown'}-cpu`,
    platform: { os: profile.os, arch: profile.arch },
    acceleratorVendor: profile.gpu?.available ? profile.gpu.vendor : profile.npu?.available ? profile.npu.vendor : undefined,
    acceleratorPlanes: refs,
  };
}

function hostCapabilityRefs(profile: LocalDeviceProfile): readonly string[] {
  const platform = `${profile.os}-${profile.arch}`;
  const refs: string[] = [];
  const vendor = profile.gpu?.vendor.toLowerCase() ?? '';
  if (profile.gpu?.available && profile.os === 'windows' && vendor.includes('nvidia')) {
    refs.push(`${platform}-nvidia-cuda`);
  }
  if (profile.gpu?.available && profile.os === 'darwin' && profile.arch === 'arm64') {
    refs.push('darwin-arm64-metal');
  }
  refs.push(`${platform}-cpu`);
  return refs;
}

async function resolveProfiles(
  loadProfiles: RuntimeDefaultExperienceTransportOptions['loadProfiles'],
): Promise<readonly RuntimeDefaultExperienceProfileRow[]> {
  const profiles = await loadProfiles();
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new RuntimeDefaultExperienceTransportError(
      'missing-catalog',
      'Default Experience profile catalog is empty or unavailable',
    );
  }
  return profiles;
}

function selectProfileForHost(
  profiles: readonly RuntimeDefaultExperienceProfileRow[],
  host: HostProfile,
  scope: ApplicableScope,
  preferences?: ProfilePreferences,
): RuntimeDefaultExperienceProfileRow {
  const hostRefs = new Set([host.profileId, ...(host.acceleratorPlanes ?? [])]);
  const candidates = profiles
    .filter((profile) => profile.applicableScopes.includes(scope))
    .filter((profile) => profile.hostCapabilityProfileRefs.some((ref) => hostRefs.has(ref)))
    .map((profile, index) => ({ profile, score: scoreProfile(profile, preferences), index }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = candidates[0]?.profile;
  if (!selected) {
    throw new RuntimeDefaultExperienceTransportError(
      'missing-profile',
      `No Default Experience profile matches host "${host.profileId}" and scope "${scope}"`,
    );
  }
  return selected;
}

function scoreProfile(profile: RuntimeDefaultExperienceProfileRow, preferences?: ProfilePreferences): number {
  if (!preferences) return 0;
  let score = 0;
  if (preferences.preferredPrivacy && profile.privacyPosture === preferences.preferredPrivacy) score += 3;
  if (preferences.preferredCompute && profile.computePosture === preferences.preferredCompute) score += 2;
  if (preferences.preferredRouting && profile.routingPolicy === preferences.preferredRouting) score += 2;
  if (preferences.preferredCompute && computePreferenceCompatible(profile.computePosture, preferences.preferredCompute)) {
    score += 1;
  }
  return score;
}

function computePreferenceCompatible(actual: ComputePosture, preferred: ComputePosture): boolean {
  if (actual === preferred) return true;
  if (preferred === 'cuda-capable') return actual === 'cloud-only';
  if (preferred === 'metal-capable') return actual === 'cloud-only';
  return false;
}

function projectColdStartFromInputs(inputs: UpstreamInputs): ColdStartProjection {
  const states = Object.entries(inputs).map(([owner, state]) => ({ state, reasonOwner: owner }));
  return worstProjection(states);
}

function worstProjection(states: readonly ColdStartProjection[]): ColdStartProjection {
  const order: readonly ColdStartState[] = [
    'failed',
    'unsupported',
    'unavailable',
    'stale-projection',
    'setup-required',
    'needs-confirmation',
    'in-progress',
    'ready',
  ];
  for (const state of order) {
    const match = states.find((projection) => projection.state === state);
    if (match) return match;
  }
  return { state: 'unavailable', detail: 'No owner projection available' };
}

function mapActivationState(state: string | undefined, detail?: string): ColdStartProjection {
  switch (state) {
    case 'ready':
      return { state: 'ready', detail };
    case 'setup_required':
    case 'repair_required':
      return { state: 'setup-required', detail };
    case 'setup_in_progress':
      return { state: 'in-progress', detail };
    case 'failed':
    case 'cancelled':
      return { state: 'failed', detail };
    case 'unsupported':
      return { state: 'unsupported', detail };
    default:
      return { state: 'unavailable', detail: detail ?? `Unknown activation state "${String(state)}"` };
  }
}

function assertRuntimeDefaultExperienceOptions(options: RuntimeDefaultExperienceTransportOptions): void {
  if (!options?.localRuntime) {
    throw new RuntimeDefaultExperienceTransportError('invalid-dependency', 'localRuntime is required');
  }
  if (typeof options.localRuntime.collectDeviceProfile !== 'function') {
    throw new RuntimeDefaultExperienceTransportError(
      'invalid-dependency',
      'localRuntime.collectDeviceProfile is required',
    );
  }
  if (typeof options.localRuntime.resolveLocalEnvironmentActivationGate !== 'function') {
    throw new RuntimeDefaultExperienceTransportError(
      'invalid-dependency',
      'localRuntime.resolveLocalEnvironmentActivationGate is required',
    );
  }
  if (typeof options.loadProfiles !== 'function') {
    throw new RuntimeDefaultExperienceTransportError('invalid-dependency', 'loadProfiles callback is required');
  }
}
