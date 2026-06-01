import type { Realm } from '../client.js';
import type { RealmModel } from '../generated/type-helpers.js';

export type RealmLocalAgentIntentApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type RealmLocalAgentProvisionIntentDto = RealmModel<'LocalAgentProvisionIntentDto'>;
export type RealmLocalAgentProvisionIntentAckDto = RealmModel<'LocalAgentProvisionIntentAckDto'>;
export type RealmLocalAgentTerminationIntentDto = RealmModel<'LocalAgentTerminationIntentDto'>;
export type RealmLocalAgentTerminationIntentAckDto = RealmModel<'LocalAgentTerminationIntentAckDto'>;

type IntentList<T> = {
  items?: T[];
};

function toIntentItems<T>(value: IntentList<T> | null | undefined): T[] {
  return Array.isArray(value?.items) ? value.items : [];
}

export async function listRealmLocalAgentProvisionIntents(
  callApi: RealmLocalAgentIntentApiCaller,
): Promise<RealmLocalAgentProvisionIntentDto[]> {
  const list = await callApi(
    (realm) => realm.services.MeService.listMyLocalAgentProvisionIntents(),
    '拉取本地 Agent 创建意图失败',
  );
  return toIntentItems(list);
}

export async function ackRealmLocalAgentProvisionIntent(
  callApi: RealmLocalAgentIntentApiCaller,
  intentId: string,
  ackBody: RealmLocalAgentProvisionIntentAckDto,
): Promise<void> {
  await callApi(
    (realm) => realm.services.MeService.ackMyLocalAgentProvisionIntent(intentId, ackBody),
    '上报本地 Agent 创建结果失败',
  );
}

export async function listRealmLocalAgentTerminationIntents(
  callApi: RealmLocalAgentIntentApiCaller,
): Promise<RealmLocalAgentTerminationIntentDto[]> {
  const list = await callApi(
    (realm) => realm.services.MeService.listMyLocalAgentTerminationIntents(),
    '拉取本地 Agent 终止意图失败',
  );
  return toIntentItems(list);
}

export async function ackRealmLocalAgentTerminationIntent(
  callApi: RealmLocalAgentIntentApiCaller,
  intentId: string,
  ackBody: RealmLocalAgentTerminationIntentAckDto,
): Promise<void> {
  await callApi(
    (realm) => realm.services.MeService.ackMyLocalAgentTerminationIntent(intentId, ackBody),
    '上报本地 Agent 终止结果失败',
  );
}
