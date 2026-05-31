import { dataSync } from '@runtime/data-sync';
import { i18n } from '@renderer/i18n';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

/**
 * Agent-friend quota — Desktop projection (`D-CONTACTS-006`).
 *
 * The agent-friend limit is a SINGLE backend-owned baseline value with no
 * subscription-tier coupling. The renderer MUST NOT hardcode the limit number
 * and MUST NOT keep a per-tier table: the baseline value is sourced verbatim
 * from the `getMyAgentFriendLimit` backend projection.
 *
 * When the quota projection is unavailable, the surface fails closed with a
 * typed `unavailable` state — it does NOT fall back to a renderer-guessed
 * ceiling.
 */
export type AgentFriendLimit =
  | {
      status: 'available';
      used: number;
      limit: number;
      canAdd: boolean;
      reason: string | null;
    }
  | {
      status: 'unavailable';
      used: null;
      limit: null;
      canAdd: false;
      reason: string;
    };

export async function resolveAgentFriendLimit(): Promise<AgentFriendLimit> {
  let projection: JsonObject | null;
  try {
    projection = parseOptionalJsonObject(await dataSync.loadAgentFriendLimit()) ?? null;
  } catch {
    projection = null;
  }

  const used = projection?.used;
  const limit = projection?.limit;
  if (typeof used !== 'number' || typeof limit !== 'number') {
    // D-CONTACTS-006: quota truth unavailable -> typed fail-closed state.
    // No renderer-guessed ceiling, no tier-default fallback.
    return {
      status: 'unavailable',
      used: null,
      limit: null,
      canAdd: false,
      reason: i18n.t('Relationship.agentFriendLimitUnavailable', {
        defaultValue: 'Agent friend quota is currently unavailable',
      }),
    };
  }

  const canAdd = typeof projection?.canAdd === 'boolean' ? projection.canAdd : used < limit;
  const reason = canAdd
    ? null
    : i18n.t('Relationship.agentFriendLimitReached', {
      used,
      limit,
      defaultValue: 'Agent friend limit reached ({{used}}/{{limit}})',
    });

  return {
    status: 'available',
    used,
    limit,
    canAdd,
    reason,
  };
}
