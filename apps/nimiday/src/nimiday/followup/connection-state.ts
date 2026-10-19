import type { FollowUpSnapshot } from './engine.js';

type Target = FollowUpSnapshot['targets'][number];
export const isFollowUpTarget = (target: Target) => target.kind === 'telegram'
  && ['telegram.sendMessage', 'telegram.updates.read'].every(name => target.permittedOperations.includes(name));

export function affectedFollowUps(snapshot: FollowUpSnapshot | null) {
  if (!snapshot?.ready) return [];
  return snapshot.arrangements.filter(item => {
    if (item.state === 'completed' || item.state === 'stopped') return false;
    return !snapshot.targets.some(target => target.targetRef === item.targetRef && target.available && isFollowUpTarget(target))
      || !snapshot.agents.some(agent => agent.agentBinding === item.agentBinding);
  });
}
