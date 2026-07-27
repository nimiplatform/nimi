import type {
  NimiAccentPack,
  NimiDensity,
  NimiThemeScheme,
} from '@nimiplatform/kit/ui';
import type { JsonValue } from '../bridge/types.js';

export const NIMI_RENDERER_HOST_PROTOCOL = 'nimi.renderer.host/v1' as const;

export interface NimiRendererInstanceScope {
  domId(localId: string): string;
  globalName(localName: string): string;
}

export interface NimiRendererLocalizationV1 {
  readonly locale: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

export interface NimiRendererSurfaceLifecycleV1 {
  reportReadyCandidate(): void;
}

export interface NimiRendererThemeSnapshotV1 {
  readonly scheme: NimiThemeScheme;
  readonly accentPack: NimiAccentPack;
  readonly density: NimiDensity;
}

export interface NimiRendererThemeViewV1 {
  getSnapshot(): NimiRendererThemeSnapshotV1;
  subscribe(listener: () => void): () => void;
}

export interface NimiRendererThemeControllerV1 extends NimiRendererThemeViewV1 {
  setSnapshot(snapshot: NimiRendererThemeSnapshotV1): void;
}

export type NimiRendererHostFailureDisposition =
  | 'unsupported'
  | 'capability-denied'
  | 'resource-exhausted'
  | 'invalid-input'
  | 'host-unavailable'
  | 'effect-forbidden'
  | 'internal';

export type NimiRendererHostResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | {
    readonly ok: false;
    readonly error: { readonly disposition: NimiRendererHostFailureDisposition };
  };

export interface NimiRendererHostMethodSpec<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> {
  readonly input: TInput;
  readonly output: TOutput;
}

export type NimiRendererHostMethodMap = Readonly<
  Record<string, NimiRendererHostMethodSpec<JsonValue, JsonValue>>
>;

export type NimiRendererHostMethodInput<TSpec> =
  TSpec extends NimiRendererHostMethodSpec<infer TInput, JsonValue>
    ? TInput
    : never;

export type NimiRendererHostMethodOutput<TSpec> =
  TSpec extends NimiRendererHostMethodSpec<JsonValue, infer TOutput>
    ? TOutput
    : never;

export type NimiRendererHostMethodKey<TMethods extends NimiRendererHostMethodMap> =
  keyof TMethods & string;

export interface NimiRendererHostOperationPort<
  TMethods extends NimiRendererHostMethodMap,
> {
  invoke<TKey extends NimiRendererHostMethodKey<TMethods>>(
    method: TKey,
    input: NimiRendererHostMethodInput<TMethods[TKey]>,
  ): Promise<NimiRendererHostResult<NimiRendererHostMethodOutput<TMethods[TKey]>>>;
}

export type NimiRendererOverlayDismissReason =
  | 'escape'
  | 'outside-pointer'
  | 'app'
  | 'dispose'
  | 'reset';

export type NimiRendererOverlayLeaseState =
  | 'open'
  | 'dismiss-requested'
  | 'releasing'
  | 'released';

export interface NimiRendererOverlayNodeRegistration {
  readonly trigger: HTMLElement | null;
  readonly content: HTMLElement;
  readonly initialFocus: HTMLElement | null;
  readonly fallbackFocus: HTMLElement | null;
  readonly returnFocus: HTMLElement | null;
}

export interface NimiRendererOverlayLease {
  state(): NimiRendererOverlayLeaseState;
  registerNodes(
    nodes: NimiRendererOverlayNodeRegistration,
  ): NimiRendererHostResult<{ readonly registered: boolean }>;
  subscribeDismiss(
    listener: (reason: NimiRendererOverlayDismissReason) => void,
  ): NimiRendererHostResult<() => void>;
  requestDismiss(
    reason: Extract<NimiRendererOverlayDismissReason, 'app'>,
  ): Promise<NimiRendererHostResult<{ readonly requested: boolean }>>;
  acknowledgeContentUnmounted(): Promise<
    NimiRendererHostResult<{ readonly released: boolean }>
  >;
}

export interface NimiRendererOverlayOptions {
  readonly kind: 'dialog' | 'popover' | 'menu' | 'tooltip';
  readonly modal: boolean;
  readonly dismissOnEscape: boolean;
  readonly dismissOnOutsidePointer: boolean;
  readonly returnFocus: boolean;
  readonly initialFocusSemanticId: string | null;
  readonly returnFocusSemanticId: string | null;
  readonly scrollLock: 'none' | 'simulator-root';
  readonly ariaLabel: string;
}

export interface NimiRendererOverlayPort {
  readonly target: HTMLElement;
  acquire(
    options: NimiRendererOverlayOptions,
  ): Promise<NimiRendererHostResult<NimiRendererOverlayLease>>;
}

export interface NimiRendererHostFacadeV1<
  TMethods extends NimiRendererHostMethodMap,
> {
  readonly protocol: typeof NIMI_RENDERER_HOST_PROTOCOL;
  readonly scope: NimiRendererInstanceScope;
  readonly capabilities: ReadonlySet<NimiRendererHostMethodKey<TMethods>>;
  readonly localization: NimiRendererLocalizationV1;
  readonly theme: NimiRendererThemeViewV1;
  readonly overlays: NimiRendererOverlayPort;
  readonly surfaceLifecycle: NimiRendererSurfaceLifecycleV1;
  invoke<TKey extends NimiRendererHostMethodKey<TMethods>>(
    method: TKey,
    input: NimiRendererHostMethodInput<TMethods[TKey]>,
  ): Promise<NimiRendererHostMethodOutput<TMethods[TKey]>>;
}

/**
 * Closed host-neutral envelope consumed by an App-owned canonical renderer
 * factory. Nested App, SDK, route, and clock catalogs remain owned by their
 * respective packages; Kit owns the shared envelope and the aliases into the
 * provider-scoped renderer host facade.
 */
export interface NimiCanonicalRendererHostBindingsV1<
  TProjectionPort extends object,
  TCommandPort extends object,
  TEventPort extends object,
  TKitFacade extends object,
  TSdkFacade extends object,
  TRoutePort extends object,
  TClockView extends object,
> {
  readonly protocol: typeof NIMI_RENDERER_HOST_PROTOCOL;
  readonly scope: NimiRendererInstanceScope;
  readonly capabilities: ReadonlySet<string>;
  readonly localization: NimiRendererLocalizationV1;
  readonly kit: TKitFacade;
  readonly sdk: TSdkFacade;
  readonly app: {
    readonly projection: TProjectionPort;
    readonly commands: TCommandPort;
    readonly events: TEventPort;
  };
  readonly route: TRoutePort;
  readonly clock: TClockView;
  readonly surfaceLifecycle: NimiRendererSurfaceLifecycleV1;
}

export type AnyNimiCanonicalRendererHostBindingsV1 =
  NimiCanonicalRendererHostBindingsV1<
    object,
    object,
    object,
    object,
    object,
    object,
    object
  >;

export type CreateNimiCanonicalRendererHostBindingsInput<
  TProjectionPort extends object,
  TCommandPort extends object,
  TEventPort extends object,
  TKitFacade extends object,
  TSdkFacade extends object,
  TRoutePort extends object,
  TClockView extends object,
> = Omit<
  NimiCanonicalRendererHostBindingsV1<
    TProjectionPort,
    TCommandPort,
    TEventPort,
    TKitFacade,
    TSdkFacade,
    TRoutePort,
    TClockView
  >,
  'protocol'
>;

export interface NimiRendererHostTargetsV1 {
  readonly renderer: HTMLElement;
  readonly overlay: HTMLElement;
}

export interface NimiRendererHostBindingV1<
  TMethods extends NimiRendererHostMethodMap,
> {
  readonly protocol: typeof NIMI_RENDERER_HOST_PROTOCOL;
  readonly facade: NimiRendererHostFacadeV1<TMethods>;
  readonly targets: NimiRendererHostTargetsV1;
}

export interface CreateNimiRendererHostBindingInput<
  TMethods extends NimiRendererHostMethodMap,
> {
  readonly opaqueScopePrefix: string;
  readonly declaredMethods: Iterable<NimiRendererHostMethodKey<TMethods>>;
  readonly capabilities: Iterable<NimiRendererHostMethodKey<TMethods>>;
  readonly localization: NimiRendererLocalizationV1;
  readonly targets: NimiRendererHostTargetsV1;
  readonly theme: NimiRendererThemeViewV1;
  readonly operations: NimiRendererHostOperationPort<TMethods>;
  readonly overlays: NimiRendererOverlayPort;
  readonly surfaceLifecycle: NimiRendererSurfaceLifecycleV1;
}
