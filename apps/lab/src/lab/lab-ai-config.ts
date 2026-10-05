import type { StudioRuntimeInspection } from '../ai-studio-core/runtime-types.js';
import { inspectRuntimeConnection } from './lab-runtime-inspection.js';

export type LabAIConfigSummary = {
  runtime: StudioRuntimeInspection;
};

export async function loadLabAIConfigSummary(): Promise<LabAIConfigSummary> {
  return {
    runtime: await inspectRuntimeConnection(),
  };
}
