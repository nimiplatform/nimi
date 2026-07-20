/**
 * Simulator browser-effect guards: catalog-driven supplemental runtime denial
 * for interceptable browser surfaces, installed before any Shell or
 * effect-capable module evaluates.
 *
 * Authority: P-SIM-018; tables/simulator-browser-effects.yaml;
 * simulator-protocol.md §16.3.
 *
 * Guards are semantic containment, not a hostile-code sandbox: reviewed
 * source, static qualification, CSP, and these guards jointly own the
 * no-real-effects boundary. The runtime scope is intentionally synchronous:
 * framework code (React/scheduler) runs unscoped and passes through, while
 * module evaluation, Promise continuations, and React callbacks are qualified
 * by the authority-derived static source closure rather than a false ambient
 * async context.
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
  readonly stateAuthority: string;
  readonly evidenceId: string;
}

export interface SimulatorEffectCatalog {
  readonly schema: 'nimi.simulator.effect-catalog/v1';
  readonly effects: readonly SimulatorEffectCatalogRow[];
  readonly listenerFamilies: readonly {
    readonly id: string;
    readonly eventTarget: 'document' | 'window';
    readonly eventTypes: readonly string[];
    readonly capture: boolean;
    readonly passive: boolean;
    readonly owner: 'simulator-bootstrap' | 'simulator-shell' | 'kit-coordinator';
    readonly evidenceId: string;
  }[];
  readonly authorityDigests: {
    readonly browserEffects: string;
    readonly listenerFamilies: string;
  };
  readonly digest: string;
}

export interface SimulatorDeniedEffectRecord {
  readonly effectId: string;
  readonly familyId: string;
  readonly owner: string;
  readonly phase: string;
  readonly operation: string;
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

export interface SimulatorGuardReport {
  readonly catalogDigest: string;
  readonly authorityDigests: {
    readonly browserEffects: string;
    readonly listenerFamilies: string;
  };
  readonly installedGuards: readonly string[];
  /** Shape evidence only; browser identity is release-runner evidence. */
  readonly descriptorShapes: Readonly<Record<string, string>>;
  readonly staticOnlySurfaces: readonly {
    readonly targetPath: string;
    readonly reason: 'unavailable' | 'non-configurable';
  }[];
  readonly runtimeScope: {
    readonly coverage: 'synchronous-known-callbacks-only';
    readonly unscopedBehavior: 'framework-passthrough';
    readonly asyncAndModuleEvaluationAuthority: 'authority-derived-static-qualification';
  };
  readonly deniedAttempts: readonly SimulatorDeniedEffectRecord[];
}

export interface SimulatorGuardHandle {
  readonly catalog: SimulatorEffectCatalog;
  readonly report: SimulatorGuardReport;
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

function descriptorShape(descriptor: PropertyDescriptor): string {
  const shape = [
    'value' in descriptor ? typeof descriptor.value : 'accessor',
    String(Boolean(descriptor.writable)),
    String(Boolean(descriptor.enumerable)),
    String(Boolean(descriptor.configurable)),
    typeof descriptor.get,
    typeof descriptor.set,
  ].join('|');
  let hash = 2166136261;
  for (let index = 0; index < shape.length; index += 1) {
    hash ^= shape.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export interface SimulatorGuardInstallOptions {
  readonly catalog: SimulatorEffectCatalog;
  readonly target: Record<string, unknown>;
  readonly onDeniedAttempt?: (record: SimulatorDeniedEffectRecord) => void;
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
 * browser-unforgeable descriptors remain explicit static/CSP-only evidence;
 * an installation failure rolls back every prior mutation before returning.
 */
export function installSimulatorEffectGuards(options: SimulatorGuardInstallOptions): SimulatorGuardHandle {
  const { catalog, target } = options;
  const scopeStack: SimulatorEffectScope[] = [];
  const deniedAttempts: SimulatorDeniedEffectRecord[] = [];
  const installedGuards: string[] = [];
  const descriptorShapes: Record<string, string> = {};
  const staticOnlySurfaces: {
    targetPath: string;
    reason: 'unavailable' | 'non-configurable';
  }[] = [];
  const privileged: Record<string, unknown> = {};

  function currentScope(): SimulatorEffectScope {
    return scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : { owner: null, phase: null };
  }

  function deny(row: SimulatorEffectCatalogRow, operation: string): never {
    const scope = currentScope();
    const record: SimulatorDeniedEffectRecord = {
      effectId: row.id,
      familyId: row.familyId,
      owner: scope.owner ?? 'ungoverned',
      phase: scope.phase ?? 'none',
      operation,
    };
    deniedAttempts.push(record);
    options.onDeniedAttempt?.(record);
    throw new SimulatorEffectForbiddenError(row.id, record.owner, record.phase);
  }

  function decision(row: SimulatorEffectCatalogRow): 'allow' | 'deny' | 'passthrough' {
    const scope = currentScope();
    // React/scheduler and other reviewed framework code intentionally execute
    // outside the synchronous selected-owner scope. This is supplemental
    // runtime evidence, not an ambient async security boundary.
    if (scope.owner === null) return 'passthrough';
    if (scope.phase === null) return 'deny';
    return resolveEffectAdmission(catalog, row.familyId, scope.owner, scope.phase);
  }

  const plans: GuardInstallationPlan[] = [];
  for (const row of catalog.effects) {
    if (row.targetKind === 'abstract' || row.classification === 'pure-read') continue;
    const resolved = resolveTarget(target, row.targetPath);
    if (!resolved) {
      staticOnlySurfaces.push({ targetPath: row.targetPath, reason: 'unavailable' });
      continue;
    }
    const { descriptor } = resolved;
    descriptorShapes[row.targetPath] = descriptorShape(descriptor);
    if (descriptor.configurable === false) {
      staticOnlySurfaces.push({ targetPath: row.targetPath, reason: 'non-configurable' });
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
      installedGuards.push(plan.row.targetPath);
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

  const report: SimulatorGuardReport = {
    catalogDigest: catalog.digest,
    authorityDigests: catalog.authorityDigests,
    installedGuards: Object.freeze(installedGuards.slice()),
    descriptorShapes: Object.freeze({ ...descriptorShapes }),
    staticOnlySurfaces: Object.freeze(staticOnlySurfaces.map((entry) => Object.freeze({ ...entry }))),
    runtimeScope: Object.freeze({
      coverage: 'synchronous-known-callbacks-only' as const,
      unscopedBehavior: 'framework-passthrough' as const,
      asyncAndModuleEvaluationAuthority: 'authority-derived-static-qualification' as const,
    }),
    get deniedAttempts() {
      return deniedAttempts.slice();
    },
  };

  return {
    catalog,
    report,
    privileged: Object.freeze(privileged),
    withScope(scope, run) {
      // Deliberately do not retain scope across a returned Promise. Browser JS
      // has no trustworthy ambient async owner context; static qualification
      // owns those continuations and module evaluation.
      scopeStack.push(scope);
      try {
        return run();
      } finally {
        scopeStack.pop();
      }
    },
    currentScope,
  };
}
