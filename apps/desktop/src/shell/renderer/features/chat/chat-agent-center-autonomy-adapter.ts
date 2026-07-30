import type {
  NimiRuntimeAgentAutonomyRevisionConflict,
  NimiRuntimeAgentInspectSurface,
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/sdk/runtime';
import type {
  AgentCenterAutonomyMutationInput,
  AgentCenterAutonomyProjection,
} from '@nimiplatform/kit/features/agent-center';

export class DesktopAgentAutonomyRevisionConflictError extends Error {
  readonly category = 'autonomy-revision-conflict' as const;
  readonly reasonCode = 'AGENT_AUTONOMY_REVISION_CONFLICT' as const;
  readonly actionHint = 'refresh_autonomy_snapshot' as const;
  readonly expectedRevision: string;

  constructor(conflict: NimiRuntimeAgentAutonomyRevisionConflict['conflict']) {
    super(conflict.message);
    this.name = 'DesktopAgentAutonomyRevisionConflictError';
    this.expectedRevision = conflict.expectedRevision;
  }
}

export function createDesktopAgentCenterAutonomyAdapter(
  inspect: Pick<NimiRuntimeAgentInspectSurface, 'getAutonomySnapshot' | 'updateAutonomy'>,
): {
  readonly load: (identity: RuntimeLocalAgentIdentityInput) => Promise<AgentCenterAutonomyProjection>;
  readonly update: (
    identity: RuntimeLocalAgentIdentityInput,
    mutation: AgentCenterAutonomyMutationInput,
  ) => Promise<AgentCenterAutonomyProjection>;
} {
  return {
    async load(identity) {
      return inspect.getAutonomySnapshot(identity);
    },
    async update(identity, mutation) {
      const result = await inspect.updateAutonomy({
        ...identity,
        expectedRevision: mutation.expectedRevision,
        ...(mutation.enabled === undefined ? {} : { enabled: mutation.enabled }),
        mode: mutation.mode,
        dailyTokenBudget: mutation.dailyTokenBudget,
        maxTokensPerHook: mutation.maxTokensPerHook,
      });
      if (result.outcome === 'conflict') {
        throw new DesktopAgentAutonomyRevisionConflictError(result.conflict);
      }
      return result.projection;
    },
  };
}
