import type {
  NimiRuntimeLocalAssetAdminClient,
  NimiRuntimeLocalEnvironmentPlan,
  NimiRuntimeLocalEnvironmentPlanInput,
} from '@nimiplatform/sdk/runtime';

type LocalEnvironmentPlanReader = {
  readonly resolveEnvironmentPlan: NimiRuntimeLocalAssetAdminClient['resolveEnvironmentPlan'];
};

export type RuntimeConfigLocalCapabilityContract =
  | 'text.generate'
  | 'image.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'voice.create';

export type RuntimeConfigLocalSpeechEnvironmentPlan = {
  readonly resolution: NimiRuntimeLocalEnvironmentPlanInput;
  readonly plan: NimiRuntimeLocalEnvironmentPlan;
};

export async function resolveRuntimeConfigLocalEnvironmentPlan(input: {
  readonly capabilityContract: RuntimeConfigLocalCapabilityContract;
  readonly localEnvironment: LocalEnvironmentPlanReader;
}): Promise<RuntimeConfigLocalSpeechEnvironmentPlan> {
  const resolution: NimiRuntimeLocalEnvironmentPlanInput = {
    capabilityContract: input.capabilityContract,
  };
  return {
    resolution,
    plan: await input.localEnvironment.resolveEnvironmentPlan(resolution),
  };
}
