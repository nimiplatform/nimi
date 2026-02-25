export type ContactSyncMetrics = {
  friendsCount: number;
  agentsCount: number;
  groupsCount: number;
};

export function toContactSyncMetrics(input: {
  friends?: unknown[];
  agents?: unknown[];
  groups?: unknown[];
}): ContactSyncMetrics {
  return {
    friendsCount: Array.isArray(input.friends) ? input.friends.length : 0,
    agentsCount: Array.isArray(input.agents) ? input.agents.length : 0,
    groupsCount: Array.isArray(input.groups) ? input.groups.length : 0,
  };
}

