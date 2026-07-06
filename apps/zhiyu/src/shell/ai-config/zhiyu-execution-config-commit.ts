import type {
  SharedAIConfigService,
} from '@nimiplatform/kit/features/model-config/headless';
import type {
  NimiAIConfig,
  NimiAIConfigTargetRef,
  NimiAIScopeRef,
} from '@nimiplatform/sdk/ai';
import type {
  NimiRuntimeAgentExecutionBinding,
  NimiRuntimeAgentExecutionConfigBindings,
  NimiRuntimeAgentExecutionConfigSnapshot,
} from '@nimiplatform/sdk/runtime';

// Z-AUTH-006: the Agent Center model tab commits text.generate and
// image.generate selections into the runtime-owned agent execution config
// (runtime.agent.executionConfig.upsert). The AIConfig facade stays the
// commit target for every other capability and remains the picker's
// listing/selection display store only — it is never route truth.
export const ZHIYU_EXECUTION_CONFIG_MANAGED_CAPABILITIES = [
  'text.generate',
  'image.generate',
] as const;

export type ZhiyuExecutionConfigManagedCapability =
  (typeof ZHIYU_EXECUTION_CONFIG_MANAGED_CAPABILITIES)[number];

export type ZhiyuExecutionConfigCommitState =
  | { readonly status: 'idle' }
  | {
    readonly status: 'committing';
    readonly capabilities: readonly ZhiyuExecutionConfigManagedCapability[];
  }
  | {
    readonly status: 'committed';
    readonly capabilities: readonly ZhiyuExecutionConfigManagedCapability[];
    readonly revision: number;
  }
  | {
    readonly status: 'conflict';
    readonly capabilities: readonly ZhiyuExecutionConfigManagedCapability[];
    readonly reasonCode: 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION';
    readonly committedRevision: number | null;
    readonly message: string;
  }
  | {
    readonly status: 'failed';
    readonly capabilities: readonly ZhiyuExecutionConfigManagedCapability[];
    readonly reasonCode: string;
    readonly message: string;
  };

export type ZhiyuExecutionConfigCommitDeps = {
  readonly base: SharedAIConfigService;
  readonly getSubjectUserId: () => string;
  readonly getCommittedConfig: (input: {
    readonly subjectUserId: string;
  }) => Promise<NimiRuntimeAgentExecutionConfigSnapshot>;
  readonly upsertConfig: (input: {
    readonly subjectUserId: string;
    readonly expectedRevision: number;
    readonly bindings: NimiRuntimeAgentExecutionConfigBindings;
  }) => Promise<NimiRuntimeAgentExecutionConfigSnapshot>;
  readonly buildBindingForTargetRef: (
    capability: ZhiyuExecutionConfigManagedCapability,
    targetRef: NimiAIConfigTargetRef,
  ) => Promise<NimiRuntimeAgentExecutionBinding>;
  readonly onCommitState: (state: ZhiyuExecutionConfigCommitState) => void;
};

export type ZhiyuExecutionConfigCommitService = SharedAIConfigService & {
  readonly flushExecutionConfigCommits: () => Promise<void>;
};

export function createZhiyuExecutionConfigCommitService(
  deps: ZhiyuExecutionConfigCommitDeps,
): ZhiyuExecutionConfigCommitService {
  let pending: Promise<void> = Promise.resolve();

  const commitManaged = async (
    scopeRef: NimiAIScopeRef,
    next: NimiAIConfig,
    changed: readonly ZhiyuExecutionConfigManagedCapability[],
  ): Promise<void> => {
    deps.onCommitState({ status: 'committing', capabilities: changed });
    try {
      const subjectUserId = deps.getSubjectUserId().trim();
      if (!subjectUserId) {
        deps.onCommitState({
          status: 'failed',
          capabilities: changed,
          reasonCode: 'zhiyu-agent-execution-config-auth-required',
          message: 'Runtime agent execution config commit requires an authenticated Runtime account.',
        });
        return;
      }
      const committed = await deps.getCommittedConfig({ subjectUserId });
      const bindings: Record<string, NimiRuntimeAgentExecutionBinding> = { ...committed.bindings };
      for (const capability of changed) {
        const targetRef = next.capabilities.targetRefs[capability] ?? null;
        if (!targetRef) {
          delete bindings[capability];
          continue;
        }
        bindings[capability] = await deps.buildBindingForTargetRef(capability, targetRef);
      }
      if (!bindings['text.generate']) {
        deps.onCommitState({
          status: 'failed',
          capabilities: changed,
          reasonCode: 'zhiyu-execution-config-text-binding-required',
          message: 'The runtime agent execution config must retain a text.generate binding; select the text model first.',
        });
        return;
      }
      const upserted = await deps.upsertConfig({
        subjectUserId,
        expectedRevision: committed.revision,
        bindings,
      });
      // Mirror the picker selection into the AIConfig display store only
      // after the runtime commit succeeded (never on failure).
      deps.base.aiConfig.update(scopeRef, next);
      deps.onCommitState({
        status: 'committed',
        capabilities: changed,
        revision: upserted.revision,
      });
    } catch (error) {
      if (isExecutionConfigConflict(error)) {
        const committedRevision = await deps.getCommittedConfig({
          subjectUserId: deps.getSubjectUserId().trim(),
        }).then((snapshot) => snapshot.revision).catch(() => null);
        deps.onCommitState({
          status: 'conflict',
          capabilities: changed,
          reasonCode: 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION',
          committedRevision,
          message: errorMessage(error, 'Runtime agent execution config was modified concurrently.'),
        });
        return;
      }
      deps.onCommitState({
        status: 'failed',
        capabilities: changed,
        reasonCode: errorReasonCode(error),
        message: errorMessage(error, 'Runtime agent execution config commit failed.'),
      });
    }
  };

  return {
    aiConfig: {
      get: (scopeRef) => deps.base.aiConfig.get(scopeRef),
      subscribe: (scopeRef, listener) => deps.base.aiConfig.subscribe(scopeRef, listener),
      update: (scopeRef, next) => {
        const current = deps.base.aiConfig.get(scopeRef);
        const changed = changedManagedCapabilities(current, next);
        if (changed.length === 0) {
          deps.base.aiConfig.update(scopeRef, next);
          return;
        }
        pending = pending.then(() => commitManaged(scopeRef, next, changed));
      },
    },
    aiProfile: deps.base.aiProfile,
    flushExecutionConfigCommits: () => pending,
  };
}

function changedManagedCapabilities(
  current: NimiAIConfig,
  next: NimiAIConfig,
): readonly ZhiyuExecutionConfigManagedCapability[] {
  return ZHIYU_EXECUTION_CONFIG_MANAGED_CAPABILITIES.filter((capability) => (
    targetRefKey(current.capabilities.targetRefs[capability])
      !== targetRefKey(next.capabilities.targetRefs[capability])
  ));
}

function targetRefKey(targetRef: NimiAIConfigTargetRef | null | undefined): string {
  if (!targetRef) {
    return '';
  }
  const record = targetRef as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key]]));
}

function isExecutionConfigConflict(error: unknown): boolean {
  return errorReasonCode(error) === 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION';
}

function errorReasonCode(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return typeof record.reasonCode === 'string' && record.reasonCode.trim()
    ? record.reasonCode.trim()
    : 'zhiyu-execution-config-commit-failed';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}
