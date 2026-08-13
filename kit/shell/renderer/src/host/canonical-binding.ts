import {
  NIMI_RENDERER_HOST_PROTOCOL,
  type AnyNimiCanonicalRendererHostBindingsV1,
  type CreateNimiCanonicalRendererHostBindingsInput,
  type NimiCanonicalRendererHostBindingsV1,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
} from './types.js';

const INPUT_KEYS = [
  'app',
  'capabilities',
  'clock',
  'kit',
  'localization',
  'route',
  'scope',
  'sdk',
  'surfaceLifecycle',
] as const;

const BINDING_KEYS = [...INPUT_KEYS, 'protocol'].sort();
const KIT_FACADE_KEYS = [
  'capabilities',
  'invoke',
  'localization',
  'overlays',
  'protocol',
  'scope',
  'surfaceLifecycle',
  'theme',
] as const;

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-042
export function createNimiCanonicalRendererHostBindings<
  TProjectionPort extends object,
  TCommandPort extends object,
  TEventPort extends object,
  TKitFacade extends object,
  TSdkFacade extends object,
  TRoutePort extends object,
  TClockView extends object,
>(
  input: CreateNimiCanonicalRendererHostBindingsInput<
    TProjectionPort,
    TCommandPort,
    TEventPort,
    TKitFacade,
    TSdkFacade,
    TRoutePort,
    TClockView
  >,
): NimiCanonicalRendererHostBindingsV1<
  TProjectionPort,
  TCommandPort,
  TEventPort,
  TKitFacade,
  TSdkFacade,
  TRoutePort,
  TClockView
> {
  assertRecord(input, 'INPUT');
  assertExactOwnKeys(input, INPUT_KEYS, 'INPUT_KEYS');
  assertRecord(input.app, 'APP');
  assertExactOwnKeys(input.app, ['commands', 'events', 'projection'], 'APP_KEYS');
  assertRecord(input.app.projection, 'APP_PROJECTION');
  assertRecord(input.app.commands, 'APP_COMMANDS');
  assertRecord(input.app.events, 'APP_EVENTS');
  const binding = Object.freeze({
    protocol: NIMI_RENDERER_HOST_PROTOCOL,
    scope: input.scope,
    capabilities: input.capabilities,
    localization: input.localization,
    kit: input.kit,
    sdk: input.sdk,
    app: Object.freeze({
      projection: input.app.projection,
      commands: input.app.commands,
      events: input.app.events,
    }),
    route: input.route,
    clock: input.clock,
    surfaceLifecycle: input.surfaceLifecycle,
  });
  assertNimiCanonicalRendererHostBindings(binding);
  return binding;
}

export function assertNimiCanonicalRendererHostBindings(
  value: unknown,
): asserts value is AnyNimiCanonicalRendererHostBindingsV1 {
  assertRecord(value, 'VALUE');
  assertExactOwnKeys(value, BINDING_KEYS, 'BINDING_KEYS');
  if (value.protocol !== NIMI_RENDERER_HOST_PROTOCOL) {
    fail('PROTOCOL');
  }

  assertScope(value.scope);
  assertReadonlySet(value.capabilities);
  assertLocalization(value.localization);
  assertSurfaceLifecycle(value.surfaceLifecycle);
  assertKitFacade(value.kit);
  assertRecord(value.sdk, 'SDK');
  assertRecord(value.route, 'ROUTE');
  assertRecord(value.clock, 'CLOCK');
  assertRecord(value.app, 'APP');
  assertExactOwnKeys(value.app, ['commands', 'events', 'projection'], 'APP_KEYS');
  assertRecord(value.app.projection, 'APP_PROJECTION');
  assertRecord(value.app.commands, 'APP_COMMANDS');
  assertRecord(value.app.events, 'APP_EVENTS');

  if (value.kit.scope !== value.scope
    || value.kit.capabilities !== value.capabilities
    || value.kit.localization !== value.localization
    || value.kit.surfaceLifecycle !== value.surfaceLifecycle) {
    fail('KIT_ALIAS');
  }
}

function assertScope(value: unknown): void {
  assertRecord(value, 'SCOPE');
  assertExactOwnKeys(value, ['domId', 'globalName'], 'SCOPE_KEYS');
  if (typeof value.domId !== 'function' || typeof value.globalName !== 'function') {
    fail('SCOPE_METHOD');
  }
}

function assertLocalization(value: unknown): void {
  assertRecord(value, 'LOCALIZATION');
  assertExactOwnKeys(value, ['direction', 'language', 'locale'], 'LOCALIZATION_KEYS');
  if (typeof value.locale !== 'string'
    || !value.locale
    || value.locale !== value.locale.trim()
    || typeof value.language !== 'string'
    || !value.language
    || value.language !== value.language.trim()
    || (value.direction !== 'ltr' && value.direction !== 'rtl')) {
    fail('LOCALIZATION');
  }
}

function assertSurfaceLifecycle(value: unknown): void {
  assertRecord(value, 'SURFACE_LIFECYCLE');
  assertExactOwnKeys(value, ['reportReadyCandidate'], 'SURFACE_LIFECYCLE_KEYS');
  if (typeof value.reportReadyCandidate !== 'function') fail('SURFACE_LIFECYCLE_METHOD');
}

function assertKitFacade(
  value: unknown,
): asserts value is NimiRendererHostFacadeV1<NimiRendererHostMethodMap> {
  assertRecord(value, 'KIT');
  assertExactOwnKeys(value, KIT_FACADE_KEYS, 'KIT_KEYS');
  if (value.protocol !== NIMI_RENDERER_HOST_PROTOCOL || typeof value.invoke !== 'function') {
    fail('KIT_PROTOCOL');
  }
  assertRecord(value.theme, 'KIT_THEME');
  assertExactOwnKeys(value.theme, ['getSnapshot', 'subscribe'], 'KIT_THEME_KEYS');
  if (typeof value.theme.getSnapshot !== 'function' || typeof value.theme.subscribe !== 'function') {
    fail('KIT_THEME');
  }
  assertRecord(value.overlays, 'KIT_OVERLAYS');
  assertExactOwnKeys(value.overlays, ['acquire', 'target'], 'KIT_OVERLAYS_KEYS');
  if (typeof value.overlays.acquire !== 'function') fail('KIT_OVERLAYS');
}

function assertReadonlySet(value: unknown): asserts value is ReadonlySet<string> {
  assertRecord(value, 'CAPABILITIES');
  const candidate = value as Record<PropertyKey, unknown>;
  if (typeof candidate.size !== 'number'
    || !Number.isSafeInteger(candidate.size)
    || candidate.size < 0
    || typeof candidate.has !== 'function'
    || typeof candidate.values !== 'function'
    || typeof candidate[Symbol.iterator] !== 'function'
    || 'add' in candidate
    || 'delete' in candidate
    || 'clear' in candidate) {
    fail('CAPABILITIES');
  }
  for (const capability of value as unknown as ReadonlySet<unknown>) {
    if (typeof capability !== 'string' || !capability) fail('CAPABILITY_VALUE');
  }
}

function assertRecord(value: unknown, suffix: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(suffix);
}

function assertExactOwnKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  suffix: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    fail(suffix);
  }
}

function fail(suffix: string): never {
  throw new Error(`NIMI_RENDERER_HOST_CANONICAL_BINDING_${suffix}_INVALID`);
}
