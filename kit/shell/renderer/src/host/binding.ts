import { createNimiRendererInstanceScope } from './identity.js';
import {
  createNimiRendererHostError,
  normalizeNimiRendererHostResult,
} from './errors.js';
import { createNimiRendererOverlayFacade } from './overlay-facade.js';
import { createNimiReadonlySet } from './readonly-set.js';
import { assertNimiRendererThemeSnapshot } from './theme-store.js';
import {
  NIMI_RENDERER_HOST_PROTOCOL,
  type CreateNimiRendererHostBindingInput,
  type NimiRendererHostBindingV1,
  type NimiRendererHostMethodKey,
  type NimiRendererHostMethodMap,
  type NimiRendererThemeSnapshotV1,
  type NimiRendererThemeViewV1,
} from './types.js';

const METHOD_ID_PATTERN = /^nimi\.shell\.[A-Za-z0-9.-]{1,224}$/u;

export function createNimiRendererHostBinding<
  TMethods extends NimiRendererHostMethodMap,
>(
  input: CreateNimiRendererHostBindingInput<TMethods>,
): NimiRendererHostBindingV1<TMethods> {
  assertExactOwnKeys(input, [
    'capabilities',
    'declaredMethods',
    'localization',
    'opaqueScopePrefix',
    'operations',
    'overlays',
    'surfaceLifecycle',
    'targets',
    'theme',
  ]);
  assertHostDependencies(input);
  assertExactOwnKeys(input.localization, ['direction', 'language', 'locale']);
  assertExactOwnKeys(input.targets, ['overlay', 'renderer']);
  if (input.targets.renderer === input.targets.overlay
    || input.overlays.target !== input.targets.overlay) {
    throw new Error('NIMI_RENDERER_HOST_TARGETS_INVALID');
  }
  if (!isElementTarget(input.targets.renderer) || !isElementTarget(input.targets.overlay)) {
    throw new Error('NIMI_RENDERER_HOST_TARGET_REQUIRED');
  }
  if (!input.localization.locale.trim()
    || !input.localization.language.trim()
    || input.localization.locale !== input.localization.locale.trim()
    || input.localization.language !== input.localization.language.trim()
    || (input.localization.direction !== 'ltr' && input.localization.direction !== 'rtl')) {
    throw new Error('NIMI_RENDERER_HOST_LOCALIZATION_INVALID');
  }
  const theme = createReadOnlyThemeView(input.theme);

  const declaredMethods = createValidatedMethodSet(input.declaredMethods);
  const capabilities = createValidatedMethodSet(input.capabilities);
  for (const method of capabilities) {
    if (!declaredMethods.has(method)) {
      throw new Error('NIMI_RENDERER_HOST_CAPABILITY_UNDECLARED');
    }
  }

  const overlays = createNimiRendererOverlayFacade(input.overlays);
  const surfaceLifecycle = Object.freeze({
    reportReadyCandidate() {
      try {
        input.surfaceLifecycle.reportReadyCandidate();
      } catch {
        throw createNimiRendererHostError('internal', 'surfaceLifecycle.reportReadyCandidate');
      }
    },
  });
  const facade = Object.freeze({
    protocol: NIMI_RENDERER_HOST_PROTOCOL,
    scope: createNimiRendererInstanceScope(input.opaqueScopePrefix),
    capabilities,
    localization: Object.freeze({
      locale: input.localization.locale,
      language: input.localization.language,
      direction: input.localization.direction,
    }),
    theme,
    overlays,
    surfaceLifecycle,
    async invoke<TKey extends NimiRendererHostMethodKey<TMethods>>(
      method: TKey,
      value: Parameters<typeof input.operations.invoke<TKey>>[1],
    ) {
      if (!declaredMethods.has(method)) {
        throw createNimiRendererHostError('invalid-input', method);
      }
      if (!capabilities.has(method)) {
        throw createNimiRendererHostError('capability-denied', method);
      }
      let result;
      try {
        result = normalizeNimiRendererHostResult(await input.operations.invoke(method, value));
      } catch {
        throw createNimiRendererHostError('internal', method);
      }
      if (!result.ok) {
        throw createNimiRendererHostError(result.error.disposition, method);
      }
      return result.value;
    },
  });

  return Object.freeze({
    protocol: NIMI_RENDERER_HOST_PROTOCOL,
    facade,
    targets: Object.freeze({
      renderer: input.targets.renderer,
      overlay: input.targets.overlay,
    }),
  });
}

