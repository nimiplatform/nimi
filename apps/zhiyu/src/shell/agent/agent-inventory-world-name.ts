export type ZhiyuInventoryWorldNameAgent = {
  readonly sourceKind: string | null;
  readonly sourceWorldId: string | null;
  readonly sourceWorldName: string | null;
};

export type ZhiyuInventoryWorldNameResolver = (worldId: string) => Promise<string | null>;

export async function hydrateZhiyuInventoryAgentWorldNames<TAgent extends ZhiyuInventoryWorldNameAgent>(
  agents: readonly TAgent[],
  resolveWorldName: ZhiyuInventoryWorldNameResolver,
): Promise<TAgent[]> {
  const worldIds = uniqueMissingWorldNameIds(agents);
  if (worldIds.length === 0) {
    return [...agents];
  }

  const worldNameById = new Map<string, string | null>();
  await Promise.all(worldIds.map(async (worldId) => {
    try {
      worldNameById.set(worldId, normalizedText(await resolveWorldName(worldId)) || null);
    } catch {
      worldNameById.set(worldId, null);
    }
  }));

  return agents.map((agent) => {
    const worldId = missingWorldNameId(agent);
    if (!worldId) {
      return agent;
    }
    const sourceWorldName = worldNameById.get(worldId);
    return sourceWorldName ? { ...agent, sourceWorldName } : agent;
  });
}

function uniqueMissingWorldNameIds(
  agents: readonly ZhiyuInventoryWorldNameAgent[],
): string[] {
  const ids = new Set<string>();
  for (const agent of agents) {
    const worldId = missingWorldNameId(agent);
    if (worldId) {
      ids.add(worldId);
    }
  }
  return [...ids];
}

function missingWorldNameId(agent: ZhiyuInventoryWorldNameAgent): string | null {
  if (agent.sourceKind !== 'worldCharacter' || normalizedText(agent.sourceWorldName)) {
    return null;
  }
  return normalizedText(agent.sourceWorldId);
}

function normalizedText(value: unknown): string {
  return String(value || '').trim();
}
