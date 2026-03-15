import { dataSync } from '@runtime/data-sync';
import { i18n } from '@renderer/i18n';

export type AgentFriendLimit = {
  tier: 'FREE' | 'PRO' | 'MAX';
  status: 'ACTIVE' | 'CANCELED' | 'PAST_DUE' | 'PAUSED';
  used: number;
  limit: number;
  canAdd: boolean;
  reason: string | null;
};

const LIMIT_BY_TIER: Record<AgentFriendLimit['tier'], number> = {
  FREE: 10,
  PRO: 20,
  MAX: 50,
};

function normalizeTier(value: unknown): AgentFriendLimit['tier'] {
  if (value === 'PRO' || value === 'MAX') {
    return value;
  }
  return 'FREE';
}

function normalizeStatus(value: unknown): AgentFriendLimit['status'] {
  if (value === 'CANCELED' || value === 'PAST_DUE' || value === 'PAUSED') {
    return value;
  }
  return 'ACTIVE';
}

function isAgentFriend(friend: unknown): boolean {
  if (!friend || typeof friend !== 'object') {
    return false;
  }
  const payload = friend as Record<string, unknown>;
  return payload.isAgent === true;
}

export async function resolveAgentFriendLimit(): Promise<AgentFriendLimit> {
  const social = await dataSync.loadSocialSnapshot();
  const socialRecord = social && typeof social === 'object'
    ? social as Record<string, unknown>
    : {};
  let subscriptionRecord: Record<string, unknown> = {};
  try {
    const subscription = await dataSync.loadSubscriptionStatus();
    subscriptionRecord = subscription && typeof subscription === 'object'
      ? subscription as Record<string, unknown>
      : {};
  } catch {
    // subscription API 失败时回退 FREE tier（limit=10）
  }

  const tier = normalizeTier(subscriptionRecord.tier);
  const status = normalizeStatus(subscriptionRecord.status);
  const limit = LIMIT_BY_TIER[tier];
  const friends = Array.isArray(socialRecord.friends) ? socialRecord.friends : [];
  const used = friends.filter((friend) => isAgentFriend(friend)).length;
  const canAdd = used < limit;
  const reason = canAdd
    ? null
    : i18n.t('Contacts.agentFriendLimitReached', {
      used,
      limit,
      tier,
      defaultValue: 'Agent friend limit reached ({{used}}/{{limit}}, tier: {{tier}})',
    });

  return {
    tier,
    status,
    used,
    limit,
    canAdd,
    reason,
  };
}
