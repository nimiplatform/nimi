import {
  createNimiCanonicalRendererHostBindings,
  type CreateNimiCanonicalRendererHostBindingsInput,
  type NimiCanonicalRendererHostBindingsV1,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodSpec,
} from '@nimiplatform/kit/shell/renderer/host';

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;
type Assert<TValue extends true> = TValue;

type ShellMethods = {
  readonly 'nimi.shell.fixture.read': NimiRendererHostMethodSpec<
    { readonly key: string },
    { readonly value: string }
  >;
};

interface ProjectionPort {
  getSnapshot(): { readonly count: number };
}

interface CommandPort {
  increment(): Promise<void>;
}

interface EventPort {
  subscribe(listener: () => void): () => void;
}

interface SdkFacade {
  generateText(prompt: string): Promise<{ readonly text: string }>;
}

interface RoutePort {
  current(): string;
  navigate(path: string): void;
}

interface ClockView {
  now(): number;
}

type KitFacade = NimiRendererHostFacadeV1<ShellMethods>;
type CanonicalBindings = NimiCanonicalRendererHostBindingsV1<
  ProjectionPort,
  CommandPort,
  EventPort,
  KitFacade,
  SdkFacade,
  RoutePort,
  ClockView
>;
type CanonicalBindingInput = CreateNimiCanonicalRendererHostBindingsInput<
  ProjectionPort,
  CommandPort,
  EventPort,
  KitFacade,
  SdkFacade,
  RoutePort,
  ClockView
>;

interface CanonicalRendererInstance {
  mount(target: HTMLElement): void;
  dispose(): void;
}

interface CanonicalRendererFactory {
  readonly factoryId: 'fixture.canonical-renderer';
  createInstance(bindings: CanonicalBindings): CanonicalRendererInstance;
}

declare const canonicalFactory: CanonicalRendererFactory;
declare const productionHostInput: CanonicalBindingInput;
declare const alternateHostInput: CanonicalBindingInput;

const productionBindings = createNimiCanonicalRendererHostBindings(productionHostInput);
const alternateBindings = createNimiCanonicalRendererHostBindings(alternateHostInput);
const productionInstance = canonicalFactory.createInstance(productionBindings);
const alternateInstance = canonicalFactory.createInstance(alternateBindings);

type _ProductionBindingIsCanonical = Assert<Equal<typeof productionBindings, CanonicalBindings>>;
type _AlternateBindingIsCanonical = Assert<Equal<typeof alternateBindings, CanonicalBindings>>;
type _ProviderBindingParity = Assert<Equal<typeof productionBindings, typeof alternateBindings>>;
type _ProviderInstanceParity = Assert<Equal<typeof productionInstance, typeof alternateInstance>>;

// @ts-expect-error Canonical UI cannot discriminate the concrete host.
productionBindings.hostKind;
// @ts-expect-error Raw instance identity is not renderer-visible.
alternateBindings.rawInstanceId;

export {};
