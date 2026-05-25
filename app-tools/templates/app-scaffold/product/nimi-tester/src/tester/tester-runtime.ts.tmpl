import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';

export type TesterRuntimeInspection = {
  status: 'ready' | 'unavailable';
  mode: string;
  detail: string;
  healthJson?: string;
};

export type TesterCapabilityRunInput = {
  capabilityId: TesterCapabilityId;
  prompt: string;
};

export type TesterCapabilityRunResult =
  | {
      ok: true;
      capabilityId: TesterCapabilityId;
      message: string;
      runtime: TesterRuntimeInspection;
    }
  | TesterUnavailable;

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
      detail: 'Runtime app session is ready. AI execution lanes still require admitted Nimi App SDK methods.',
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
  const runtime = await inspectRuntimeReadiness();
  if (runtime.status !== 'ready') {
    return capabilityUnavailable(capability, 'runtime-not-ready', runtime.detail);
  }
  return capabilityUnavailable(
    capability,
    'sdk-surface-missing',
    capability.missingSurface || `${capability.surface} is not admitted for generated Nimi Apps yet.`,
  );
}
