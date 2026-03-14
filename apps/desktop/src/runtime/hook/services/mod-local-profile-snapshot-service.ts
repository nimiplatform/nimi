import type { HookModLocalProfileSnapshot, HookModLocalProfileSnapshotResolver } from '../contracts/facade.js';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { parseRuntimeCanonicalCapability } from "@nimiplatform/sdk/mod";
function toMissingProfileSnapshot(input: {
    modId: string;
    reasonCode: string;
    warning: string;
}): HookModLocalProfileSnapshot {
    return {
        modId: input.modId,
        status: 'missing',
        routeSource: 'cloud',
        reasonCode: input.reasonCode,
        warnings: [input.warning],
        entries: [],
        repairActions: [{
                actionId: 'runtime:open-setup',
                label: 'Open Runtime Setup',
                reasonCode: input.reasonCode,
            }],
        updatedAt: new Date().toISOString(),
    };
}
export class HookRuntimeModLocalProfileSnapshotService {
    private resolver: HookModLocalProfileSnapshotResolver | null = null;
    setResolver(resolver: HookModLocalProfileSnapshotResolver | null): void {
        this.resolver = resolver;
    }
    async getSnapshot(input: {
        modId: string;
        capability?: string;
        routeSourceHint?: 'cloud' | 'local';
    }): Promise<HookModLocalProfileSnapshot> {
        const modId = String(input.modId || '').trim();
        const capability = parseRuntimeCanonicalCapability(input.capability) || undefined;
        if (!modId) {
            return toMissingProfileSnapshot({
                modId: '',
                reasonCode: ReasonCode.LOCAL_AI_MOD_ID_REQUIRED,
                warning: 'modId required',
            });
        }
        if (!this.resolver) {
            return toMissingProfileSnapshot({
                modId,
                reasonCode: ReasonCode.LOCAL_AI_PROFILE_SNAPSHOT_RESOLVER_MISSING,
                warning: 'profile snapshot resolver unavailable',
            });
        }
        return this.resolver({
            modId,
            capability,
            routeSourceHint: input.routeSourceHint,
        });
    }
}
