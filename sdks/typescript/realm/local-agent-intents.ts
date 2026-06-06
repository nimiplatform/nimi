import type {
  LocalAgentProvisionIntentAckDto,
  LocalAgentProvisionIntentDto,
  LocalAgentProvisionIntentListDto,
  LocalAgentTerminationIntentAckDto,
  LocalAgentTerminationIntentDto,
  LocalAgentTerminationIntentListDto,
} from '../core-generated/realm-typed-client';
import type { Realm } from './index';

export type NimiRealmLocalAgentIntentApiCaller = <T>(
  task: (realm: Realm) => Promise<T>,
  fallbackMessage?: string,
) => Promise<T>;

export type NimiRealmLocalAgentProvisionIntentDto = LocalAgentProvisionIntentDto;
export type NimiRealmLocalAgentProvisionIntentAckDto = LocalAgentProvisionIntentAckDto;
export type NimiRealmLocalAgentTerminationIntentDto = LocalAgentTerminationIntentDto;
export type NimiRealmLocalAgentTerminationIntentAckDto = LocalAgentTerminationIntentAckDto;

function toIntentItems<T>(value: { readonly items?: readonly T[] } | null | undefined): T[] {
  return Array.isArray(value?.items) ? [...value.items] : [];
}

export async function listNimiRealmLocalAgentProvisionIntents(
  callApi: NimiRealmLocalAgentIntentApiCaller,
): Promise<NimiRealmLocalAgentProvisionIntentDto[]> {
  const list = await callApi<LocalAgentProvisionIntentListDto>(
    (realm) => realm.localAgentIntents.listMyLocalAgentProvisionIntents({ path: {} }),
    '拉取本地 Agent 创建意图失败',
  );
  return toIntentItems(list);
}

export async function ackNimiRealmLocalAgentProvisionIntent(
  callApi: NimiRealmLocalAgentIntentApiCaller,
  intentId: string,
  ackBody: NimiRealmLocalAgentProvisionIntentAckDto,
): Promise<void> {
  await callApi(
    (realm) => realm.localAgentIntents.ackMyLocalAgentProvisionIntent({
      path: { intentId },
      body: ackBody,
    }),
    '上报本地 Agent 创建结果失败',
  );
}

export async function listNimiRealmLocalAgentTerminationIntents(
  callApi: NimiRealmLocalAgentIntentApiCaller,
): Promise<NimiRealmLocalAgentTerminationIntentDto[]> {
  const list = await callApi<LocalAgentTerminationIntentListDto>(
    (realm) => realm.localAgentIntents.listMyLocalAgentTerminationIntents({ path: {} }),
    '拉取本地 Agent 终止意图失败',
  );
  return toIntentItems(list);
}

export async function ackNimiRealmLocalAgentTerminationIntent(
  callApi: NimiRealmLocalAgentIntentApiCaller,
  intentId: string,
  ackBody: NimiRealmLocalAgentTerminationIntentAckDto,
): Promise<void> {
  await callApi(
    (realm) => realm.localAgentIntents.ackMyLocalAgentTerminationIntent({
      path: { intentId },
      body: ackBody,
    }),
    '上报本地 Agent 终止结果失败',
  );
}
