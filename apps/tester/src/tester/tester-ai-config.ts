import { inspectRuntimeConnection, type TesterRuntimeInspection } from './tester-runtime.js';

export type TesterAIConfigSummary = {
  runtime: TesterRuntimeInspection;
};

export async function loadTesterAIConfigSummary(): Promise<TesterAIConfigSummary> {
  return {
    runtime: await inspectRuntimeConnection(),
  };
}
