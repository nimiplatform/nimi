import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createNimiRuntimeAgentClient,
  Runtime,
  type NimiRuntimeAgentAIConfigIntents,
  type NimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigSnapshot,
  type NimiRuntimeAgentAIConfigReadinessSnapshotProjection,
  type RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence, ZhiyuExecutionCapabilityEvidence, ZhiyuAgentAIConfigReadinessState } from '../app/evidence';
import {
  createZhiyuRuntimeAgentBindingScopeRunner,
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
} from './runtime-agent-binding';

// Z-AUTH-006: Zhiyu is a pure projection + config-editor surface over the
// runtime-owned Runtime Agent AI Config (K-AGCORE-144~150). This module never
// probes, warms, caches, or re-derives route truth; every call is a typed
// pass-through over runtime.agent.ai_config.* behind the existing
// Runtime-issued scoped binding / admitted host-equivalence custody.
export const ZHIYU_AGENT_AI_CONFIG_READ_SCOPES = [
  'runtime.agent.ai_config.read',
] as const;
export const ZHIYU_AGENT_AI_CONFIG_WRITE_SCOPES = [
  'runtime.agent.ai_config.read',
  'runtime.agent.ai_config.write',
] as const;

export type ZhiyuRuntimeRouteStatus = ZhiyuEvidence['route'];

export type ZhiyuAgentAIConfigCallInput = RuntimeLocalAgentIdentityInput & {
  readonly subjectUserId: string;
};

export type ZhiyuAgentAIConfigUpsertInput = ZhiyuAgentAIConfigCallInput & {
  readonly expectedRevision: number;
  readonly intents: NimiRuntimeAgentAIConfigIntents;
};

export type ZhiyuAgentAIConfigRouteEvidenceInput = Partial<RuntimeLocalAgentIdentityInput> & {
  readonly subjectUserId: string;
};

export function getZhiyuAgentAIConfig(
  input: ZhiyuAgentAIConfigCallInput,
): Promise<NimiRuntimeAgentAIConfigSnapshot> {
  return zhiyuAgentAIConfigModule(input.subjectUserId).get(input);
}

export function upsertZhiyuAgentAIConfig(
  input: ZhiyuAgentAIConfigUpsertInput,
): Promise<NimiRuntimeAgentAIConfigSnapshot> {
  return zhiyuAgentAIConfigModule(input.subjectUserId, ZHIYU_AGENT_AI_CONFIG_WRITE_SCOPES).upsert(input);
}

export function getZhiyuAgentAIConfigReadiness(
  input: ZhiyuAgentAIConfigCallInput,
): Promise<NimiRuntimeAgentAIConfigReadinessSnapshotProjection> {
  return zhiyuAgentAIConfigModule(input.subjectUserId).readiness(input);
}

export function subscribeZhiyuAgentAIConfigReadiness(
  input: ZhiyuAgentAIConfigCallInput,
): AsyncIterable<NimiRuntimeAgentAIConfigReadinessSnapshotProjection> {
  return zhiyuAgentAIConfigModule(input.subjectUserId).subscribeReadiness(input);
}

// Startup + on-demand refresh: one committed-config read plus one readiness
// read; no probing, warming, or app-local readiness derivation.
export async function fetchZhiyuAgentAIConfigRouteEvidence(
  input: ZhiyuAgentAIConfigRouteEvidenceInput,
): Promise<ZhiyuRuntimeRouteStatus> {
  const subject = input.subjectUserId.trim();
  if (!subject) {
    return zhiyuAgentAIConfigRouteAuthRequired();
  }
  const identity = normalizeRouteIdentity(input);
  if (!identity) {
    return zhiyuAgentAIConfigRouteIdentityRequired();
  }
  const callInput = {
    subjectUserId: subject,
    ...identity,
  };
  try {
    const [config, readiness] = await Promise.all([
      getZhiyuAgentAIConfig(callInput),
      getZhiyuAgentAIConfigReadiness(callInput),
    ]);
    return projectZhiyuAgentAIConfigRouteEvidence({ config, readiness });
  } catch (error) {
    return zhiyuAgentAIConfigRouteUnavailable(error);
  }
}

