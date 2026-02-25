import type {
  HookModAiDependencySnapshot,
  HookModAiDependencySnapshotResolver,
} from '../contracts/facade.js';

function toMissingDependencySnapshot(input: {
  modId: string;
  reasonCode: string;
  warning: string;
}): HookModAiDependencySnapshot {
  return {
    modId: input.modId,
    status: 'missing',
    routeSource: 'token-api',
    reasonCode: input.reasonCode,
    warnings: [input.warning],
    dependencies: [],
    repairActions: [{
      actionId: 'runtime:open-setup',
      label: 'Open Runtime Setup',
      reasonCode: input.reasonCode,
    }],
    updatedAt: new Date().toISOString(),
  };
}

export class HookRuntimeModAiDependencySnapshotService {
  private resolver: HookModAiDependencySnapshotResolver | null = null;

  setResolver(resolver: HookModAiDependencySnapshotResolver | null): void {
    this.resolver = resolver;
  }

  async getSnapshot(input: {
    modId: string;
    capability?: string;
    routeSourceHint?: 'token-api' | 'local-runtime';
  }): Promise<HookModAiDependencySnapshot> {
    const modId = String(input.modId || '').trim();
    if (!modId) {
      return toMissingDependencySnapshot({
        modId: '',
        reasonCode: 'LOCAL_AI_MOD_ID_REQUIRED',
        warning: 'modId required',
      });
    }
    if (!this.resolver) {
      return toMissingDependencySnapshot({
        modId,
        reasonCode: 'LOCAL_AI_DEPENDENCY_SNAPSHOT_RESOLVER_MISSING',
        warning: 'dependency snapshot resolver unavailable',
      });
    }
    return this.resolver({
      modId,
      capability: String(input.capability || '').trim() || undefined,
      routeSourceHint: input.routeSourceHint,
    });
  }
}
