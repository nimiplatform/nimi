import type {
  HookModAiDependencySnapshot,
  HookModAiDependencySnapshotResolver,
} from '../contracts/facade.js';
import { parseRuntimeCanonicalCapability } from '@nimiplatform/sdk/mod/runtime-route';
import { ReasonCode } from '@nimiplatform/sdk/types';

function toMissingDependencySnapshot(input: {
  modId: string;
  reasonCode: string;
  warning: string;
}): HookModAiDependencySnapshot {
  return {
    modId: input.modId,
    status: 'missing',
    routeSource: 'cloud',
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
    routeSourceHint?: 'cloud' | 'local';
  }): Promise<HookModAiDependencySnapshot> {
    const modId = String(input.modId || '').trim();
    const capability = parseRuntimeCanonicalCapability(input.capability) || undefined;
    if (!modId) {
      return toMissingDependencySnapshot({
        modId: '',
        reasonCode: ReasonCode.LOCAL_AI_MOD_ID_REQUIRED,
        warning: 'modId required',
      });
    }
    if (!this.resolver) {
      return toMissingDependencySnapshot({
        modId,
        reasonCode: ReasonCode.LOCAL_AI_DEPENDENCY_SNAPSHOT_RESOLVER_MISSING,
        warning: 'dependency snapshot resolver unavailable',
      });
    }
    return this.resolver({
      modId,
      capability,
      routeSourceHint: input.routeSourceHint,
    });
  }
}
