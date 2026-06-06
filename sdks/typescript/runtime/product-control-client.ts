import {
  parseNimiProductControlProjectionJson,
  parseNimiProductControlSelectedDataRootProjectionJson,
} from './product-control-projection';
import type {
  NimiProductControlRecordProjection,
  NimiProductControlSelectedDataRootProjection,
  NimiRuntimeProductControlAccountDefaultProfileEvidenceInput,
  NimiRuntimeProductControlCallOptions,
  NimiRuntimeProductControlClientFor,
  NimiRuntimeProductControlDataRootSelectionInput,
  NimiRuntimeProductControlFirstRunInstallLevelInput,
  NimiRuntimeProductControlFirstRunLocalAiReadyEvidenceInput,
  NimiRuntimeProductControlLocalClient,
  NimiRuntimeProductControlReadyForUseAdmissionInput,
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

export async function setNimiRuntimeProductControlFirstRunInstallLevel(
  client: NimiRuntimeProductControlClientFor<'setProductControlFirstRunInstallLevel'>,
  input: NimiRuntimeProductControlFirstRunInstallLevelInput,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .setProductControlFirstRunInstallLevel({
      installLevel: input.installLevel,
      aiProfileAlias: input.aiProfileAlias,
    }, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function completeNimiRuntimeProductControlFirstRunDeviceEnvironmentScan(
  client: NimiRuntimeProductControlClientFor<'completeProductControlFirstRunDeviceEnvironmentScan'>,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .completeProductControlFirstRunDeviceEnvironmentScan({}, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function admitNimiRuntimeProductControlReadyForUse(
  client: NimiRuntimeProductControlClientFor<'admitProductControlReadyForUse'>,
  input: NimiRuntimeProductControlReadyForUseAdmissionInput,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .admitProductControlReadyForUse({
      accountDefaultProfileEvidenceJson: input.accountDefaultProfileEvidenceJson,
      builtInAiConfigEvidenceJson: input.builtInAiConfigEvidenceJson,
    }, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function recordNimiRuntimeProductControlAccountDefaultProfileEvidence(
  client: NimiRuntimeProductControlClientFor<'recordProductControlAccountDefaultProfileEvidence'>,
  input: NimiRuntimeProductControlAccountDefaultProfileEvidenceInput,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .recordProductControlAccountDefaultProfileEvidence({
      accountDefaultProfileEvidenceJson: input.accountDefaultProfileEvidenceJson,
    }, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function recordNimiRuntimeProductControlFirstRunLocalAiReadyEvidence(
  client: NimiRuntimeProductControlClientFor<'recordProductControlFirstRunLocalAiReadyEvidence'>,
  input: NimiRuntimeProductControlFirstRunLocalAiReadyEvidenceInput,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .recordProductControlFirstRunLocalAiReadyEvidence({
      runtimeBaselineRef: input.runtimeBaselineRef,
      builtInAiConfigEvidenceJson: input.builtInAiConfigEvidenceJson,
      executionEvidenceRef: input.executionEvidenceRef,
    }, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}

export async function reconcileNimiRuntimeProductControlFirstRunSetupState(
  client: NimiRuntimeProductControlClientFor<'reconcileProductControlFirstRunSetupState'>,
  options?: NimiRuntimeProductControlCallOptions,
): Promise<NimiProductControlRecordProjection> {
  const response = await runtimeNimiProductControlLocalClient(client)
    .reconcileProductControlFirstRunSetupState({}, options?.callOptions);
  return parseNimiProductControlProjectionJson(response);
}
