import type {
  RealmServiceArgs,
  RealmServiceMethod,
  RealmServiceName,
  RealmServiceResult,
} from '@nimiplatform/sdk/realm';
import type { TextGenerateInput, TextGenerateOutput } from '@nimiplatform/sdk/runtime/browser';
import { createStudioRealmClient } from '@renderer/data/realm-client.js';
import { createStudioRuntimeClient } from '@renderer/data/runtime-client.js';
import type { OwnerPortfolioAgentDetail } from './portfolio-data.js';
import {
  OWNER_SETTINGS_SAVE_SOURCE,
  SETTINGS_AI_PROPOSAL_SOURCE,
  buildRealmOwnerAgentSettingsUpdateInput,
  buildRuntimeOwnerSettingsProposalPrompt,
  normalizeRuntimeOwnerSettingsProposal,
  type OwnerAgentSettingsDraft,
  type RuntimeOwnerSettingsProposal,
} from './setting-proposal.js';

type StudioRealmMethod<
  Service extends RealmServiceName,
  Method extends RealmServiceMethod<Service>,
> = (...args: RealmServiceArgs<Service, Method>) => Promise<RealmServiceResult<Service, Method>>;

type StudioRealmClient = {
  services: {
    AgentsService: {
      agentControllerGetVisibility: StudioRealmMethod<'AgentsService', 'agentControllerGetVisibility'>;
      agentControllerUpdateVisibility: StudioRealmMethod<'AgentsService', 'agentControllerUpdateVisibility'>;
    };
    MeService: {
      getMyRealmAgentSettings: StudioRealmMethod<'MeService', 'getMyRealmAgentSettings'>;
      updateMyRealmAgentSettings: StudioRealmMethod<'MeService', 'updateMyRealmAgentSettings'>;
    };
    RuntimeProjectionsService: {
      projectRuntimePayload: StudioRealmMethod<'RuntimeProjectionsService', 'projectRuntimePayload'>;
    };
  };
};

type RuntimeTextClient = {
  ai: {
    text: {
      generate(input: TextGenerateInput): Promise<TextGenerateOutput>;
    };
  };
};

export type RealmAgentVisibilitySettings = RealmServiceResult<'AgentsService', 'agentControllerGetVisibility'>;
type RealmAgentVisibilityUpdateInput = RealmServiceArgs<'AgentsService', 'agentControllerUpdateVisibility'>[1];
export type RealmOwnerAgentSettings = RealmServiceResult<'MeService', 'getMyRealmAgentSettings'>;
type RealmOwnerAgentSettingsUpdateInput = RealmServiceArgs<'MeService', 'updateMyRealmAgentSettings'>[1];
type RealmRuntimeProjectionInput = RealmServiceArgs<'RuntimeProjectionsService', 'projectRuntimePayload'>[0];
type RealmRuntimeProjectionResponse = RealmServiceResult<'RuntimeProjectionsService', 'projectRuntimePayload'>;

export const REALM_RUNTIME_PROJECTION_SOURCE = 'Realm RuntimeProjectionsService.projectRuntimePayload';
export const REALM_AGENT_VISIBILITY_SOURCE = 'Realm AgentsService.agentControllerUpdateVisibility';
export const AGENT_VISIBILITY_VALUES = ['PUBLIC', 'FRIENDS', 'PRIVATE'] as const;
export const AGENT_VISIBILITY_FIELDS = [
  'accountVisibility',
  'defaultPostVisibility',
  'dmVisibility',
  'profileVisibility',
] as const;

export type RuntimeProjectionSummary = {
  source: typeof REALM_RUNTIME_PROJECTION_SOURCE;
  consumerSurface: 'RUNTIME_PAYLOAD';
  worldId: string;
  checksum: string;
  selectedInputCount: number;
  suppressedInputCount: number;
  worldRuleCount: number;
  rawRuleContentExposed: false;
};

export type RuntimeProjectionSummaryResult =
  | {
    ok: true;
    source: typeof REALM_RUNTIME_PROJECTION_SOURCE;
    truthWrite: false;
    summary: RuntimeProjectionSummary;
    submitted: RealmRuntimeProjectionInput;
  }
  | {
    ok: false;
    source: typeof REALM_RUNTIME_PROJECTION_SOURCE;
    truthWrite: false;
    failure:
      | 'runtime-projection-world-unavailable'
      | 'runtime-projection-failed'
      | 'runtime-projection-invalid-response';
    message: string;
    submitted: RealmRuntimeProjectionInput | null;
  };
