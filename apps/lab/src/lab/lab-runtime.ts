import {
  createNimiLocalAppRuntimeScenarioJobClient,
  type NimiLocalAppClient,
} from '@nimiplatform/sdk/app';
import { appId } from '../shell/auth/app-identity.js';
import type { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { inspectRuntimeConnection } from './lab-runtime-inspection.js';
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
} from '../ai-studio-core/runtime-types.js';
import { studioCreateRuntimeHandlers } from '../studio-modules/studio-create/runtime.js';
import { studioMediaRuntimeHandlers } from '../studio-modules/studio-media/runtime.js';
import { studioVoiceRuntimeHandlers } from '../studio-modules/studio-voice/runtime.js';
import { labCapabilityTestRuntimeHandlers } from './lab-only/capability-test-runtime.js';
import { capabilityNonSuccess } from './lab-non-success.js';
import { getStudioRuntimeCapability } from './studio-runtime-capabilities.js';
import { t } from '../shell/i18n/index.js';

// Lab owns only the protected host carrier and its identity-bound wiring. The
// product Runtime handlers and dispatcher remain identity-neutral module code.
const LAB_RUNTIME_SURFACE_ID = 'lab.ai-capabilities';
const LAB_RUNTIME_ABORT_REASON = 'lab-user-canceled';

const LAB_STUDIO_RUNTIME_HANDLERS = composeStudioCapabilityRuntimeHandlers([
  studioCreateRuntimeHandlers,
  studioMediaRuntimeHandlers,
  studioVoiceRuntimeHandlers,
  labCapabilityTestRuntimeHandlers,
]);

export type LabRuntimeDependencies = {
  readonly getRuntimeProjection?: typeof getRuntimePlatformProjection;
  readonly getLocalAppClient?: () => NimiLocalAppClient;
  readonly createScenarioJobClient?: typeof createNimiLocalAppRuntimeScenarioJobClient;
  readonly runners?: Partial<StudioRuntimeRunnerSet>;
};

export async function runLabCapability(
  input: StudioCapabilityRunInput,
  dependencies: LabRuntimeDependencies = {},
): Promise<StudioCapabilityRunResult> {
  return runStudioCapability(input, {
    appId,
    surfaceId: LAB_RUNTIME_SURFACE_ID,
    abortReason: LAB_RUNTIME_ABORT_REASON,
    translate: t,
    handlers: LAB_STUDIO_RUNTIME_HANDLERS,
    resolveCapability: getStudioRuntimeCapability,
    inspectRuntime: () => inspectRuntimeConnection(dependencies.getRuntimeProjection),
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
      : context.capability.id === 'realtime.interact'
        ? capabilityNonSuccess(
            context.capability,
            'sdk-method-unavailable',
            'AI Realtime runs as a Session on its own Lab page.',
          )
        : context.capability.id === 'text.conversation' || context.capability.id === 'text.chat-session'
          ? capabilityNonSuccess(
              context.capability,
              'sdk-method-unavailable',
              'Conversation turns run on their own Lab page.',
            )
          : null,
  });
}
