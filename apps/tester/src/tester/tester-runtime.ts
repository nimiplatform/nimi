import { getRuntimeDefaults } from '@nimiplatform/kit/shell/renderer/bridge';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import type { MediaAttachment } from './tester-multimodal-input.js';
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
  /** Optional live-delta callback forwarded to streaming capabilities. */
  onPartial?: (accumulatedText: string) => void;
  /** Optional local media attachments for vision/multimodal text capabilities. */
  attachments?: MediaAttachment[];
  /** Optional app-composed instruction line (tone/length) prepended to the prompt. */
  directive?: string;
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
    const defaults = await getRuntimeDefaults();
    const health = await projection.client.domains.runtimeAdmin.getRuntimeHealth({});
    return {
      status: 'ready',
      mode: projection.mode,
      detail: `Runtime app session is ready. Realm defaults resolve to ${defaults.realm.realmBaseUrl}. Capability lanes call runtime.ai.* / runtime.media.* directly.`,
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
    onPartial: input.onPartial,
    attachments: input.attachments,
    directive: input.directive,
  });
  return result;
}
