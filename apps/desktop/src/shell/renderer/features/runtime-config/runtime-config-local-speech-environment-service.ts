import {
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_VOXCPM_IMPLEMENTATION,
  buildNimiRuntimeLocalQwen3ASREnvironmentPlanInput,
  buildNimiRuntimeLocalQwen3ASRTransformersEnvironmentPlanInput,
  buildNimiRuntimeLocalQwen3TTSEnvironmentPlanInput,
  buildNimiRuntimeLocalVoxCPMEnvironmentPlanInput,
  type NimiMachineLocalAIConfiguration,
  type NimiRuntimeLocalAssetAdminClient,
  type NimiRuntimeLocalEnvironmentPlan,
  type NimiRuntimeLocalEnvironmentPlanInput,
} from '@nimiplatform/sdk/runtime';

type MachineConfigurationReader = {
  readonly get: () => Promise<NimiMachineLocalAIConfiguration>;
};

type LocalEnvironmentPlanReader = {
  readonly resolveEnvironmentPlan: NimiRuntimeLocalAssetAdminClient['resolveEnvironmentPlan'];
};

export type RuntimeConfigLocalSpeechEnvironmentPlan = {
  readonly resolution: NimiRuntimeLocalEnvironmentPlanInput;
  readonly plan: NimiRuntimeLocalEnvironmentPlan;
};

function isExactImplementation(value: {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
}, expected: {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
}): boolean {
  return value.implementationId === expected.implementationId
    && value.driverId === expected.driverId
    && value.driverDialect === expected.driverDialect;
}

export async function resolveRuntimeConfigLocalASREnvironmentPlan(input: {
  readonly machineConfiguration: MachineConfigurationReader;
  readonly localEnvironment: LocalEnvironmentPlanReader;
}): Promise<RuntimeConfigLocalSpeechEnvironmentPlan> {
  const aggregate = await input.machineConfiguration.get();
  const selection = aggregate.selections.find(
    (candidate) => candidate.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  );
  if (!selection) throw new Error('LOCAL_ASR_SELECTION_NOT_FOUND');
  const configuration = aggregate.configurations.find(
    (candidate) => candidate.configurationId === selection.configurationId
      && candidate.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  );
  if (!configuration) throw new Error('LOCAL_ASR_SELECTED_IMPLEMENTATION_UNSUPPORTED');
  const resolutionBuilder = isExactImplementation(
    configuration.implementation,
    NIMI_MACHINE_LOCAL_QWEN3_ASR_TRANSFORMERS_IMPLEMENTATION,
  )
    ? buildNimiRuntimeLocalQwen3ASRTransformersEnvironmentPlanInput
    : isExactImplementation(configuration.implementation, NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION)
      ? buildNimiRuntimeLocalQwen3ASREnvironmentPlanInput
      : null;
  if (!resolutionBuilder) throw new Error('LOCAL_ASR_SELECTED_IMPLEMENTATION_UNSUPPORTED');
  if (configuration.exactBindings.length !== 1 || !configuration.exactBindings[0]) {
    throw new Error('LOCAL_ASR_EXACT_BINDING_REQUIRED');
  }

  const resolution = resolutionBuilder({ localAssetId: configuration.exactBindings[0].localAssetId });
  return {
    resolution,
    plan: await input.localEnvironment.resolveEnvironmentPlan(resolution),
  };
}

export async function resolveRuntimeConfigLocalTTSEnvironmentPlan(input: {
  readonly machineConfiguration: MachineConfigurationReader;
  readonly localEnvironment: LocalEnvironmentPlanReader;
}): Promise<RuntimeConfigLocalSpeechEnvironmentPlan> {
  const aggregate = await input.machineConfiguration.get();
  const selection = aggregate.selections.find(
    (candidate) => candidate.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  );
  if (!selection) throw new Error('LOCAL_TTS_SELECTION_NOT_FOUND');
  const configuration = aggregate.configurations.find(
    (candidate) => candidate.configurationId === selection.configurationId
      && candidate.capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  );
  if (!configuration) throw new Error('LOCAL_TTS_SELECTED_IMPLEMENTATION_UNSUPPORTED');
  const resolutionBuilder = isExactImplementation(
    configuration.implementation,
    NIMI_MACHINE_LOCAL_VOXCPM_IMPLEMENTATION,
  )
    ? buildNimiRuntimeLocalVoxCPMEnvironmentPlanInput
    : isExactImplementation(configuration.implementation, NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION)
      ? buildNimiRuntimeLocalQwen3TTSEnvironmentPlanInput
      : null;
  if (!resolutionBuilder) throw new Error('LOCAL_TTS_SELECTED_IMPLEMENTATION_UNSUPPORTED');
  if (configuration.exactBindings.length !== 1 || !configuration.exactBindings[0]) {
    throw new Error('LOCAL_TTS_EXACT_BINDING_REQUIRED');
  }

  const resolution = resolutionBuilder({ localAssetId: configuration.exactBindings[0].localAssetId });
  return {
    resolution,
    plan: await input.localEnvironment.resolveEnvironmentPlan(resolution),
  };
}