function assertMethodId(method: string): void {
  if (!METHOD_ID_PATTERN.test(method)) {
    throw new Error('NIMI_RENDERER_HOST_METHOD_ID_INVALID');
  }
}

function createValidatedMethodSet<TMethod extends string>(
  values: Iterable<TMethod>,
): ReadonlySet<TMethod> {
  const collected: TMethod[] = [];
  const seen = new Set<TMethod>();
  for (const method of values) {
    assertMethodId(method);
    if (seen.has(method)) throw new Error('NIMI_RENDERER_HOST_METHOD_DUPLICATE');
    seen.add(method);
    collected.push(method);
  }
  return createNimiReadonlySet(collected);
}

function assertHostDependencies<TMethods extends NimiRendererHostMethodMap>(
  input: CreateNimiRendererHostBindingInput<TMethods>,
): void {
  if (!isRecord(input.operations)
    || typeof input.operations.invoke !== 'function'
    || !isRecord(input.overlays)
    || typeof input.overlays.acquire !== 'function'
    || !isRecord(input.theme)
    || typeof input.theme.getSnapshot !== 'function'
    || typeof input.theme.subscribe !== 'function'
    || !isRecord(input.surfaceLifecycle)
    || typeof input.surfaceLifecycle.reportReadyCandidate !== 'function') {
    throw new Error('NIMI_RENDERER_HOST_DEPENDENCY_INVALID');
  }
}

function createReadOnlyThemeView(source: NimiRendererThemeViewV1): NimiRendererThemeViewV1 {
  let snapshot = readThemeSnapshot(source);
  return Object.freeze({
    getSnapshot(): NimiRendererThemeSnapshotV1 {
      const next = readThemeSnapshot(source);
      if (snapshot.scheme === next.scheme
        && snapshot.accentPack === next.accentPack
        && snapshot.density === next.density) {
        return snapshot;
      }
      snapshot = next;
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      if (typeof listener !== 'function') {
        throw createNimiRendererHostError('invalid-input', 'theme.subscribe');
      }
      let unsubscribe: unknown;
      try {
        unsubscribe = source.subscribe(listener);
      } catch {
        throw createNimiRendererHostError('internal', 'theme.subscribe');
      }
      if (typeof unsubscribe !== 'function') {
        throw createNimiRendererHostError('internal', 'theme.subscribe');
      }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        try {
          unsubscribe();
        } catch {
          throw createNimiRendererHostError('internal', 'theme.unsubscribe');
        }
      };
    },
  });
}

function readThemeSnapshot(source: NimiRendererThemeViewV1): NimiRendererThemeSnapshotV1 {
  try {
    const candidate = source.getSnapshot();
    assertNimiRendererThemeSnapshot(candidate);
    return Object.freeze({
      scheme: candidate.scheme,
      accentPack: candidate.accentPack,
      density: candidate.density,
    });
  } catch {
    throw createNimiRendererHostError('internal', 'theme.getSnapshot');
  }
}

function isElementTarget(value: unknown): value is HTMLElement {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<HTMLElement>;
  return candidate.nodeType === 1
    && typeof candidate.setAttribute === 'function'
    && typeof candidate.removeAttribute === 'function'
    && typeof candidate.contains === 'function';
}

function assertExactOwnKeys(value: unknown, expected: readonly string[]): void {
  if (!isRecord(value)) throw new Error('NIMI_RENDERER_HOST_BINDING_KEYS_INVALID');
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new Error('NIMI_RENDERER_HOST_BINDING_KEYS_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
