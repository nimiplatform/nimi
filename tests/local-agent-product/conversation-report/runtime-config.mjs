export async function commitConversationReportRoute({ agentClient, identity, route }) {
  const current = await agentClient.agentAIConfig.get(identity);
  const committed = await agentClient.agentAIConfig.upsert({
    ...identity,
    expectedRevision: current.revision,
    intents: {
      ...current.intents,
      'text.generate': {
        route: 'cloud',
        modelId: route.executionBinding.modelId,
        connectorId: route.executionBinding.connectorId,
        targetRef: route.targetRef,
      },
    },
  });
  const readiness = await agentClient.agentAIConfig.readiness(identity);
  const textReadiness = readiness.capabilities.find((capability) => capability.capability === 'text.generate');
  if (committed.intents['text.generate']?.route !== 'cloud'
    || committed.intents['text.generate']?.modelId !== route.executionBinding.modelId
    || committed.intents['text.generate']?.connectorId !== route.executionBinding.connectorId
    || textReadiness?.state !== 'ready') {
    throw new Error(`conversation report Runtime Agent AI Config is not ready: ${JSON.stringify({
      revision: committed.revision,
      route: committed.intents['text.generate']?.route,
      modelMatches: committed.intents['text.generate']?.modelId === route.executionBinding.modelId,
      connectorMatches: committed.intents['text.generate']?.connectorId === route.executionBinding.connectorId,
      readiness: textReadiness?.state || null,
    })}`);
  }
  return { committed, readiness };
}
