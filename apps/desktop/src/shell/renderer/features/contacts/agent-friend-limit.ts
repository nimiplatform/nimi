import { dataSync } from '@runtime/data-sync';
import { i18n } from '@renderer/i18n';
import { parseOptionalJsonObject, type JsonObject } from '@renderer/bridge/runtime-bridge/shared';

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
  const payload = parseOptionalJsonObject(friend);
  if (!payload) {
    return false;
  }
  return payload.isAgent === true;
}

export async function resolveAgentFriendLimit(): Promise<AgentFriendLimit> {
  const [social, subscriptionResult] = await Promise.allSettled([
    dataSync.loadSocialSnapshot(),
    dataSync.loadSubscriptionStatus(),
  ]);
  if (social.status === 'rejected') throw social.reason;
  let subscriptionRecord: JsonObject = {};
  if (subscriptionResult.status === 'fulfilled') {
    subscriptionRecord = parseOptionalJsonObject(subscriptionResult.value) ?? {};
  }
  // subscription API 失败时回退 FREE tier（limit=10）

  const tier = normalizeTier(subscriptionRecord.tier);
  const status = normalizeStatus(subscriptionRecord.status);
  const limit = LIMIT_BY_TIER[tier];
  const friends = Array.isArray(social.value.friends) ? social.value.friends : [];
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
