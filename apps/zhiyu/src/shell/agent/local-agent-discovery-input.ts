export type ZhiyuLocalAgentDiscoveryInput = {
  readonly ownerUserId?: unknown;
  readonly runtimeSourceRef?: unknown;
  readonly sourceRef?: {
    readonly kind?: unknown;
    readonly worldId?: unknown;
    readonly sourceId?: unknown;
    readonly sourceContentHash?: unknown;
  } | null;
};

export type ZhiyuLocalAgentDiscoveryProjection = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef?: string;
  readonly sourceRef: {
    readonly kind: string;
    readonly worldId: string;
    readonly sourceId: string;
    readonly sourceContentHash: string;
  };
};

export function normalizeZhiyuLocalAgentDiscoveryInput(
  input: ZhiyuLocalAgentDiscoveryInput,
): ZhiyuLocalAgentDiscoveryProjection | null {
  const ownerUserId = stringOr(input.ownerUserId, '');
  const runtimeSourceRef = stringOr(input.runtimeSourceRef, undefined);
  const sourceRef = input.sourceRef;
  const kind = stringOr(sourceRef?.kind, '');
  const worldId = stringOr(sourceRef?.worldId, '');
  const sourceId = stringOr(sourceRef?.sourceId, '');
  const sourceContentHash = stringOr(sourceRef?.sourceContentHash, '');
  if (!ownerUserId || !kind || !worldId || !sourceId || !sourceContentHash) {
    return null;
  }
  const projection = {
    ownerUserId,
    sourceRef: {
      kind,
      worldId,
      sourceId,
      sourceContentHash,
    },
  };
  return runtimeSourceRef ? { ...projection, runtimeSourceRef } : projection;
}

function stringOr(value: unknown, fallback: string): string;
function stringOr(value: unknown, fallback: undefined): string | undefined;
function stringOr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
