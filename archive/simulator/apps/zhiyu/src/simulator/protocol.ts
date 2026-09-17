import type { NimiRendererHostFacadeV1, NimiRendererHostMethodMap } from '@nimiplatform/kit/shell/renderer/host';

export type ZhiyuSimulatorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ZhiyuSimulatorJsonValue[]
  | { readonly [key: string]: ZhiyuSimulatorJsonValue };

export type ZhiyuSimulatorResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: { readonly code: string } };

export interface ZhiyuSimulatorRouteState {
  readonly pathname: string;
  readonly search: readonly { readonly key: string; readonly value: string }[];
  readonly fragment: string | null;
}

export interface ZhiyuSimulatorPrepareContext {
  readonly protocol: 'nimi.simulator.module/v1';
  readonly moduleId: string;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly abortSignal: AbortSignal;
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly commands: {
    invoke(type: string, payload: ZhiyuSimulatorJsonValue): Promise<ZhiyuSimulatorResult<ZhiyuSimulatorJsonValue>>;
  };
  readonly events: {
    subscribe(
      eventType: string,
      handler: (payload: ZhiyuSimulatorJsonValue, event: ZhiyuSimulatorJsonValue) => unknown,
    ): ZhiyuSimulatorResult<() => void>;
  };
  readonly cleanup: {
    add(dispose: () => Promise<void> | void): ZhiyuSimulatorResult<{ readonly registrationId: string }>;
  };
  readonly projection: {
    get(): ZhiyuSimulatorJsonValue;
    subscribe(listener: (value: ZhiyuSimulatorJsonValue) => unknown): () => void;
  };
  readonly route: {
    get(): ZhiyuSimulatorRouteState;
    subscribe(listener: (route: ZhiyuSimulatorRouteState) => unknown): () => void;
  };
  readonly clock: { now(): number };
}

export interface ZhiyuSimulatorCommandEnvelope {
  readonly type: string;
  readonly payload: ZhiyuSimulatorJsonValue;
}

export interface ZhiyuSimulatorBehaviorContext {
  readonly now: number;
  drawRandom(): number;
}

export interface ZhiyuSimulatorInitialInput {
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  readonly moduleData: ZhiyuSimulatorJsonValue;
  readonly sharedProjection: ZhiyuSimulatorJsonValue;
}

export interface ZhiyuSimulatorProjectionInput {
  readonly surfaceId: string;
  readonly route: ZhiyuSimulatorRouteState;
  readonly sharedProjection: ZhiyuSimulatorJsonValue;
}
