/**
 * Simulator browser-effect guards: catalog-driven supplemental runtime denial
 * for interceptable browser surfaces, installed before any Shell or
 * effect-capable module evaluates.
 *
 * Authority: P-SIM-018; tables/simulator-browser-effects.yaml.
 *
 * Guards are semantic containment, not a hostile-code sandbox: the closed
 * selected-source boundary, typed host ports, CSP, and these guards jointly
 * own the no-real-effects boundary. Calls made with no explicit scope,
 * including reviewed framework code, pass through; an explicitly scoped
 * callback retains its attribution until a returned Promise settles.
 */

export type SimulatorEffectOwner =
  | 'simulator-bootstrap'
  | 'simulator-shell'
  | 'state-engine'
  | 'kit-coordinator'
  | 'kit-primitive'
  | 'sdk-harness'
  | 'app-adapter'
  | 'canonical-renderer'
  | 'selected-dependency';

export type SimulatorEffectPhase =
  | 'bootstrap'
  | 'module-evaluation'
  | 'instance-lifecycle'
  | 'render'
  | 'callback'
  | 'test-only';

export interface SimulatorEffectCatalogRow {
  readonly id: string;
  readonly familyId: string;
  readonly targetPath: string;
  readonly targetKind: 'abstract' | 'constructor' | 'prototype' | 'member-accessor' | 'member-call';
  readonly classification: 'pure-read' | 'port-only' | 'forbidden';
  readonly governedOwners: readonly string[];
  readonly permittedOwners: readonly string[];
  readonly phases: readonly string[];
}

export interface SimulatorEffectCatalog {
  readonly effects: readonly SimulatorEffectCatalogRow[];
  readonly listenerFamilies: readonly {
    readonly id: string;
    readonly eventTarget: 'document' | 'window';
    readonly eventTypes: readonly string[];
    readonly capture: boolean;
    readonly passive: boolean;
    readonly owner: 'simulator-bootstrap' | 'simulator-shell' | 'kit-coordinator';
  }[];
}

export class SimulatorEffectForbiddenError extends Error {
  readonly effectId: string;
  readonly owner: string;
  readonly phase: string;
  constructor(effectId: string, owner: string, phase: string) {
    super(`SIMULATOR_EFFECT_FORBIDDEN:${effectId}`);
    this.name = 'SimulatorEffectForbiddenError';
    this.effectId = effectId;
    this.owner = owner;
    this.phase = phase;
  }
}

export class SimulatorGuardInstallationError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`SIMULATOR_GUARD_INSTALLATION:${reason}`);
    this.name = 'SimulatorGuardInstallationError';
    this.reason = reason;
  }
}

export interface SimulatorEffectScope {
  readonly owner: SimulatorEffectOwner | null;
  readonly phase: SimulatorEffectPhase | null;
}

export interface SimulatorGuardHandle {
  readonly catalog: SimulatorEffectCatalog;
  /** Captured unguarded originals for Simulator-owned port implementations. */
  readonly privileged: Readonly<Record<string, unknown>>;
  withScope<T>(scope: SimulatorEffectScope, run: () => T): T;
  currentScope(): SimulatorEffectScope;
}

interface ResolvedTarget {
  readonly holder: object;
  readonly key: string;
  readonly descriptor: PropertyDescriptor;
}

function resolveTarget(root: Record<string, unknown>, targetPath: string): ResolvedTarget | null {
  const segments = targetPath.split('.');
  if (segments.length < 2) return null;
  let holder: Record<string, unknown> = root;
  for (const segment of segments.slice(0, -1)) {
    let next: unknown;
    try {
      next = holder[segment];
    } catch {
      return null;
    }
    if (next === null || (typeof next !== 'object' && typeof next !== 'function')) {
      if (segment === 'globalThis') continue;
      return null;
    }
    holder = next as Record<string, unknown>;
  }
  const key = segments[segments.length - 1];
  let descriptorHolder: object | null = holder;
  while (descriptorHolder) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptorHolder, key);
    if (descriptor) return { holder: descriptorHolder, key, descriptor };
    descriptorHolder = Object.getPrototypeOf(descriptorHolder) as object | null;
  }
  return null;
}

export interface SimulatorGuardInstallOptions {
  readonly catalog: SimulatorEffectCatalog;
  readonly target: Record<string, unknown>;
}

