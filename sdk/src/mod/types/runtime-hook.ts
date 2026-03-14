import type { HookDataClient } from './data';
import type { HookActionClient } from './action';
import type { HookEventClient } from './event';
import type { HookInterModClient } from './inter-mod';
import type {
  HookAuditClient,
  HookMetaClient,
} from './meta';
import type { HookProfileClient } from './profile';
import type { HookStorageClient } from './storage';
import type { HookTurnClient } from './turn';
import type { HookUiClient } from './ui';

export type * from './shared';
export type * from './action';
export type * from './event';
export type * from './data';
export type * from './turn';
export type * from './ui';
export type * from './inter-mod';
export type * from './meta';
export type * from './profile';
export type * from './storage';

export type HookClient = {
  action: HookActionClient;
  event: HookEventClient;
  data: HookDataClient;
  storage: HookStorageClient;
  turn: HookTurnClient;
  ui: HookUiClient;
  interMod: HookInterModClient;
  profile: HookProfileClient;
  audit: HookAuditClient;
  meta: HookMetaClient;
};
