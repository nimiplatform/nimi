import { hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  createNimiRuntimeAgentClient,
  Runtime,
  type NimiRuntimeAgentExecutionConfigBindings,
  type NimiRuntimeAgentExecutionConfigModule,
  type NimiRuntimeAgentExecutionConfigSnapshot,
  type NimiRuntimeAgentExecutionReadinessSnapshotProjection,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence, ZhiyuExecutionCapabilityEvidence, ZhiyuExecutionReadinessState } from '../app/evidence';
import {
  createZhiyuRuntimeAgentBindingScopeRunner,
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
} from './runtime-agent-binding';

// Z-AUTH-006: Zhiyu is a pure projection + config-editor surface over the
// runtime-owned agent execution config (K-AGCORE-144~150). This module never
// probes, warms, caches, or re-derives route truth; every call is a typed
// pass-through over runtime.agent.executionConfig.* behind the existing
// Runtime-issued scoped binding / admitted host-equivalence custody.
export const ZHIYU_EXECUTION_CONFIG_READ_SCOPES = [
  'runtime.agent.execution_config.read',
] as const;
export const ZHIYU_EXECUTION_CONFIG_WRITE_SCOPES = [
  'runtime.agent.execution_config.read',
  'runtime.agent.execution_config.write',
] as const;

export type ZhiyuRuntimeRouteStatus = ZhiyuEvidence['route'];

export type ZhiyuAgentExecutionConfigCallInput = {
  readonly subjectUserId: string;
};

export type ZhiyuAgentExecutionConfigUpsertInput = ZhiyuAgentExecutionConfigCallInput & {
  readonly expectedRevision: number;
  readonly bindings: NimiRuntimeAgentExecutionConfigBindings;
};

export function getZhiyuAgentExecutionConfig(
  input: ZhiyuAgentExecutionConfigCallInput,
): Promise<NimiRuntimeAgentExecutionConfigSnapshot> {
  return zhiyuAgentExecutionConfigModule(input.subjectUserId).get();
}

export function upsertZhiyuAgentExecutionConfig(
  input: ZhiyuAgentExecutionConfigUpsertInput,
): Promise<NimiRuntimeAgentExecutionConfigSnapshot> {
  return zhiyuAgentExecutionConfigModule(input.subjectUserId, ZHIYU_EXECUTION_CONFIG_WRITE_SCOPES).upsert({
    expectedRevision: input.expectedRevision,
    bindings: input.bindings,
  });
}

export function getZhiyuAgentExecutionReadiness(
  input: ZhiyuAgentExecutionConfigCallInput,
): Promise<NimiRuntimeAgentExecutionReadinessSnapshotProjection> {
  return zhiyuAgentExecutionConfigModule(input.subjectUserId).readiness();
}

export function subscribeZhiyuAgentExecutionReadiness(
  input: ZhiyuAgentExecutionConfigCallInput,
): AsyncIterable<NimiRuntimeAgentExecutionReadinessSnapshotProjection> {
  return zhiyuAgentExecutionConfigModule(input.subjectUserId).subscribeReadiness();
}

// Startup + on-demand refresh: one committed-config read plus one readiness
// read; no probing, warming, or app-local readiness derivation.
export async function fetchZhiyuAgentExecutionRouteEvidence(
  subjectUserId: string,
): Promise<ZhiyuRuntimeRouteStatus> {
  const subject = subjectUserId.trim();
  if (!subject) {
    return zhiyuAgentExecutionRouteAuthRequired();
  }
  try {
    const [config, readiness] = await Promise.all([
      getZhiyuAgentExecutionConfig({ subjectUserId: subject }),
      getZhiyuAgentExecutionReadiness({ subjectUserId: subject }),
    ]);
    return projectZhiyuAgentExecutionRouteEvidence({ config, readiness });
  } catch (error) {
    return zhiyuAgentExecutionRouteUnavailable(error);
  }
}