const KNOWN_EFFECT_OWNERS = new Set<string>([
  'simulator-bootstrap',
  'simulator-shell',
  'state-engine',
  'kit-coordinator',
  'kit-primitive',
  'sdk-harness',
  'app-adapter',
  'canonical-renderer',
  'selected-dependency',
]);

const KNOWN_EFFECT_PHASES = new Set<string>([
  'bootstrap',
  'module-evaluation',
  'instance-lifecycle',
  'render',
  'callback',
  'test-only',
]);

/**
 * Closed-world admission: an effect family is admissible only for the exact
 * cataloged owner/phase tuple. Any uncataloged family, owner, or phase fails
 * closed with `deny`.
 */
export function resolveEffectAdmission(
  catalog: SimulatorEffectCatalog,
  familyId: string,
  owner: string,
  phase: string,
): 'allow' | 'deny' {
  if (!KNOWN_EFFECT_OWNERS.has(owner) || !KNOWN_EFFECT_PHASES.has(phase)) return 'deny';
  const rows = catalog.effects.filter((row) => row.familyId === familyId);
  if (rows.length === 0) return 'deny';
  let ownerIsInFamily = false;
  for (const row of rows) {
    const governed = row.governedOwners.includes(owner);
    const permitted = row.permittedOwners.includes(owner);
    if (!governed && !permitted) continue;
    ownerIsInFamily = true;
    if (row.classification === 'forbidden') {
      if (governed) return 'deny';
      continue;
    }
    if (row.classification === 'port-only') {
      // Governed callers must use the typed port, never the global directly.
      if (governed) return 'deny';
      if (row.phases.length > 0 && !row.phases.includes(phase)) return 'deny';
    }
    if (row.classification === 'pure-read'
      && row.phases.length > 0
      && !row.phases.includes(phase)) return 'deny';
  }
  // Known Simulator/framework owners outside this family's governed scope are
  // not an admitted explicit scope tuple. Framework passthrough is handled
  // separately by decision() only when there is no explicit owner scope.
  if (!ownerIsInFamily) return 'deny';
  return 'allow';
}

interface GuardInstallationPlan {
  readonly row: SimulatorEffectCatalogRow;
  readonly resolved: ResolvedTarget;
  readonly replacement: PropertyDescriptor;
  readonly privilegedValue: unknown;
}

function guardedDescriptor(
  row: SimulatorEffectCatalogRow,
  resolved: ResolvedTarget,
  decide: () => 'allow' | 'deny' | 'passthrough',
  deny: (operation: string) => never,
): { readonly descriptor: PropertyDescriptor; readonly privilegedValue: unknown } {
  const { holder, descriptor } = resolved;
  if (row.targetKind === 'member-accessor') {
    if (!descriptor.get && !descriptor.set) {
      throw new SimulatorGuardInstallationError(`non-accessor-catalog-target:${row.targetPath}`);
    }
    return {
      privilegedValue: { get: descriptor.get, set: descriptor.set },
      descriptor: {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get
          ? function guardedGet(this: unknown) {
              if (decide() === 'deny') deny('get');
              return Reflect.apply(descriptor.get as () => unknown, this ?? holder, []);
            }
          : undefined,
        set: descriptor.set
          ? function guardedSet(this: unknown, next: unknown) {
              if (decide() === 'deny') deny('set');
              Reflect.apply(descriptor.set as (value: unknown) => void, this ?? holder, [next]);
            }
          : undefined,
      },
    };
  }
  const original = descriptor.value;
  if (typeof original !== 'function') {
    throw new SimulatorGuardInstallationError(`non-callable-catalog-target:${row.targetPath}`);
  }
  const guarded = function guardedEffectSurface(this: unknown, ...args: unknown[]) {
    if (decide() === 'deny') {
      deny(row.targetKind === 'constructor' ? 'construct' : 'call');
    }
    if (new.target) return Reflect.construct(original, args, new.target);
    return Reflect.apply(original, this, args);
  };
  Object.defineProperty(guarded, 'name', { value: original.name, configurable: true });
  if (row.targetKind === 'constructor') {
    Object.setPrototypeOf(guarded, original);
    (guarded as { prototype?: unknown }).prototype = (original as { prototype?: unknown }).prototype;
  }
  return {
    privilegedValue: original,
    descriptor: {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      writable: descriptor.writable,
      value: guarded,
    },
  };
}

