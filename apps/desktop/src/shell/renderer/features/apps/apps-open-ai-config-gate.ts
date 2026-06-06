import type { NimiAICapabilityRequirementDeclaration } from '@nimiplatform/sdk/ai';
import type { NimiAppClient, NimiAppRow } from '@nimiplatform/sdk/app';
import { createNimiError, type JsonObject, type NimiError } from '@nimiplatform/sdk/types';
import {
  ensureAppFirstLaunchAIConfig,
  type EnsureAppFirstLaunchAIConfigInput,
} from '@renderer/app-shell/providers/desktop-ai-config-service.js';

export type DesktopAppsAIConfigEnsure = (
  input: EnsureAppFirstLaunchAIConfigInput,
) => ReturnType<typeof ensureAppFirstLaunchAIConfig>;

export interface DesktopAppsOpenAIConfigGateDeps {
  readonly appClient: NimiAppClient;
  readonly ensureAIConfig?: DesktopAppsAIConfigEnsure;
}

const appOpenAIConfigEnsureInFlight = new Map<string, Promise<void>>();

export async function ensureAppOpenAIConfig(
  appId: string,
  deps: DesktopAppsOpenAIConfigGateDeps,
): Promise<void> {
  const normalizedAppId = normalizeAppId(appId);
  const existing = appOpenAIConfigEnsureInFlight.get(normalizedAppId);
  if (existing) {
    return existing;
  }

  const promise = ensureAppOpenAIConfigOnce(normalizedAppId, deps);
  appOpenAIConfigEnsureInFlight.set(normalizedAppId, promise);
  try {
    await promise;
  } finally {
    appOpenAIConfigEnsureInFlight.delete(normalizedAppId);
  }
}

async function ensureAppOpenAIConfigOnce(
  appId: string,
  deps: DesktopAppsOpenAIConfigGateDeps,
): Promise<void> {
  if (!deps?.appClient) {
    throw appAIConfigGateError({
      reasonCode: 'SDK_APP_AI_CONFIG_INIT_AUTHORITY_MISSING',
      message: 'Desktop Apps open requires the Apps registry client before AIConfig initialization',
      actionHint: 'provide_desktop_apps_registry_client',
      details: { appId },
    });
  }

  const row = await deps.appClient.get(appId);
  const ensureAIConfig = deps.ensureAIConfig ?? ensureAppFirstLaunchAIConfig;
  const result = await ensureAIConfig({
    appId,
    recommendedProfileRef: row.aiProfileSelectionRef,
    requirementDeclarations: appAIConfigRequirementDeclarations(row),
  });

  if (result.outcome === 'setup-required-no-live-config') {
    throw setupRequiredError(row, result.profileId, result.profileSource, result.setupRepairPlan);
  }
  if (result.outcome === 'initialized' && result.setupRepairPlan) {
    throw setupRequiredError(row, result.profileId, result.profileSource, result.setupRepairPlan);
  }
}

export function appAIConfigRequirementDeclarations(
  row: Pick<NimiAppRow, 'appId' | 'capabilitySet'>,
): readonly NimiAICapabilityRequirementDeclaration[] {
  const appId = normalizeAppId(row.appId);
  const capabilities = normalizeCapabilitySet(row.capabilitySet, appId);
  return [{
    requirementId: `${appId}.app-launch.ai.requirements`,
    scopeRef: { kind: 'app', ownerId: appId },
    requiredSlices: capabilities.map((capability) => ({
      requirementSliceId: `${appId}.${capability}`,
      capability,
      profileSliceRef: `capabilities.${capability}`,
      readinessPolicy: 'required',
    })),
    setupProjectionPolicy: 'setup-required',
  }];
}

function normalizeAppId(appId: string): string {
  const normalized = String(appId || '').trim();
  if (!normalized) {
    throw appAIConfigGateError({
      reasonCode: 'SDK_APP_ID_REQUIRED',
      message: 'Desktop Apps open requires an appId before AIConfig initialization',
      actionHint: 'set_app_id',
    });
  }
  return normalized;
}

function normalizeCapabilitySet(capabilitySet: readonly string[], appId: string): readonly string[] {
  if (!Array.isArray(capabilitySet) || capabilitySet.length === 0) {
    throw appAIConfigGateError({
      reasonCode: 'SDK_APP_AI_CONFIG_REQUIREMENTS_MISSING',
      message: `Nimi App "${appId}" cannot open because its AI capability requirements are missing`,
      actionHint: 'fix_app_registry_capability_set_refs',
      details: { appId },
    });
  }
  const seen = new Set<string>();
  const capabilities: string[] = [];
  for (const value of capabilitySet) {
    const capability = String(value || '').trim();
    if (!capability) {
      throw appAIConfigGateError({
        reasonCode: 'SDK_APP_AI_CONFIG_REQUIREMENTS_MISSING',
        message: `Nimi App "${appId}" has an empty AI capability requirement`,
        actionHint: 'fix_app_registry_capability_set_refs',
        details: { appId },
      });
    }
    if (!seen.has(capability)) {
      seen.add(capability);
      capabilities.push(capability);
    }
  }
  return capabilities;
}

function setupRequiredError(
  row: NimiAppRow,
  profileId: string,
  profileSource: string,
  setupRepairPlan: {
    readonly unmetRequirements?: readonly { readonly requirementId: string; readonly detail: string }[];
    readonly setupProjection?: { readonly reasonCodes?: readonly string[] } | null;
  },
): NimiError {
  const reasonCodes = setupRepairPlan.setupProjection?.reasonCodes ?? [];
  const unmetRequirements = setupRepairPlan.unmetRequirements ?? [];
  const cause = reasonCodes.length > 0
    ? reasonCodes.join(', ')
    : unmetRequirements.map((gap) => `${gap.requirementId}:${gap.detail}`).join(', ');
  return appAIConfigGateError({
    reasonCode: 'SDK_APP_AI_CONFIG_SETUP_REQUIRED',
    message: `Nimi App "${row.appId}" requires AIProfile setup before open`,
    actionHint: 'open_app_ai_profile_repair_surface',
    details: {
      appId: row.appId,
      profileId,
      profileSource,
      cause: cause || 'setup-required',
    },
  });
}

function appAIConfigGateError(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
  readonly details?: JsonObject;
}): NimiError {
  return createNimiError({
    ...input,
    source: 'sdk',
  });
}
