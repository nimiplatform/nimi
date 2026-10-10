import { buildNimiRuntimeScenarioJobIdentity, createNimiError, ReasonCode } from '@nimiplatform/kit/core/sdk-contract';

export type RuntimeGenerationScenarioIdentity = {
  readonly requestId: string;
  readonly idempotencyKey: string;
};

export type RuntimeGenerationScenarioIdentityInput = {
  readonly appId: string;
  readonly capabilityId: string;
  readonly scenarioId: string;
};

export function buildRuntimeGenerationScenarioIdentity(
  input: RuntimeGenerationScenarioIdentityInput,
): RuntimeGenerationScenarioIdentity {
  return buildNimiRuntimeScenarioJobIdentity(input);
}

export function rejectJobBusinessTimeout(input: object): void {
  if ('timeoutMs' in input) throw createNimiError({ message: 'Job business timeout is no longer supported', reasonCode: ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED, actionHint: 'remove_job_business_timeout', source: 'sdk' });
}
