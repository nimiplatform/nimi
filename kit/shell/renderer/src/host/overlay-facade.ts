import {
  createNimiRendererHostError,
  hostFailure,
  normalizeNimiRendererHostResult,
} from './errors.js';
import type {
  NimiRendererHostResult,
  NimiRendererOverlayDismissReason,
  NimiRendererOverlayLease,
  NimiRendererOverlayLeaseState,
  NimiRendererOverlayNodeRegistration,
  NimiRendererOverlayOptions,
  NimiRendererOverlayPort,
} from './types.js';

const LEASE_STATES = new Set<string>([
  'open',
  'dismiss-requested',
  'releasing',
  'released',
]);

export function createNimiRendererOverlayFacade(
  source: NimiRendererOverlayPort,
): NimiRendererOverlayPort {
  const leases = new WeakMap<NimiRendererOverlayLease, NimiRendererOverlayLease>();
  return Object.freeze({
    target: source.target,
    async acquire(options: NimiRendererOverlayOptions) {
      if (!validOptions(options)) return hostFailure<NimiRendererOverlayLease>('invalid-input');
      try {
        const result = normalizeNimiRendererHostResult(await source.acquire(options));
        if (!result.ok) return result;
        if (!validLease(result.value)) return hostFailure<NimiRendererOverlayLease>('internal');
        const existing = leases.get(result.value);
        if (existing) return Object.freeze({ ok: true as const, value: existing });
        const lease = wrapLease(result.value);
        leases.set(result.value, lease);
        return Object.freeze({ ok: true as const, value: lease });
      } catch {
        return hostFailure<NimiRendererOverlayLease>('internal');
      }
    },
  });
}

function wrapLease(source: NimiRendererOverlayLease): NimiRendererOverlayLease {
  return Object.freeze({
    state(): NimiRendererOverlayLeaseState {
      try {
        const state = source.state();
        if (LEASE_STATES.has(state)) return state;
      } catch {
        // Project below.
      }
      throw createNimiRendererHostError('internal', 'overlay.state');
    },
    registerNodes(nodes: NimiRendererOverlayNodeRegistration) {
      if (!validNodes(nodes)) {
        return hostFailure<{ readonly registered: boolean }>('invalid-input');
      }
      try {
        const result = normalizeNimiRendererHostResult(source.registerNodes(nodes));
        return validBooleanResult(result, 'registered');
      } catch {
        return hostFailure<{ readonly registered: boolean }>('internal');
      }
    },
    subscribeDismiss(listener: (reason: NimiRendererOverlayDismissReason) => void) {
      if (typeof listener !== 'function') return hostFailure<() => void>('invalid-input');
      try {
        const result = normalizeNimiRendererHostResult(source.subscribeDismiss(listener));
        if (!result.ok) return result;
        if (typeof result.value !== 'function') return hostFailure<() => void>('internal');
        let subscribed = true;
        return Object.freeze({
          ok: true as const,
          value: () => {
            if (!subscribed) return;
            subscribed = false;
            try {
              result.value();
            } catch {
              throw createNimiRendererHostError('internal', 'overlay.unsubscribeDismiss');
            }
          },
        });
      } catch {
        return hostFailure<() => void>('internal');
      }
    },
    async requestDismiss(reason: 'app') {
      if (reason !== 'app') return hostFailure<{ readonly requested: boolean }>('invalid-input');
      try {
        const result = normalizeNimiRendererHostResult(await source.requestDismiss(reason));
        return validBooleanResult(result, 'requested');
      } catch {
        return hostFailure<{ readonly requested: boolean }>('internal');
      }
    },
    async acknowledgeContentUnmounted() {
      try {
        const result = normalizeNimiRendererHostResult(
          await source.acknowledgeContentUnmounted(),
        );
        return validBooleanResult(result, 'released');
      } catch {
        return hostFailure<{ readonly released: boolean }>('internal');
      }
    },
  });
}

function validBooleanResult<TKey extends 'registered' | 'requested' | 'released'>(
  result: NimiRendererHostResult<Readonly<Record<TKey, boolean>>>,
  key: TKey,
): NimiRendererHostResult<Readonly<Record<TKey, boolean>>> {
  if (!result.ok) return result;
  return isExactRecord(result.value, [key]) && typeof result.value[key] === 'boolean'
    ? Object.freeze({
      ok: true as const,
      value: Object.freeze({ [key]: result.value[key] }) as Readonly<Record<TKey, boolean>>,
    })
    : hostFailure('internal');
}

function validLease(value: unknown): value is NimiRendererOverlayLease {
  if (!isExactRecord(value, [
    'acknowledgeContentUnmounted',
    'registerNodes',
    'requestDismiss',
    'state',
    'subscribeDismiss',
  ])) return false;
  const candidate = value as Partial<NimiRendererOverlayLease>;
  return typeof candidate.state === 'function'
    && typeof candidate.registerNodes === 'function'
    && typeof candidate.subscribeDismiss === 'function'
    && typeof candidate.requestDismiss === 'function'
    && typeof candidate.acknowledgeContentUnmounted === 'function';
}

function validOptions(value: unknown): value is NimiRendererOverlayOptions {
  const expected = [
    'ariaLabel', 'dismissOnEscape', 'dismissOnOutsidePointer', 'initialFocusSemanticId',
    'kind', 'modal', 'returnFocus', 'returnFocusSemanticId', 'scrollLock',
  ];
  return isExactRecord(value, expected)
    && typeof value.kind === 'string'
    && ['dialog', 'popover', 'menu', 'tooltip'].includes(value.kind)
    && typeof value.modal === 'boolean'
    && typeof value.dismissOnEscape === 'boolean'
    && typeof value.dismissOnOutsidePointer === 'boolean'
    && typeof value.returnFocus === 'boolean'
    && validSemanticId(value.initialFocusSemanticId)
    && validSemanticId(value.returnFocusSemanticId)
    && (value.scrollLock === 'none' || value.scrollLock === 'simulator-root')
    && (value.modal || value.scrollLock === 'none')
    && typeof value.ariaLabel === 'string'
    && value.ariaLabel === value.ariaLabel.trim()
    && value.ariaLabel.length > 0
    && value.ariaLabel.length <= 256;
}

function validNodes(value: unknown): value is NimiRendererOverlayNodeRegistration {
  if (!isExactRecord(value, [
    'content',
    'fallbackFocus',
    'initialFocus',
    'returnFocus',
    'trigger',
  ])) return false;
  return isElementTarget(value.content)
    && nullableElementTarget(value.trigger)
    && nullableElementTarget(value.initialFocus)
    && nullableElementTarget(value.fallbackFocus)
    && nullableElementTarget(value.returnFocus);
}

function nullableElementTarget(value: unknown): value is HTMLElement | null {
  return value === null || isElementTarget(value);
}

function isElementTarget(value: unknown): value is HTMLElement {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HTMLElement>;
  return candidate.nodeType === 1
    && typeof candidate.contains === 'function'
    && typeof candidate.getAttribute === 'function'
    && typeof candidate.setAttribute === 'function';
}

function validSemanticId(value: unknown): value is string | null {
  return value === null
    || (typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(value));
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
