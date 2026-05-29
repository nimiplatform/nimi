import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';
import {
  invokeTesterCapability,
  type TesterInvocationResult,
  type TesterTypedSuccess,
} from './tester-runtime-invokers.js';

export type TesterRuntimeInspection = {
  status: 'ready' | 'unavailable';
  mode: string;
  detail: string;
  healthJson?: string;
};

export type TesterCapabilityRunInput = {
  capabilityId: TesterCapabilityId;
  prompt: string;
  scenarioId?: string;
};

export type TesterCapabilityRunResult = TesterTypedSuccess | TesterUnavailable;

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1600);
  } catch {
    return String(value);
  }
}

export async function inspectRuntimeReadiness(): Promise<TesterRuntimeInspection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return {
      status: 'unavailable',
      mode: projection.mode,
      detail: projection.message,
    };
  }
  try {
    const health = await projection.client.domains.runtimeAdmin.getRuntimeHealth({});
    return {
      status: 'ready',
      mode: projection.mode,
      detail: 'Runtime app session is ready. Capability lanes call runtime.ai.* / runtime.media.* directly.',
      healthJson: compactJson(health),
    };
  } catch (error) {
    return {
      status: 'unavailable',
      mode: projection.mode,
      detail: error instanceof Error ? error.message : String(error || 'Runtime health check failed.'),
    };
  }
}

export async function runTesterCapability(input: TesterCapabilityRunInput): Promise<TesterCapabilityRunResult> {
  const capability = getTesterCapability(input.capabilityId);
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return capabilityUnavailable(capability, 'runtime-not-ready', projection.message);
  }
  const result: TesterInvocationResult = await invokeTesterCapability(projection.client, input.capabilityId, {
    prompt: input.prompt,
    scenarioId: input.scenarioId || 'default',
  });
  return result;
}