export function projectZhiyuAgentExecutionRouteEvidence(input: {
  readonly config: NimiRuntimeAgentExecutionConfigSnapshot;
  readonly readiness: NimiRuntimeAgentExecutionReadinessSnapshotProjection;
}): ZhiyuRuntimeRouteStatus {
  const capabilities: Record<string, ZhiyuExecutionCapabilityEvidence> = {};
  for (const entry of input.readiness.capabilities) {
    capabilities[entry.capability] = {
      state: entry.state,
      reasonCode: entry.reasonCode,
      probedAt: entry.probedAt,
      binding: input.config.bindings[entry.capability] ?? null,
    };
  }
  for (const [capability, binding] of Object.entries(input.config.bindings)) {
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
  const textState: ZhiyuExecutionReadinessState = text?.state ?? 'not_configured';
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
    executionBinding: input.config.bindings['text.generate'] ?? null,
    ...(ready
      ? {
        reasonCode: 'runtime-execution-config-ready',
        actionHint: 'send_runtime_agent_turn',
        source: 'runtime',
        message: 'Runtime agent execution config projects text.generate as ready.',
      }
      : textState === 'not_configured'
        ? {
          reasonCode: 'zhiyu-agent-execution-config-not-configured',
          actionHint: 'configure_runtime_agent_execution_model',
          source: 'runtime',
          message: 'Runtime agent execution config has no ready text.generate binding yet.',
        }
        : {
          reasonCode: 'zhiyu-agent-execution-readiness-unavailable',
          actionHint: 'inspect_runtime_agent_execution_readiness',
          source: 'runtime',
          message: `Runtime agent execution readiness reports text.generate as unavailable (${text?.reasonCode || 'unknown'}).`,
        }),
  };
}

export function zhiyuAgentExecutionRouteBlocked(input: {
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

export function zhiyuAgentExecutionRouteAuthRequired(): ZhiyuRuntimeRouteStatus {
  return zhiyuAgentExecutionRouteBlocked({
    reasonCode: 'zhiyu-agent-execution-config-auth-required',
    actionHint: 'sign_in_runtime_account',
    source: 'renderer',
    message: 'Runtime agent execution config requires an authenticated Runtime account.',
  });
}

export function zhiyuAgentExecutionRouteUnavailable(error: unknown): ZhiyuRuntimeRouteStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const cause = typeof record.reasonCode === 'string' && record.reasonCode.trim()
    ? record.reasonCode.trim()
    : 'unknown';
  const detail = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'Runtime agent execution config projection failed.';
  return zhiyuAgentExecutionRouteBlocked({
    reasonCode: 'zhiyu-agent-execution-config-unavailable',
    actionHint: 'check_runtime_agent_execution_config_surface',
    source: typeof record.source === 'string' && record.source.trim() ? record.source.trim() : 'runtime',
    message: `Runtime agent execution config is unavailable (${cause}). ${detail}`,
  });
}

function zhiyuAgentExecutionConfigModule(
  subjectUserId: string,
  requiredScopes: readonly string[] = ZHIYU_EXECUTION_CONFIG_READ_SCOPES,
): NimiRuntimeAgentExecutionConfigModule {
  const subject = subjectUserId.trim();
  if (!subject) {
    throw Object.assign(new Error('Zhiyu runtime agent execution config requires an authenticated subject user id.'), {
      reasonCode: 'zhiyu-agent-execution-config-auth-required',
      actionHint: 'sign_in_runtime_account',
      source: 'renderer',
    });
  }
  if (typeof window === 'undefined' || !hasElectronRuntime()) {
    throw Object.assign(new Error('Electron Runtime bridge is not available for the runtime agent execution config.'), {
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
    });
  }
  // Fail closed before any RPC when the host custody does not cover the
  // execution config scopes (Z-CHAT-002 scoped-binding custody path).
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
  return client.executionConfig;
}
