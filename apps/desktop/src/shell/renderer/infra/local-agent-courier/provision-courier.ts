import type { Realm } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@nimiplatform/sdk/types';

const COURIER_POLL_INTERVAL_MS = 60_000;
const COURIER_POLLING_KEY = 'local-agent-provision-courier';

export type LocalAgentProvisionIntentDto = {
  id: string;
  localAgentRef: string;
  ownerUserId: string;
  runtimeSourceRef: string;
};

export type LocalAgentProvisionDeliverer = (intent: LocalAgentProvisionIntentDto) => Promise<void>;

type RealmCourierApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmCourierErrorEmitter = (action: string, error: unknown, details?: JsonObject) => void;
type CurrentUserReader = () => Record<string, unknown> | null;

export type LocalAgentProvisionCourierPassResult = {
  pulled: number;
  established: number;
  substrateFailed: number;
  deferred: number;
};

export async function runLocalAgentProvisionCourierPass(_input: {
  callApi: RealmCourierApiCaller;
  emitCourierError: RealmCourierErrorEmitter;
  getCurrentUser: CurrentUserReader;
  deliverer?: LocalAgentProvisionDeliverer;
}): Promise<LocalAgentProvisionCourierPassResult> {
  throw new Error('LocalAgent provision courier is superseded by RuntimeSourceSnapshot materialization handoff');
}

export { COURIER_POLL_INTERVAL_MS, COURIER_POLLING_KEY };
