import {
  createNimiLocalAppRuntimeScenarioJobClient,
  type NimiLocalAppClient,
} from '@nimiplatform/sdk/app';
import { appId } from '../shell/auth/app-identity.js';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getLabLocalAppClient } from '../shell/local-app-runtime-platform.js';
import {
  composeStudioCapabilityRuntimeHandlers,
} from '../ai-studio-core/runtime-dispatcher.js';
import {
  runStudioCapability,
  type StudioRuntimeRunnerSet,
} from '../ai-studio-core/runtime.js';
import type {
  StudioCapabilityRunInput,
  StudioCapabilityRunResult,
  StudioRuntimeInspection,
} from '../ai-studio-core/runtime-types.js';
import { studioCreateRuntimeHandlers } from '../studio-modules/studio-create/runtime.js';
import { studioMediaRuntimeHandlers } from '../studio-modules/studio-media/runtime.js';
import { studioVoiceRuntimeHandlers } from '../studio-modules/studio-voice/runtime.js';
import { capabilityNonSuccess } from './lab-non-success.js';
import { getStudioRuntimeCapability } from './studio-runtime-capabilities.js';

// Lab owns only the protected host carrier and its identity-bound wiring. The
// product Runtime handlers and dispatcher remain identity-neutral module code.
const LAB_RUNTIME_SURFACE_ID = 'lab.ai-capabilities';
const LAB_RUNTIME_ABORT_REASON = 'lab-user-canceled';

const LAB_STUDIO_RUNTIME_HANDLERS = composeStudioCapabilityRuntimeHandlers([
  studioCreateRuntimeHandlers,
  studioMediaRuntimeHandlers,
  studioVoiceRuntimeHandlers,
]);

export type LabRuntimeDependencies = {
  readonly getRuntimeProjection?: typeof getRuntimePlatformProjection;
  readonly getLocalAppClient?: () => NimiLocalAppClient;
  readonly createScenarioJobClient?: typeof createNimiLocalAppRuntimeScenarioJobClient;
  readonly runners?: Partial<StudioRuntimeRunnerSet>;
};

export async function inspectRuntimeConnection(): Promise<StudioRuntimeInspection> {
  return inspectRuntimeConnectionWith(getRuntimePlatformProjection);
}

async function inspectRuntimeConnectionWith(
  getProjection: typeof getRuntimePlatformProjection,
): Promise<StudioRuntimeInspection> {
  const projection = await getProjection();
  if (projection.status !== 'ready') {
    return {
      status: 'unavailable',
      mode: projection.mode,
      detail: projection.message,
    };
  }
  return {
    status: 'connected',
    mode: projection.mode,
    detail: 'The protected local-app identity session is bound and Runtime is connected. The App AIConfig selects Local or an exact Cloud implementation; machine selection and execution availability remain Runtime-owned. Text requests run through the canonical Runtime execution path and fail closed with typed reasons when the composed route is not executable.',
  };
}

export async function runLabCapability(
  input: StudioCapabilityRunInput,
  dependencies: LabRuntimeDependencies = {},
): Promise<StudioCapabilityRunResult> {
  return runStudioCapability(input, {
    appId,
    surfaceId: LAB_RUNTIME_SURFACE_ID,
    abortReason: LAB_RUNTIME_ABORT_REASON,
    handlers: LAB_STUDIO_RUNTIME_HANDLERS,
    resolveCapability: getStudioRuntimeCapability,
    inspectRuntime: () => inspectRuntimeConnectionWith(
      dependencies.getRuntimeProjection ?? getRuntimePlatformProjection,
    ),
    getClient: dependencies.getLocalAppClient ?? getLabLocalAppClient,
    createScenarioId: (capability) => `lab:${capability.id}`,
    createScenarioJobClient: dependencies.createScenarioJobClient,
    runners: dependencies.runners,
    nonSuccess: capabilityNonSuccess,
    onMissingHandler: (context) => context.capability.id === 'world.generate'
      ? capabilityNonSuccess(
          context.capability,
          'sdk-method-unavailable',
          'World Tour runs through its standalone viewer command.',
        )
      : null,
  });
}
