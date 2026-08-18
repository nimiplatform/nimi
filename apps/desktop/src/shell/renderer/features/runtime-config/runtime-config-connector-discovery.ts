import type { RuntimeConfigStatusV11, RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { GetRuntimeHealthResponse } from '@nimiplatform/sdk/runtime/wire-types';
import {
  projectNimiRuntimeHealthSummary,
} from '@nimiplatform/sdk/runtime';
import { asNimiError } from '@nimiplatform/sdk/types';
import { NIMI_RUNTIME_REASON_CODES } from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigConnectorSdkService } from './runtime-config-connector-sdk-service';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

type HealthResult = {
  status: 'healthy' | 'degraded' | 'unreachable' | 'unsupported';
  detail: string;
  checkedAt: string;
};

export function normalizeRuntimeHealthResult(result: GetRuntimeHealthResponse): {
  health: HealthResult;
  normalizedStatus: RuntimeConfigStatusV11;
} {
  const projection = projectNimiRuntimeHealthSummary(result);
  const normalizedStatus = projection.normalizedStatus as RuntimeConfigStatusV11;
  return {
    health: projection.health,
    normalizedStatus,
  };
}

export async function checkLocalHealth(sdk: DesktopRendererSdkPort): Promise<{
  health: HealthResult;
  normalizedStatus: RuntimeConfigStatusV11;
}> {
  try {
    const snapshot = await sdk.runtimeHealthCoordinator().forceRefresh('local-health-check');
    if (!snapshot.runtimeHealth) {
      throw new Error(snapshot.error || snapshot.streamError || 'runtime health unavailable');
    }
    return normalizeRuntimeHealthResult(snapshot.runtimeHealth);
  } catch (error) {
    throw asNimiError(error, {
      reasonCode: NIMI_RUNTIME_REASON_CODES.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_health',
      source: 'runtime',
    });
  }
}

export async function discoverConnectorModelsAndHealth(input: {
  connector: RuntimeConfigStateV11['connectors'][number];
  connectorSdk: RuntimeConfigConnectorSdkService;
  now: () => number;
}): Promise<{
  endpoint: string;
  discovered: string[];
  modelCapabilities: Record<string, string[]>;
  health: HealthResult;
  normalizedStatus: RuntimeConfigStatusV11;
}> {
  const endpoint = input.connector.endpoint;
  await input.connectorSdk.sdkTestConnector(input.connector.id);
  const descriptors = await input.connectorSdk.sdkListConnectorModelDescriptors(
    input.connector.id,
    true,
  );
  const discovered = descriptors.map((d) => d.providerModelId);
  const modelCapabilities: Record<string, string[]> = {};
  for (const d of descriptors) {
    if (d.capabilities.length > 0) {
      modelCapabilities[d.providerModelId] = [...d.capabilities];
    }
  }
  return {
    endpoint,
    discovered,
    modelCapabilities,
    health: {
      status: 'healthy',
      detail: '',
      checkedAt: new Date(input.now()).toISOString(),
    },
    normalizedStatus: 'healthy',
  };
}
