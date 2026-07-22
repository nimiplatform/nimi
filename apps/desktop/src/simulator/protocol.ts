import type {
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

export type DesktopSimulatorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly DesktopSimulatorJsonValue[]
  | { readonly [key: string]: DesktopSimulatorJsonValue };

export type DesktopSimulatorResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: { readonly code: string } };

export interface DesktopSimulatorRouteState {
  readonly pathname: string;
  readonly search: readonly { readonly key: string; readonly value: string }[];
  readonly fragment: string | null;
}

export interface DesktopSimulatorPrepareContext {
  readonly protocol: 'nimi.simulator.module/v1';
  readonly moduleId: string;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly abortSignal: AbortSignal;
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly commands: {
    invoke(type: string, payload: DesktopSimulatorJsonValue): Promise<DesktopSimulatorResult<DesktopSimulatorJsonValue>>;
  };
  readonly interactions: {
    emit(input: {
      readonly protocol: 'nimi.simulator.interaction/v1';
      readonly interactionId: string;
      readonly targets: readonly string[];
      readonly type: string;
      readonly payload: DesktopSimulatorJsonValue;
    }): Promise<DesktopSimulatorResult<DesktopSimulatorJsonValue>>;
  };
  readonly events: {
    subscribe(
      eventType: string,
      handler: (payload: DesktopSimulatorJsonValue, event: DesktopSimulatorJsonValue) => unknown,
    ): DesktopSimulatorResult<() => void>;
  };
  readonly cleanup: {
    add(dispose: () => Promise<void> | void): DesktopSimulatorResult<{ readonly registrationId: string }>;
  };
  readonly projection: {
    get(): DesktopSimulatorJsonValue;
    subscribe(listener: (value: DesktopSimulatorJsonValue) => unknown): () => void;
  };
  readonly route: {
    get(): DesktopSimulatorRouteState;
    subscribe(listener: (route: DesktopSimulatorRouteState) => unknown): () => void;
    navigate(route: DesktopSimulatorRouteState): Promise<DesktopSimulatorResult<DesktopSimulatorJsonValue>>;
  };
  readonly clock: {
    now(): number;
    schedule(
      command: {
        readonly type: string;
        readonly payload: DesktopSimulatorJsonValue;
        readonly causationId: string | null;
      },
      delayMs: number,
    ): Promise<DesktopSimulatorResult<DesktopSimulatorJsonValue>>;
    cancel(jobId: string): Promise<DesktopSimulatorResult<DesktopSimulatorJsonValue>>;
  };
}

export interface DesktopSimulatorCommandEnvelope {
  readonly type: string;
  readonly payload: DesktopSimulatorJsonValue;
}

export interface DesktopSimulatorBehaviorContext {
  readonly now: number;
  drawRandom(): number;
}

export interface DesktopSimulatorInitialInput {
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  readonly moduleData: DesktopSimulatorJsonValue;
  readonly sharedProjection: DesktopSimulatorJsonValue;
}

export interface DesktopSimulatorProjectionInput {
  readonly surfaceId: string;
  readonly route: DesktopSimulatorRouteState;
  readonly sharedProjection: DesktopSimulatorJsonValue;
}
