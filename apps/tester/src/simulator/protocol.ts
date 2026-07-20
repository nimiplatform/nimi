import type {
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

export type TesterSimulatorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TesterSimulatorJsonValue[]
  | { readonly [key: string]: TesterSimulatorJsonValue };

export type TesterSimulatorResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: { readonly code: string } };

export interface TesterSimulatorRouteState {
  readonly pathname: string;
  readonly search: readonly { readonly key: string; readonly value: string }[];
  readonly fragment: string | null;
}

export interface TesterSimulatorPrepareContext {
  readonly protocol: 'nimi.simulator.module/v1';
  readonly moduleId: string;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly abortSignal: AbortSignal;
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly commands: {
    invoke(type: string, payload: TesterSimulatorJsonValue): Promise<TesterSimulatorResult<TesterSimulatorJsonValue>>;
  };
  readonly events: {
    subscribe(
      eventType: string,
      handler: (payload: TesterSimulatorJsonValue, event: TesterSimulatorJsonValue) => unknown,
    ): TesterSimulatorResult<() => void>;
  };
  readonly cleanup: {
    add(dispose: () => Promise<void> | void): TesterSimulatorResult<{ readonly registrationId: string }>;
  };
  readonly projection: {
    get(): TesterSimulatorJsonValue;
    subscribe(listener: (value: TesterSimulatorJsonValue) => unknown): () => void;
  };
  readonly route: {
    get(): TesterSimulatorRouteState;
    subscribe(listener: (route: TesterSimulatorRouteState) => unknown): () => void;
    navigate(route: TesterSimulatorRouteState): Promise<TesterSimulatorResult<TesterSimulatorJsonValue>>;
  };
  readonly clock: {
    now(): number;
  };
}

export interface TesterSimulatorCommandEnvelope {
  readonly type: string;
  readonly payload: TesterSimulatorJsonValue;
}

export interface TesterSimulatorBehaviorContext {
  readonly now: number;
  drawRandom(): number;
}

export interface TesterSimulatorInitialInput {
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  readonly moduleData: TesterSimulatorJsonValue;
  readonly sharedProjection: TesterSimulatorJsonValue;
}

export interface TesterSimulatorProjectionInput {
  readonly surfaceId: string;
  readonly route: TesterSimulatorRouteState;
  readonly sharedProjection: TesterSimulatorJsonValue;
}
