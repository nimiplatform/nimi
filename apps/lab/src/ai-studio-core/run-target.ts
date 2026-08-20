import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';

import {
  findStudioCapabilityIntent,
  studioCloudIntentHasExactTarget,
} from './ai-config.js';
import type { StudioRunTargetSummary } from './history.js';
import type { StudioCapabilityDescriptor } from './module-registration.js';
import type { StudioRuntimeInspection } from './runtime-types.js';

export function createStudioRunTargetSummary(input: {
  readonly capability: StudioCapabilityDescriptor;
  readonly runtime: StudioRuntimeInspection | null;
  readonly config: NimiPortableAppAIConfig | null;
  readonly configState?: 'loading' | 'loaded' | 'failed';
  readonly configError?: string | null;
}): StudioRunTargetSummary {
  const { capability, runtime, config } = input;
  const capabilityContract = capability.capabilityContract ?? null;
  const base = {
    capabilityId: capability.id,
    capabilityContract,
    section: capability.section,
    params: {},
    paramsSummary: [],
    profileOrigin: null,
  } as const;

  if (capability.execution === 'standalone-tauri') {
    throw new Error('Standalone capability run targets must be projected by an app-specific host adapter.');
  }
  if (capability.execution === 'typed-unavailable' || !capabilityContract) {
    return {
      ...base,
      status: 'sdk-gap',
      source: 'unknown',
      intentLabel: 'Capability unavailable',
      detail: capability.missingSurface || 'No admitted typed SDK method is available for this capability.',
      canDispatch: false,
    };
  }
  if (!runtime) {
    return {
      ...base,
      status: 'checking',
      source: 'unknown',
      intentLabel: 'Checking configuration',
      detail: 'Reading the current App AIConfig and Runtime connection.',
      canDispatch: false,
    };
  }
  if (runtime.status !== 'connected') {
    return {
      ...base,
      status: 'not-admitted',
      source: 'unknown',
      intentLabel: 'Runtime unavailable',
      detail: runtime.detail,
      canDispatch: false,
    };
  }
  if (input.configState === 'loading') {
    return {
      ...base,
      status: 'checking',
      source: 'unknown',
      intentLabel: 'Reading App AIConfig',
      detail: 'Reading the current Runtime-owned App AIConfig.',
      canDispatch: false,
    };
  }
  if (input.configState === 'failed') {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      intentLabel: 'AIConfig unavailable',
      detail: input.configError || 'The current App AIConfig could not be read.',
      canDispatch: false,
    };
  }

  const intent = findStudioCapabilityIntent(config, capabilityContract);
  if (!intent) {
    return {
      ...base,
      status: 'blocked',
      source: 'unknown',
      intentLabel: 'Not configured',
      detail: 'This App AIConfig has no intent for the capability. Configure this App in Nimi Desktop.',
      canDispatch: false,
    };
  }
  if (intent.route.oneofKind === 'local') {
    return {
      ...base,
      status: 'configured',
      source: 'local',
      intentLabel: 'Local',
      detail: 'The App owner selected Local intent. Runtime chooses and validates the implementation when execution begins.',
      canDispatch: true,
    };
  }
  if (intent.route.oneofKind === 'cloud' && studioCloudIntentHasExactTarget(intent)) {
    return {
      ...base,
      status: 'configured',
      source: 'cloud',
      intentLabel: 'Cloud',
      detail: 'Nimi-owned App configuration selects the Cloud intent, and Runtime resolves the current-account execution route.',
      canDispatch: true,
    };
  }

  return {
    ...base,
    status: 'blocked',
    source: 'unknown',
    intentLabel: 'Invalid configuration',
    detail: 'The capability has no supported Local or Cloud intent.',
    canDispatch: false,
  };
}