export type AgentVisibilityValue = typeof AGENT_VISIBILITY_VALUES[number];
export type AgentVisibilityField = typeof AGENT_VISIBILITY_FIELDS[number];
export type AgentVisibilityDraft = Record<AgentVisibilityField, string>;

export type RealmAgentVisibilityUpdateResult =
  | {
    ok: true;
    source: typeof REALM_AGENT_VISIBILITY_SOURCE;
    lifecycleTruth: false;
    submitted: RealmAgentVisibilityUpdateInput;
    settings: RealmAgentVisibilitySettings;
  }
  | {
    ok: false;
    source: typeof REALM_AGENT_VISIBILITY_SOURCE;
    lifecycleTruth: false;
    failure: 'visibility-payload-invalid' | 'visibility-no-changes' | 'realm-update-visibility-failed';
    message: string;
    submitted: RealmAgentVisibilityUpdateInput | null;
    draft: AgentVisibilityDraft;
  };

export type RealmOwnerAgentSettingsUpdateResult =
  | {
    ok: true;
    source: typeof OWNER_SETTINGS_SAVE_SOURCE;
    truthWrite: true;
    submitted: RealmOwnerAgentSettingsUpdateInput;
    settings: RealmOwnerAgentSettings;
  }
  | {
    ok: false;
    source: typeof OWNER_SETTINGS_SAVE_SOURCE;
    truthWrite: false;
    failure: 'owner-settings-payload-invalid' | 'owner-settings-no-changes' | 'realm-update-owner-settings-failed';
    message: string;
    submitted: RealmOwnerAgentSettingsUpdateInput | null;
    draft: OwnerAgentSettingsDraft;
  };

export type RuntimeOwnerSettingsProposalResult =
  | {
    ok: true;
    source: typeof SETTINGS_AI_PROPOSAL_SOURCE;
    candidate: true;
    truthWrite: false;
    proposal: RuntimeOwnerSettingsProposal;
    submitted: TextGenerateInput;
    runtime: {
      traceId?: string;
      modelResolved?: string;
      finishReason?: string;
    };
  }
  | {
    ok: false;
    source: typeof SETTINGS_AI_PROPOSAL_SOURCE;
    candidate: false;
    truthWrite: false;
    failure:
      | 'runtime-settings-proposal-payload-invalid'
      | 'runtime-settings-proposal-transport-unavailable'
      | 'runtime-settings-proposal-failed'
      | 'runtime-settings-proposal-invalid-output';
    message: string;
    submitted: TextGenerateInput | null;
  };

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isAgentVisibilityValue(value: string): value is AgentVisibilityValue {
  return AGENT_VISIBILITY_VALUES.includes(value as AgentVisibilityValue);
}

export function createAgentVisibilityDraft(settings: RealmAgentVisibilitySettings): AgentVisibilityDraft {
  return {
    accountVisibility: settings.accountVisibility,
    defaultPostVisibility: settings.defaultPostVisibility,
    dmVisibility: settings.dmVisibility,
    profileVisibility: settings.profileVisibility,
  };
}

export function buildRealmUpdateVisibilityInput(
  draft: AgentVisibilityDraft,
  current: RealmAgentVisibilitySettings,
): { input: RealmAgentVisibilityUpdateInput | null; errors: string[] } {
  const input: RealmAgentVisibilityUpdateInput = {};
  const errors: string[] = [];

  for (const field of AGENT_VISIBILITY_FIELDS) {
    const value = draft[field];
    if (!isAgentVisibilityValue(value)) {
      errors.push(`${field} must be PUBLIC, FRIENDS, or PRIVATE`);
      continue;
    }
    if (value !== current[field]) {
      input[field] = value;
    }
  }

  if (errors.length > 0) {
    return { input: null, errors };
  }

  if (Object.keys(input).length === 0) {
    return { input: null, errors: ['visibility settings have no reviewed changes'] };
  }

  return { input, errors: [] };
}
export function buildRuntimeProjectionInput(agent: OwnerPortfolioAgentDetail): RealmRuntimeProjectionInput | null {
  if (agent.world.status !== 'available' || !agent.world.value.trim()) {
    return null;
  }

  return {
    worldId: agent.world.value.trim(),
    contextEnvelope: {
      allowedWorldScopes: ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'],
      includeInheritedAgentRules: false,
      focusKeywords: ['realm-agent-studio', 'owner-reviewed-runtime-context'],
    },
  };
}

