type WorldCreateAgentAdmissionProjection = {
  status: string;
  nativeCreationState: string;
  nativeAgentLimit: number;
  agentCount: number;
};

export function worldAdmitsUserCreatedRealmAgents(
  world: WorldCreateAgentAdmissionProjection,
): boolean {
  return (
    world.status === 'ACTIVE'
    && world.nativeCreationState === 'OPEN'
    && world.nativeAgentLimit > world.agentCount
  );
}

