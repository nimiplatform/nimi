import { inspectRuntimeConnection, type LabRuntimeInspection } from './lab-runtime.js';

export type LabAIConfigSummary = {
  runtime: LabRuntimeInspection;
};

export async function loadLabAIConfigSummary(): Promise<LabAIConfigSummary> {
  return {
    runtime: await inspectRuntimeConnection(),
  };
}
