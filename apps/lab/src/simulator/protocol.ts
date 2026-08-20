import type {
  NimiRendererHostFacadeV1,
  NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';

export type LabSimulatorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly LabSimulatorJsonValue[]
  | { readonly [key: string]: LabSimulatorJsonValue };

export type LabSimulatorResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: { readonly code: string } };

export interface LabSimulatorRouteState {
  readonly pathname: string;
  readonly search: readonly { readonly key: string; readonly value: string }[];
  readonly fragment: string | null;
}

export interface LabSimulatorPrepareContext {
  readonly protocol: 'nimi.simulator.module/v1';
  readonly moduleId: string;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly abortSignal: AbortSignal;
  readonly kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>;
  readonly commands: {
    invoke(type: string, payload: LabSimulatorJsonValue): Promise<LabSimulatorResult<LabSimulatorJsonValue>>;
  };
  readonly events: {
    subscribe(
      eventType: string,
      handler: (payload: LabSimulatorJsonValue, event: LabSimulatorJsonValue) => unknown,
    ): LabSimulatorResult<() => void>;
  };
  readonly cleanup: {
    add(dispose: () => Promise<void> | void): LabSimulatorResult<{ readonly registrationId: string }>;
  };
  readonly projection: {
    get(): LabSimulatorJsonValue;
    subscribe(listener: (value: LabSimulatorJsonValue) => unknown): () => void;
  };
  readonly route: {
    get(): LabSimulatorRouteState;
    subscribe(listener: (route: LabSimulatorRouteState) => unknown): () => void;
    navigate(route: LabSimulatorRouteState): Promise<LabSimulatorResult<LabSimulatorJsonValue>>;
  };
  readonly clock: {
    now(): number;
  };
}

export interface LabSimulatorCommandEnvelope {
  readonly type: string;
  readonly payload: LabSimulatorJsonValue;
}

export interface LabSimulatorBehaviorContext {
  readonly now: number;
  drawRandom(): number;
}

export interface LabSimulatorInitialInput {
  readonly scenarioId: string;
  readonly scenarioRevision: string;
  readonly moduleData: LabSimulatorJsonValue;
  readonly sharedProjection: LabSimulatorJsonValue;
}

export interface LabSimulatorProjectionInput {
  readonly surfaceId: string;
  readonly route: LabSimulatorRouteState;
  readonly sharedProjection: LabSimulatorJsonValue;
}
