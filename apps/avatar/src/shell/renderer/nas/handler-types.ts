import type { AgentDataBundle } from '../driver/types.js';
import type { BackendProjection, Live2DBackendExtension } from '../carrier/backend-branch.js';

export type HandlerMeta = {
  description?: string;
  author?: string;
};

/** Capability requirements declared by a NAS handler module. The only
 *  admitted capability at wave_1 is `live2d-extension`; declaring it
 *  unlocks `extension.live2d` (Live2D `setParameter` escape hatch) on
 *  the handler invocation surface. The handler-registry rejects any
 *  handler that requires `live2d-extension` when the loaded model is
 *  VRM — there is no fallback. */
export type NasHandlerCapability = 'live2d-extension';

export type NasHandlerExtension = {
  live2d?: Live2DBackendExtension;
};

export type ActivityOrEventHandler = {
  meta?: HandlerMeta;
  /** Optional capability requirement list. When present and the
   *  loaded backend cannot satisfy a capability, the registry rejects
   *  the handler entirely. */
  requires?: readonly NasHandlerCapability[];
  dispose?(): void;
  execute(
    ctx: AgentDataBundle,
    projection: BackendProjection,
    options: {
      signal: AbortSignal;
      /** Branch-specific extension surface (e.g. Live2D
       *  `setParameter`). Populated only when the handler module
       *  declared the matching `requires` capability AND the loaded
       *  backend supports it. */
      extension?: NasHandlerExtension;
    },
  ): Promise<void>;
};

export type ContinuousHandler = {
  meta?: HandlerMeta;
  fps?: number;
  enabled?: boolean;
  requires?: readonly NasHandlerCapability[];
  dispose?(): void;
  update(
    ctx: AgentDataBundle,
    projection: BackendProjection,
    options?: { extension?: NasHandlerExtension },
  ): Promise<void> | void;
};

export type RegisteredActivityHandler = {
  kind: 'activity';
  activityId: string;
  handler: ActivityOrEventHandler;
  sourcePath: string;
  /** True when the handler module declared
   *  `requires: ['live2d-extension']`. Set during registry population
   *  after the backend kind is checked. */
  requiresLive2DExtension?: boolean;
};

export type RegisteredEventHandler = {
  kind: 'event';
  eventName: string;
  handler: ActivityOrEventHandler;
  sourcePath: string;
  requiresLive2DExtension?: boolean;
};

export type RegisteredContinuousHandler = {
  kind: 'continuous';
  id: string;
  fps: number;
  handler: ContinuousHandler;
  sourcePath: string;
  requiresLive2DExtension?: boolean;
};

export type RegisteredHandler =
  | RegisteredActivityHandler
  | RegisteredEventHandler
  | RegisteredContinuousHandler;
