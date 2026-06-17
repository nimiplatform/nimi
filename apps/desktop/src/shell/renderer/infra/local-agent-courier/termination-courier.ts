import type { Realm } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@nimiplatform/sdk/types';

const COURIER_POLL_INTERVAL_MS = 60_000;
const COURIER_POLLING_KEY = 'local-agent-termination-courier';

export type LocalAgentTerminationIntentDto = {
  id: string;
  localAgentRef: string;
  ownerUserId: string;
  runtimeSourceRef: string;
};

export type LocalAgentTerminationDeliverer = (intent: LocalAgentTerminationIntentDto) => Promise<void>;

type RealmCourierApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmCourierErrorEmitter = (action: string, error: unknown, details?: JsonObject) => void;
type CurrentUserReader = () => Record<string, unknown> | null;

export type LocalAgentTerminationCourierPassResult = {
  pulled: number;
  terminated: number;
  substrateFailed: number;
  deferred: number;
};

export async function runLocalAgentTerminationCourierPass(_input: {
  callApi: RealmCourierApiCaller;
  emitCourierError: RealmCourierErrorEmitter;
  getCurrentUser: CurrentUserReader;
  deliverer?: LocalAgentTerminationDeliverer;
}): Promise<LocalAgentTerminationCourierPassResult> {
  throw new Error('LocalAgent termination courier is superseded by RuntimeSourceSnapshot materialization handoff');
}

export { COURIER_POLL_INTERVAL_MS, COURIER_POLLING_KEY };