export function projectZhiyuAgentAIConfigRouteEvidence(input: {
  readonly config: NimiRuntimeAgentAIConfigSnapshot;
  readonly readiness: NimiRuntimeAgentAIConfigReadinessSnapshotProjection;
}): ZhiyuRuntimeRouteStatus {
  const capabilities: Record<string, ZhiyuExecutionCapabilityEvidence> = {};
  for (const entry of input.readiness.capabilities) {
    capabilities[entry.capability] = {
      state: entry.state,
      reasonCode: entry.reasonCode,
      probedAt: entry.probedAt,
      binding: input.config.intents[entry.capability] ?? null,
    };
  }
  for (const [capability, binding] of Object.entries(input.config.intents)) {
    if (!capabilities[capability]) {
      capabilities[capability] = {
        state: 'unavailable',
        reasonCode: 'probe_failed',
        probedAt: null,
        binding,
      };
    }
  }
  const text = capabilities['text.generate'] ?? null;
  const textState: ZhiyuAgentAIConfigReadinessState = text?.state ?? 'not_configured';
  const ready = textState === 'ready';
  return {
    transport: 'electron-ipc',
    ready,
    capability: 'text.generate',
    configRevision: input.config.revision,
    readinessRevision: input.readiness.configRevision,
    updatedAt: input.config.updatedAt,
    updatedByAppId: input.config.updatedByAppId || null,
    capabilities,
    executionBinding: input.config.intents['text.generate'] ?? null,
    ...(ready
      ? {
        reasonCode: 'runtime-agent-ai-config-ready',
        actionHint: 'send_runtime_agent_turn',
        source: 'runtime',
        message: 'Runtime Agent AI Config projects text.generate as ready.',
      }
      : textState === 'not_configured'
        ? {
          reasonCode: 'zhiyu-agent-ai-config-not-configured',
          actionHint: 'configure_runtime_agent_ai_config',
          source: 'runtime',
          message: 'Runtime Agent AI Config has no ready text.generate intent yet.',
        }
        : {
          reasonCode: 'zhiyu-agent-ai-config-readiness-unavailable',
          actionHint: 'inspect_runtime_agent_ai_config_readiness',
          source: 'runtime',
          message: `Runtime Agent AI Config readiness reports text.generate as unavailable (${text?.reasonCode || 'unknown'}).`,
        }),
  };
}

export function zhiyuAgentAIConfigRouteBlocked(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
}): ZhiyuRuntimeRouteStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    capability: 'text.generate',
    configRevision: null,
    readinessRevision: null,
    updatedAt: null,
    updatedByAppId: null,
    capabilities: {},
    executionBinding: null,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
  };
}

export function zhiyuAgentAIConfigRouteAuthRequired(): ZhiyuRuntimeRouteStatus {
  return zhiyuAgentAIConfigRouteBlocked({
    reasonCode: 'zhiyu-agent-ai-config-auth-required',
    actionHint: 'sign_in_runtime_account',
    source: 'renderer',
    message: 'Runtime Agent AI Config requires an authenticated Runtime account.',
  });
}

export function zhiyuAgentAIConfigRouteIdentityRequired(): ZhiyuRuntimeRouteStatus {
  return zhiyuAgentAIConfigRouteBlocked({
    reasonCode: 'zhiyu-agent-ai-config-identity-required',
    actionHint: 'select_runtime_local_agent',
    source: 'renderer',
    message: 'Runtime Agent AI Config requires a selected Runtime Local Agent identity.',
  });
}

export function zhiyuAgentAIConfigRouteUnavailable(error: unknown): ZhiyuRuntimeRouteStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const cause = typeof record.reasonCode === 'string' && record.reasonCode.trim()
    ? record.reasonCode.trim()
    : 'unknown';
  const detail = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Runtime Agent AI Config projection failed.';
  return zhiyuAgentAIConfigRouteBlocked({
    reasonCode: 'zhiyu-agent-ai-config-unavailable',
    actionHint: 'check_runtime_agent_ai_config_surface',
    source: typeof record.source === 'string' && record.source.trim() ? record.source.trim() : 'runtime',
    message: `Runtime Agent AI Config is unavailable (${cause}). ${detail}`,
  });
}

function zhiyuAgentAIConfigModule(
  subjectUserId: string,
  requiredScopes: readonly string[] = ZHIYU_AGENT_AI_CONFIG_READ_SCOPES,
): NimiRuntimeAgentAIConfigModule {
  const subject = subjectUserId.trim();
  if (!subject) {
    throw Object.assign(new Error('Zhiyu Runtime Agent AI Config requires an authenticated subject user id.'), {
      reasonCode: 'zhiyu-agent-ai-config-auth-required',
      actionHint: 'sign_in_runtime_account',
      source: 'renderer',
    });
  }
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    throw Object.assign(new Error('Electron Runtime bridge is not available for the Runtime Agent AI Config.'), {
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
    });
  }
  // Fail closed before any RPC when the host custody does not cover the
  // AI Config scopes (Z-CHAT-002 scoped-binding custody path).
  const runtime = new Runtime({
    appId: 'nimi.zhiyu',
    transport: { type: 'electron-ipc' },
  });
  const client = createNimiRuntimeAgentClient({
    runtime,
    appId: 'nimi.zhiyu',
    getSubjectUserId: () => subject,
    withScopes: createZhiyuRuntimeAgentBindingScopeRunner(
      (scopes) => resolveZhiyuRuntimeAgentBindingDecisionFromHost(
        scopes.length > 0 ? scopes : requiredScopes,
      ),
    ),
  });
  return client.agentAIConfig;
}

function normalizeRouteIdentity(
  input: Partial<RuntimeLocalAgentIdentityInput>,
): RuntimeLocalAgentIdentityInput | null {
  const ownerUserId = typeof input.ownerUserId === 'string' ? input.ownerUserId.trim() : '';
  const runtimeSourceRef = typeof input.runtimeSourceRef === 'string' ? input.runtimeSourceRef.trim() : '';
  const localAgentRef = typeof input.localAgentRef === 'string' ? input.localAgentRef.trim() : '';
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
  };
}
