import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';

import type { StudioRunTargetStatus, StudioRunTargetSummary } from '../ai-studio-core/history.js';
import type { StudioCapabilityDescriptor } from '../ai-studio-core/module-registration.js';
import { createStudioRunTargetSummary } from '../ai-studio-core/run-target.js';
import type { StudioRuntimeInspection } from '../ai-studio-core/runtime-types.js';
import { t } from '../shell/i18n/index.js';
import { isLabLocalRouteOnlyCapability } from './lab-only/capability-test-descriptors.js';

export type LabRunTargetStatus = StudioRunTargetStatus;
export type LabRunTargetSource = StudioRunTargetSummary['source'];
export type LabRunTargetParamRecord = Readonly<Record<string, unknown>>;
export type LabRunTargetSummary = StudioRunTargetSummary;

export function createLabRunTargetSummary(input: {
  readonly capability: StudioCapabilityDescriptor;
  readonly runtime: StudioRuntimeInspection | null;
  readonly config: NimiPortableAppAIConfig | null;
  readonly configState?: 'loading' | 'loaded' | 'failed';
  readonly configError?: string | null;
  readonly standaloneViewerAvailable?: boolean;
}): LabRunTargetSummary {
  if (input.capability.execution !== 'standalone-electron') {
    const target = createStudioRunTargetSummary(input);
    // AIConfig can name Cloud here, but Runtime refuses that route, so a saved
    // Cloud intent is not presented as a runnable configuration.
    if (target.source === 'cloud' && isLabLocalRouteOnlyCapability(input.capability.id)) {
      return {
        ...target,
        status: 'blocked',
        canDispatch: false,
        detail: t('CapabilityTests.common.localRouteBlocked'),
      };
    }
    return target;
  }

  const canDispatch = input.standaloneViewerAvailable === true;
  return {
    capabilityId: input.capability.id,
    capabilityContract: null,
    section: input.capability.section,
    status: 'viewer-only',
    source: 'local',
    intentLabel: 'Local fixture',
    detail: canDispatch
      ? 'This lane opens the standalone Electron viewer and does not generate a world.'
      : 'This lane requires the supervised Electron host to open its viewer.',
    canDispatch,
    params: {},
    paramsSummary: [],
    profileOrigin: null,
  };
}
