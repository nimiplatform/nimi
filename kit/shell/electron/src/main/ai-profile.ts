import { resolveNimiFactoryAiProfileAlias } from '@nimiplatform/kit/shell/capabilities';
import { NimiElectronShellHostError } from './types.js';
import { normalizeText } from './paths.js';

export function resolveElectronAiProfile(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Record<string, unknown> {
  const alias = normalizeText(payload.alias ?? payload.profileAlias ?? payload.aiProfileAlias);
  const row = resolveNimiFactoryAiProfileAlias(alias);
  if (!row) {
    throw new NimiElectronShellHostError({
      code: 'not-found',
      message: `Electron AI Profile alias was not found in the Platform factory catalog: ${alias || '<missing>'}`,
      reasonCode: 'electron-ai-profile-alias-not-found',
      actionHint: 'use_admitted_platform_factory_ai_profile_alias',
      details: { command, alias },
    });
  }
  return {
    alias: row.alias,
    privacyPosture: row.privacyPosture,
    computePosture: row.computePosture,
    capabilitySet: [...row.capabilitySet],
    routingPolicy: row.routingPolicy,
    hostCapabilityProfileRefs: [...row.hostCapabilityProfileRefs],
    localComputePackRefs: [...row.localComputePackRefs],
    dependencyFamilyRefs: [...row.dependencyFamilyRefs],
    materializationConfirmationRequired: row.materializationConfirmationRequired,
    applicableScopes: [...row.applicableScopes],
    firstRunInstallLevels: [...row.firstRunInstallLevels],
    sourceRule: row.sourceRule,
  };
}
