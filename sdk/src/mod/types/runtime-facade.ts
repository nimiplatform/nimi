import type { RuntimeHookDataFacade } from './data';
import type { RuntimeHookActionFacade } from './action';
import type { RuntimeHookEventFacade } from './event';
import type { RuntimeHookInterModFacade } from './inter-mod';
import type { RuntimeHookAuditFacade, RuntimeHookMetaFacade } from './meta';
import type { RuntimeHookProfileFacade } from './profile';
import type { RuntimeHookTurnFacade } from './turn';
import type { RuntimeHookUiFacade } from './ui';

export type RuntimeHookRuntimeFacade =
  & RuntimeHookActionFacade
  & RuntimeHookEventFacade
  & RuntimeHookDataFacade
  & RuntimeHookTurnFacade
  & RuntimeHookUiFacade
  & RuntimeHookInterModFacade
  & RuntimeHookProfileFacade
  & RuntimeHookAuditFacade
  & RuntimeHookMetaFacade;
