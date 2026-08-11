import {
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION,
  resolveNimiRuntimeLocalQwen3ASREnvironmentPlan,
  resolveNimiRuntimeLocalQwen3TTSEnvironmentPlan,
  type NimiMachineLocalAIConfiguration,
  type NimiRuntimeLocalEnvironmentPlan,
} from '@nimiplatform/sdk/runtime';

type MachineConfigurationReader = {
  readonly get: () => Promise<NimiMachineLocalAIConfiguration>;
};

type LocalEnvironmentPlanReader = {
  readonly resolveEnvironmentPlan: Parameters<
    typeof resolveNimiRuntimeLocalQwen3ASREnvironmentPlan
  >[0]['runtime']['resolveEnvironmentPlan'];
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

async function resolveSelectedExactAssetId(input: {
  readonly machineConfiguration: MachineConfigurationReader;
  readonly capabilityContract: string;
  readonly expectedImplementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  };
  readonly errorPrefix: string;
}): Promise<string> {
  const aggregate = await input.machineConfiguration.get();
  const selection = aggregate.selections.find(
    (candidate) => candidate.capabilityContract === input.capabilityContract,
  );
  if (!selection) {
    throw new Error(`${input.errorPrefix}_SELECTION_NOT_FOUND`);
  }
  const configuration = aggregate.configurations.find(
    (candidate) => candidate.configurationId === selection.configurationId
      && candidate.capabilityContract === input.capabilityContract,
  );
  if (!configuration || !isExactImplementation(configuration.implementation, input.expectedImplementation)) {
    throw new Error(`${input.errorPrefix}_SELECTED_IMPLEMENTATION_UNSUPPORTED`);
  }
  if (configuration.exactBindings.length !== 1) {
    throw new Error(`${input.errorPrefix}_EXACT_BINDING_REQUIRED`);
  }
  const exactBinding = configuration.exactBindings[0];
  if (!exactBinding) {
    throw new Error(`${input.errorPrefix}_EXACT_BINDING_REQUIRED`);
  }
  return exactBinding.localAssetId;
}

export async function resolveRuntimeConfigLocalASREnvironmentPlan(input: {
  readonly machineConfiguration: MachineConfigurationReader;
  readonly localEnvironment: LocalEnvironmentPlanReader;
}): Promise<NimiRuntimeLocalEnvironmentPlan> {
  const localAssetId = await resolveSelectedExactAssetId({
    machineConfiguration: input.machineConfiguration,
    capabilityContract: NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
    expectedImplementation: NIMI_MACHINE_LOCAL_QWEN3_ASR_IMPLEMENTATION,
    errorPrefix: 'LOCAL_ASR',
  });

  return resolveNimiRuntimeLocalQwen3ASREnvironmentPlan({
    runtime: input.localEnvironment,
    asset: { localAssetId },
  });
}

export async function resolveRuntimeConfigLocalTTSEnvironmentPlan(input: {
  readonly machineConfiguration: MachineConfigurationReader;
  readonly localEnvironment: LocalEnvironmentPlanReader;
}): Promise<NimiRuntimeLocalEnvironmentPlan> {
  const localAssetId = await resolveSelectedExactAssetId({
    machineConfiguration: input.machineConfiguration,
    capabilityContract: NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
    expectedImplementation: NIMI_MACHINE_LOCAL_QWEN3_TTS_IMPLEMENTATION,
    errorPrefix: 'LOCAL_TTS',
  });

  return resolveNimiRuntimeLocalQwen3TTSEnvironmentPlan({
    runtime: input.localEnvironment,
    asset: { localAssetId },
  });
}
