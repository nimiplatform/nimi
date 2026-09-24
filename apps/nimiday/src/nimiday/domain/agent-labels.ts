import type { CareCircle } from './types.js';

/**
 * How a person or area is named to the agent. The user's own circle is often
 * called "我自己"/"Me", which an agent would read as itself, so it is marked
 * as the user.
 */
export function agentCircleName(circle: CareCircle): string {
  if (circle.kind !== 'self') return circle.name;
  return /[\u3400-\u9fff]/u.test(circle.name) ? `${circle.name}（用户本人）` : `${circle.name} (the user)`;
}
