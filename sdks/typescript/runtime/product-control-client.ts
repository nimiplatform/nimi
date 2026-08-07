import {
  parseNimiProductControlProjectionJson,
  parseNimiProductControlSelectedDataRootProjectionJson,
} from './product-control-projection';
import type {
  NimiProductControlRecordProjection,
  NimiProductControlSelectedDataRootProjection,
  NimiRuntimeProductControlCallOptions,
  NimiRuntimeProductControlClientFor,
  NimiRuntimeProductControlDataRootSelectionInput,
  NimiRuntimeProductControlLocalClient,
} from './product-control-types';

function runtimeNimiProductControlLocalClient<Method extends keyof NimiRuntimeProductControlLocalClient>(
  client: NimiRuntimeProductControlClientFor<Method>,
): Pick<NimiRuntimeProductControlLocalClient, Method> {
  if ('local' in client) {
    return client.local;
  }
  return client;
}

export async function getNimiRuntimeProductControlRecord(
  client: NimiRuntimeProductControlClientFor<'getProductControlRecord'>,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .getProductControlRecord({}, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function getNimiRuntimeProductControlSelectedDataRoot(
  client: NimiRuntimeProductControlClientFor<'getProductControlSelectedDataRoot'>,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlSelectedDataRootProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .getProductControlSelectedDataRoot({}, options?.callOptions);
  return parseNimiProductControlSelectedDataRootProjectionJson(response);
}

export async function ensureNimiRuntimeProductControlRecordCreated(
  client: NimiRuntimeProductControlClientFor<'ensureProductControlRecordCreated'>,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .ensureProductControlRecordCreated({}, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function selectNimiRuntimeProductControlDataRoot(
  client: NimiRuntimeProductControlClientFor<'selectProductControlDataRoot'>,
  input: NimiRuntimeProductControlDataRootSelectionInput,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .selectProductControlDataRoot({ dataRoot: input.dataRoot }, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function admitNimiRuntimeProductControlReadyForUse(
  client: NimiRuntimeProductControlClientFor<'admitProductControlReadyForUse'>,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .admitProductControlReadyForUse({}, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}
