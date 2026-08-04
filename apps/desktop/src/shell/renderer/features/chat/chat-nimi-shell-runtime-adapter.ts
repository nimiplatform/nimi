import type { NimiDesktopMachineProductRuntimeClient } from '@nimiplatform/sdk/runtime';
import {
  runRuntimeAIConsumeCapability,
  type RuntimeAIConsumeOutput,
} from '@nimiplatform/kit/features/generation/runtime';

export type DesktopNimiTextCapabilityResult = {
  readonly text: string;
  readonly traceId: string | null;
};

export type DesktopNimiTextCapabilityInput = {
  readonly runtime: { readonly ai: NimiDesktopMachineProductRuntimeClient['ai'] };
  readonly appId: string;
  readonly prompt: string;
  readonly subjectUserId?: string;
  readonly signal?: AbortSignal;
};

/** Pure App projection into the Kit CapabilityContract boundary. */
export function buildDesktopNimiTextCapabilityRequest(
  input: DesktopNimiTextCapabilityInput,
): Parameters<typeof runRuntimeAIConsumeCapability>[0] {
  return {
    runtime: input.runtime,
    appId: input.appId,
    capabilityId: 'text.generate',
    prompt: input.prompt,
    scenarioId: 'desktop-nimi-chat',
    subjectUserId: input.subjectUserId,
    surfaceId: 'desktop.chat.nimi',
    signal: input.signal,
  };
}

/**
 * Executes only a CapabilityContract request. No App-owned model, route target,
 * binding, readiness, llama parameter, or fallback input is admitted.
 */
export async function runDesktopNimiTextCapability(
  input: DesktopNimiTextCapabilityInput,
): Promise<DesktopNimiTextCapabilityResult> {
  const result = await runRuntimeAIConsumeCapability(
    buildDesktopNimiTextCapabilityRequest(input),
  );
  if (!result.ok) throw result.error;
  return projectTextOutput(result.output, result.trace?.traceId);
}

function projectTextOutput(
  output: RuntimeAIConsumeOutput,
  traceId: string | undefined,
): DesktopNimiTextCapabilityResult {
  if (output.kind !== 'text') {
    throw new Error('Runtime text.generate returned a non-text output.');
  }
  return {
    text: output.text,
    traceId: traceId?.trim() || null,
  };
}