export function normalizeRuntimeProjectionSummary(response: RealmRuntimeProjectionResponse): RuntimeProjectionSummary | null {
  if (!response || typeof response !== 'object') {
    return null;
  }
  const record = response as Record<string, unknown>;
  const consumerSurface = record.consumerSurface;
  const worldId = readOptionalString(record, 'worldId');
  const checksum = readOptionalString(record, 'checksum');
  if (consumerSurface !== 'RUNTIME_PAYLOAD' || !worldId || !checksum) {
    return null;
  }

  const payload = record.payload && typeof record.payload === 'object' ? record.payload as Record<string, unknown> : {};
  const trace = record.trace && typeof record.trace === 'object' ? record.trace as Record<string, unknown> : {};

  return {
    source: REALM_RUNTIME_PROJECTION_SOURCE,
    consumerSurface,
    worldId,
    checksum,
    selectedInputCount: readArray(record.selectedInputs).length,
    suppressedInputCount: readArray(trace.suppressedInputs).length,
    worldRuleCount: readArray(payload.worldRules).length,
    rawRuleContentExposed: false,
  };
}
export async function getAgentVisibilitySettings(
  agentId: string,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<RealmAgentVisibilitySettings> {
  return realm.services.AgentsService.agentControllerGetVisibility(agentId);
}

export async function getOwnerAgentSettings(
  agentId: string,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<RealmOwnerAgentSettings> {
  return realm.services.MeService.getMyRealmAgentSettings(agentId);
}

export async function updateReviewedAgentVisibility(
  agentId: string,
  draft: AgentVisibilityDraft,
  current: RealmAgentVisibilitySettings,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<RealmAgentVisibilityUpdateResult> {
  const { input, errors } = buildRealmUpdateVisibilityInput(draft, current);
  if (!input) {
    return {
      ok: false,
      source: REALM_AGENT_VISIBILITY_SOURCE,
      lifecycleTruth: false,
      failure: errors.some((error) => error.includes('no reviewed changes'))
        ? 'visibility-no-changes'
        : 'visibility-payload-invalid',
      message: errors.join('; ') || 'visibility payload invalid',
      submitted: null,
      draft,
    };
  }

  try {
    const settings = await realm.services.AgentsService.agentControllerUpdateVisibility(agentId, input);
    return {
      ok: true,
      source: REALM_AGENT_VISIBILITY_SOURCE,
      lifecycleTruth: false,
      submitted: input,
      settings,
    };
  } catch (error) {
    return {
      ok: false,
      source: REALM_AGENT_VISIBILITY_SOURCE,
      lifecycleTruth: false,
      failure: 'realm-update-visibility-failed',
      message: error instanceof Error ? error.message : 'Realm visibility update failed.',
      submitted: input,
      draft,
    };
  }
}

function resolveRuntimeSettingsProposalModel(): string {
  return String(
    import.meta.env.VITE_RUNTIME_SETTINGS_MODEL
    || import.meta.env.VITE_RUNTIME_TEXT_MODEL
    || '',
  ).trim();
}
export async function proposeReviewedOwnerAgentSettings(
  agentId: string,
  draft: OwnerAgentSettingsDraft,
  current: RealmOwnerAgentSettings,
  runtime?: RuntimeTextClient | null,
): Promise<RuntimeOwnerSettingsProposalResult> {
  const built = buildRuntimeOwnerSettingsProposalPrompt({
    agentId,
    draft,
    current,
    model: resolveRuntimeSettingsProposalModel(),
  });
  if (!built.ok) {
    return {
      ok: false,
      source: SETTINGS_AI_PROPOSAL_SOURCE,
      candidate: false,
      truthWrite: false,
      failure: 'runtime-settings-proposal-payload-invalid',
      message: built.errors.join('; ') || 'Runtime settings proposal payload invalid.',
      submitted: null,
    };
  }

  const runtimeClient = runtime === undefined ? await createStudioRuntimeClient() : runtime;
  if (!runtimeClient) {
    return {
      ok: false,
      source: SETTINGS_AI_PROPOSAL_SOURCE,
      candidate: false,
      truthWrite: false,
      failure: 'runtime-settings-proposal-transport-unavailable',
      message: 'Runtime runtime.ai.text.generate runtime transport unavailable: Tauri IPC runtime transport is required.',
      submitted: built.payload,
    };
  }

  try {
    const output = await runtimeClient.ai.text.generate(built.payload);
    try {
      const proposal = normalizeRuntimeOwnerSettingsProposal(output.text, draft);
      return {
        ok: true,
        source: SETTINGS_AI_PROPOSAL_SOURCE,
        candidate: true,
        truthWrite: false,
        proposal,
        submitted: built.payload,
        runtime: {
          ...(output.trace?.traceId ? { traceId: output.trace.traceId } : {}),
          ...(output.trace?.modelResolved ? { modelResolved: output.trace.modelResolved } : {}),
          ...(output.finishReason ? { finishReason: String(output.finishReason) } : {}),
        },
      };
    } catch (error) {
      return {
        ok: false,
        source: SETTINGS_AI_PROPOSAL_SOURCE,
        candidate: false,
        truthWrite: false,
        failure: 'runtime-settings-proposal-invalid-output',
        message: error instanceof Error ? error.message : 'Runtime settings proposal output invalid.',
        submitted: built.payload,
      };
    }
  } catch (error) {
    return {
      ok: false,
      source: SETTINGS_AI_PROPOSAL_SOURCE,
      candidate: false,
      truthWrite: false,
      failure: 'runtime-settings-proposal-failed',
      message: `Runtime runtime.ai.text.generate failed: ${error instanceof Error ? error.message : 'runtime transport call failed.'}`,
      submitted: built.payload,
    };
  }
}
export async function updateReviewedOwnerAgentSettings(
  agentId: string,
  draft: OwnerAgentSettingsDraft,
  current: RealmOwnerAgentSettings,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<RealmOwnerAgentSettingsUpdateResult> {
  const built = buildRealmOwnerAgentSettingsUpdateInput(draft, current);
  if (!built.ok) {
    return {
      ok: false,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      truthWrite: false,
      failure: built.failure === 'owner-settings-invalid' ? 'owner-settings-payload-invalid' : 'owner-settings-no-changes',
      message: built.errors.join('; ') || 'Owner settings payload invalid.',
      submitted: null,
      draft,
    };
  }

  const submitted = built.input as RealmOwnerAgentSettingsUpdateInput;
  try {
    const settings = await realm.services.MeService.updateMyRealmAgentSettings(agentId, submitted);
    return {
      ok: true,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      truthWrite: true,
      submitted,
      settings,
    };
  } catch (error) {
    return {
      ok: false,
      source: OWNER_SETTINGS_SAVE_SOURCE,
      truthWrite: false,
      failure: 'realm-update-owner-settings-failed',
      message: error instanceof Error ? error.message : 'Realm owner settings update failed.',
      submitted,
      draft,
    };
  }
}
export async function projectAgentRuntimeContextSummary(
  agent: OwnerPortfolioAgentDetail,
  realm: StudioRealmClient = createStudioRealmClient(),
): Promise<RuntimeProjectionSummaryResult> {
  const submitted = buildRuntimeProjectionInput(agent);
  if (!submitted) {
    return {
      ok: false,
      source: REALM_RUNTIME_PROJECTION_SOURCE,
      truthWrite: false,
      failure: 'runtime-projection-world-unavailable',
      message: 'Runtime projection requires worldId evidence from Realm MeService.getMyRealmAgent.',
      submitted: null,
    };
  }

  try {
    const response = await realm.services.RuntimeProjectionsService.projectRuntimePayload(submitted);
    const summary = normalizeRuntimeProjectionSummary(response);
    if (!summary) {
      return {
        ok: false,
        source: REALM_RUNTIME_PROJECTION_SOURCE,
        truthWrite: false,
        failure: 'runtime-projection-invalid-response',
        message: 'Runtime projection response did not include RUNTIME_PAYLOAD checksum summary.',
        submitted,
      };
    }
    return {
      ok: true,
      source: REALM_RUNTIME_PROJECTION_SOURCE,
      truthWrite: false,
      summary,
      submitted,
    };
  } catch (error) {
    return {
      ok: false,
      source: REALM_RUNTIME_PROJECTION_SOURCE,
      truthWrite: false,
      failure: 'runtime-projection-failed',
      message: error instanceof Error ? error.message : 'Realm runtime projection failed.',
      submitted,
    };
  }
}
