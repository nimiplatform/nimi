export type StudioRunTargetSource = 'local' | 'cloud' | 'unknown';

export type StudioParameterRouteState =
  | { readonly kind: 'supported' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'fixed'; readonly value: string | number };

export type StudioParameterPresentation = {
  readonly field: string;
  readonly state: 'enabled' | 'disabled' | 'fixed';
  readonly fixedValue?: string | number;
  readonly unavailableBecause?: 'route' | 'local-app-surface';
};

export type StudioParameterValue = Readonly<Record<string, unknown>>;
export type StudioParameterState = Readonly<Record<string, StudioParameterValue>>;
export type StudioParameterRouteMatrix = Readonly<Record<
  string,
  Readonly<Record<'local' | 'cloud', StudioParameterRouteState>>
>>;

export type StudioParameterContract = {
  readonly initial: () => StudioParameterValue;
  readonly summarize: (parameters: StudioParameterValue) => Readonly<Record<string, unknown>>;
  readonly hasAlternativeInput: (parameters: StudioParameterValue) => boolean;
  readonly presentation: (source: StudioRunTargetSource) => readonly StudioParameterPresentation[];
  readonly project: (source: StudioRunTargetSource, parameters: StudioParameterValue) => StudioParameterValue;
};

export type TypedStudioParameterContract<TParameters extends object> = {
  readonly initial: () => TParameters;
  readonly summarize?: (parameters: TParameters) => Readonly<Record<string, unknown>>;
  readonly hasAlternativeInput?: (parameters: TParameters) => boolean;
  readonly routeMatrix: StudioParameterRouteMatrix;
};

export const SUPPORTED_STUDIO_PARAMETER = Object.freeze({ kind: 'supported' } as const);
export const UNSUPPORTED_STUDIO_PARAMETER = Object.freeze({ kind: 'unsupported' } as const);
export const LOCAL_AND_CLOUD_STUDIO_PARAMETER = Object.freeze({
  local: SUPPORTED_STUDIO_PARAMETER,
  cloud: SUPPORTED_STUDIO_PARAMETER,
});
export const LOCAL_ONLY_STUDIO_PARAMETER = Object.freeze({
  local: SUPPORTED_STUDIO_PARAMETER,
  cloud: UNSUPPORTED_STUDIO_PARAMETER,
});
export const CLOUD_ONLY_STUDIO_PARAMETER = Object.freeze({
  local: UNSUPPORTED_STUDIO_PARAMETER,
  cloud: SUPPORTED_STUDIO_PARAMETER,
});

export function defineStudioParameters<TParameters extends object>(
  typed: TypedStudioParameterContract<TParameters>,
): StudioParameterContract {
  const initial = () => typed.initial() as StudioParameterValue;
  const summarize = (parameters: StudioParameterValue) => (
    typed.summarize?.(parameters as TParameters) ?? { ...parameters }
  );
  const hasAlternativeInput = (parameters: StudioParameterValue) => (
    typed.hasAlternativeInput?.(parameters as TParameters) ?? false
  );
  const presentation = (source: StudioRunTargetSource) => (
    studioParameterPresentation(typed.routeMatrix, source)
  );
  const project = (source: StudioRunTargetSource, parameters: StudioParameterValue) => (
    projectStudioParameters(typed.routeMatrix, source, parameters)
  );
  return Object.freeze({ initial, summarize, hasAlternativeInput, presentation, project });
}

export const EMPTY_STUDIO_PARAMETERS = defineStudioParameters({
  initial: () => ({}),
  routeMatrix: {},
});

function studioParameterPresentation(
  matrix: StudioParameterRouteMatrix,
  source: StudioRunTargetSource,
): readonly StudioParameterPresentation[] {
  return Object.entries(matrix).map(([field, routes]) => {
    if (source !== 'local' && source !== 'cloud') return { field, state: 'enabled' };
    const routeState = routes[source];
    if (routeState.kind === 'fixed') return { field, state: 'fixed', fixedValue: routeState.value };
    if (routeState.kind === 'supported') return { field, state: 'enabled' };
    const otherRoute = source === 'local' ? routes.cloud : routes.local;
    return {
      field,
      state: 'disabled',
      unavailableBecause: otherRoute.kind === 'unsupported' ? 'local-app-surface' : 'route',
    };
  });
}

function projectStudioParameters(
  matrix: StudioParameterRouteMatrix,
  source: StudioRunTargetSource,
  parameters: StudioParameterValue,
): StudioParameterValue {
  const presentation = new Map(
    studioParameterPresentation(matrix, source).map((item) => [item.field, item]),
  );
  const projected: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(parameters)) {
    if (presentation.get(field)?.state !== 'disabled') projected[field] = value;
  }
  for (const item of presentation.values()) {
    if (item.state === 'fixed') projected[item.field] = item.fixedValue;
  }
  return projected;
}
