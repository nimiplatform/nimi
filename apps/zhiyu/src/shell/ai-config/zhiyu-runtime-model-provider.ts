import {
  createNimiClientId,
} from '@nimiplatform/sdk';
import {
  createRuntimeRouteModelPickerProvider,
  createRuntimeRouteModelPickerProviderCache,
  type RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker/runtime';
import {
  NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS,
  createNimiHostRuntimeRouteAccessSurface,
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
  createNimiRuntimeRouteOptionsHostDeps,
  listNimiRuntimeRouteOptionsWithHost,
  withNimiRuntimeIdempotencyMetadata,
  type NimiListRuntimeRouteOptionsInput,
  type NimiRuntimeRouteCapabilityRuntime,
  type NimiRuntimeRouteOptionsHostRuntime,
  type NimiRuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/generated';
import {
  appId,
  getRuntimePlatformProjection,
  type RuntimePlatformReadyProjection,
} from '../auth/runtime-platform';

type ZhiyuRuntimeRouteOptionsHostClient = {
  readonly runtime: NimiRuntimeRouteOptionsHostRuntime;
};

async function loadZhiyuRuntimeRouteOptions(
  client: ZhiyuRuntimeRouteOptionsHostClient,
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  return listNimiRuntimeRouteOptionsWithHost(
    input,
    createNimiRuntimeRouteOptionsHostDeps(client.runtime, { scope: client }),
  );
}

async function readyProjection(): Promise<RuntimePlatformReadyProjection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message || 'Runtime unavailable; model picker failed closed.');
  }
  return projection;
}

async function loadZhiyuRuntimeRouteOptionsFromProjection(
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const projection = await readyProjection();
  return loadZhiyuRuntimeRouteOptions(projection.client, input);
}

export function createZhiyuRuntimeModelPickerProvider(
  capability: string,
): RouteModelPickerDataProvider {
  return createRuntimeRouteModelPickerProvider({
    capability,
    loadOptions: loadZhiyuRuntimeRouteOptionsFromProjection,
  });
}

export function createZhiyuRuntimeModelPickerProviderCache(): (
  capability: string,
) => RouteModelPickerDataProvider | null {
  return createRuntimeRouteModelPickerProviderCache({
    loadOptions: loadZhiyuRuntimeRouteOptionsFromProjection,
  });
}

export async function createZhiyuRuntimeRouteCapabilityRuntime(): Promise<NimiRuntimeRouteCapabilityRuntime | null> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return null;
  }
  const accountStatus = await projection.accountRuntime.account.getAccountSessionStatus({
    caller: projection.accountCaller,
  });
  const subjectUserId = accountStatus.state === AccountSessionState.AUTHENTICATED
    ? String(accountStatus.accountProjection?.accountId || '').trim()
    : '';
  const routeOptionsDeps = createNimiRuntimeRouteOptionsHostDeps(projection.client.runtime, {
    scope: projection.client,
  });
  const routeAccess = createNimiHostRuntimeRouteAccessSurface({
    appId,
    callerKind: 'first-party-app',
    surfaceId: 'zhiyu.agent-home.ai-config',
    callerIdPrefix: 'zhiyu-ai-config',
    identityMetadataMode: 'host',
    getRuntime: () => projection.client.runtime,
  });
  return createNimiRuntimeRouteCapabilityRuntimeWithHost({
    routeOptionsTargetId: 'zhiyu.agent-home.route-options',
    describeTargetId: 'zhiyu.agent-home.route-describe',
    describeTimeoutMs: NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS,
    loadRuntimeRouteOptions: (input) => listNimiRuntimeRouteOptionsWithHost(input, routeOptionsDeps),
    checkHealth: (input) => routeAccess.checkLocalHealth(input),
    buildDescribeCallOptions: async (input) => withNimiRuntimeIdempotencyMetadata(
      await routeAccess.buildCallOptions({
        targetId: input.targetId,
        timeoutMs: input.timeoutMs,
        source: input.source,
        connectorId: input.connectorId,
        providerEndpoint: input.providerEndpoint,
      }),
      createNimiClientId('zhiyu-route-describe'),
    ),
    getDescribeHost: () => ({
      appId,
      subjectUserId,
      executeScenario: (request, options) => projection.client.runtime.ai.executeScenario(request, options),
    }),
  });
}
