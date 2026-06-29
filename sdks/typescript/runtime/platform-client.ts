import {
  createRuntime,
  type Runtime,
  type RuntimeOptions,
  type RuntimeTransportConfig,
} from './index';

export interface NimiRuntimePlatformClientAuthMetadataInput {
  readonly accountRuntime: Runtime;
}

export interface NimiRuntimePlatformClientInput {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly createRuntimeAuthMetadata?: (
    input: NimiRuntimePlatformClientAuthMetadataInput,
  ) => RuntimeOptions['authMetadata'];
}

export interface NimiRuntimePlatformClientDomains {
  readonly runtimeAdmin: Runtime;
}

export interface NimiRuntimePlatformClient {
  readonly runtime: Runtime;
  readonly accountRuntime: Runtime;
  readonly domains: NimiRuntimePlatformClientDomains;
}

export function createNimiRuntimePlatformClient(
  input: NimiRuntimePlatformClientInput,
): NimiRuntimePlatformClient {
  const accountRuntime = createRuntime({
    appId: input.appId,
    transport: input.transport,
  });
  const runtimeAuthMetadata = input.createRuntimeAuthMetadata?.({ accountRuntime });
  const runtime = createRuntime(
    runtimeAuthMetadata
      ? {
        appId: input.appId,
        transport: input.transport,
        authMetadata: runtimeAuthMetadata,
      }
      : {
        appId: input.appId,
        transport: input.transport,
      },
  );
  return {
    runtime,
    accountRuntime,
    domains: {
      runtimeAdmin: accountRuntime,
    },
  };
}
