import type { NimiPortableAppAIConfig } from '@nimiplatform/sdk/ai';

import type { StudioRunTargetStatus, StudioRunTargetSummary } from '../ai-studio-core/history.js';
import type { StudioCapabilityDescriptor } from '../ai-studio-core/module-registration.js';
import { createStudioRunTargetSummary } from '../ai-studio-core/run-target.js';
import type { StudioRuntimeInspection } from '../ai-studio-core/runtime-types.js';

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
  readonly standaloneTauriAvailable?: boolean;
}): LabRunTargetSummary {
  if (input.capability.execution !== 'standalone-tauri') {
    return createStudioRunTargetSummary(input);
  }

  const canDispatch = input.standaloneTauriAvailable === true;
  return {
    capabilityId: input.capability.id,
    capabilityContract: null,
    section: input.capability.section,
    status: 'tauri-only',
    source: 'local',
    intentLabel: 'Local fixture',
    detail: canDispatch
      ? 'This lane opens the standalone Tauri viewer and does not use Runtime AI configuration.'
      : 'This lane requires the standalone Tauri shell; the current shell cannot open its viewer.',
    canDispatch,
    params: {},
    paramsSummary: [],
    profileOrigin: null,
  };
}