/**
 * Resolves and validates the complete catalog before mutating any browser
 * descriptor. Only interceptable surfaces are patched. Missing APIs and
 * browser-unforgeable descriptors remain subject to the selected-source
 * boundary and CSP; an installation failure rolls back every prior mutation
 * before returning.
 */
export function installSimulatorEffectGuards(options: SimulatorGuardInstallOptions): SimulatorGuardHandle {
  const { catalog, target } = options;
  const scopeStack: { readonly scope: SimulatorEffectScope }[] = [];
  const privileged: Record<string, unknown> = {};

  function currentScope(): SimulatorEffectScope {
    return scopeStack.length > 0
      ? scopeStack[scopeStack.length - 1].scope
      : { owner: null, phase: null };
  }

  function releaseScope(frame: { readonly scope: SimulatorEffectScope }): void {
    const index = scopeStack.lastIndexOf(frame);
    if (index >= 0) scopeStack.splice(index, 1);
  }

  function scopeDenies(row: SimulatorEffectCatalogRow, scope: SimulatorEffectScope): boolean {
    return scope.phase === null
      || resolveEffectAdmission(catalog, row.familyId, scope.owner ?? '', scope.phase) === 'deny';
  }

  function deny(row: SimulatorEffectCatalogRow, operation: string): never {
    const scope = scopeStack.find((frame) => scopeDenies(row, frame.scope))?.scope
      ?? currentScope();
    void operation;
    throw new SimulatorEffectForbiddenError(
      row.id,
      scope.owner ?? 'ungoverned',
      scope.phase ?? 'none',
    );
  }

  function decision(row: SimulatorEffectCatalogRow): 'allow' | 'deny' | 'passthrough' {
    if (scopeStack.length === 0) return 'passthrough';
    // Browser JavaScript has no trustworthy async-local owner context. While
    // explicit scopes overlap, use their intersection so one admitted frame
    // can never mask a denied frame.
    return scopeStack.some((frame) => scopeDenies(row, frame.scope)) ? 'deny' : 'allow';
  }

  const plans: GuardInstallationPlan[] = [];
  for (const row of catalog.effects) {
    if (row.targetKind === 'abstract' || row.classification === 'pure-read') continue;
    const resolved = resolveTarget(target, row.targetPath);
    if (!resolved) {
      continue;
    }
    const { descriptor } = resolved;
    if (descriptor.configurable === false) {
      continue;
    }
    const replacement = guardedDescriptor(
      row,
      resolved,
      () => decision(row),
      (operation) => deny(row, operation),
    );
    plans.push({
      row,
      resolved,
      replacement: replacement.descriptor,
      privilegedValue: replacement.privilegedValue,
    });
  }

  const installedPlans: GuardInstallationPlan[] = [];
  try {
    for (const plan of plans) {
      Object.defineProperty(plan.resolved.holder, plan.resolved.key, plan.replacement);
      installedPlans.push(plan);
      privileged[plan.row.targetPath] = plan.privilegedValue;
    }
  } catch (error) {
    let rollbackFailure: GuardInstallationPlan | null = null;
    for (const plan of installedPlans.slice().reverse()) {
      try {
        Object.defineProperty(plan.resolved.holder, plan.resolved.key, plan.resolved.descriptor);
      } catch {
        rollbackFailure ??= plan;
      }
    }
    if (rollbackFailure) {
      throw new SimulatorGuardInstallationError(`rollback-failed:${rollbackFailure.row.targetPath}`);
    }
    const failedPlan = plans[installedPlans.length];
    throw new SimulatorGuardInstallationError(
      `guard-installation-failed:${failedPlan?.row.targetPath ?? 'unknown'}`,
    );
  }

  return {
    catalog,
    privileged: Object.freeze(privileged),
    withScope(scope, run) {
      const frame = { scope };
      scopeStack.push(frame);
      try {
        const result = run();
        if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(result).then(
            () => releaseScope(frame),
            () => releaseScope(frame),
          );
          return result;
        }
        releaseScope(frame);
        return result;
      } catch (error) {
        releaseScope(frame);
        throw error;
      }
    },
    currentScope,
  };
}
