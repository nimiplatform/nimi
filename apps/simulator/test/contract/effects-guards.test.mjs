import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installSimulatorEffectGuards,
  resolveEffectAdmission,
  SimulatorEffectForbiddenError,
  SimulatorGuardInstallationError,
} from '../../src/effects/guards.ts';
import {
  assetClassesFromFileList,
  generateSimulatorCsp,
  simulatorCspSatisfiesFloor,
  SIMULATOR_CSP_FLOOR,
} from '../../src/effects/csp.ts';
import { generateEffectCatalog } from '../../build/generate-effect-catalog.mjs';

const catalog = generateEffectCatalog({ write: false });

/** Builds a complete fabricated browser surface from the runtime catalog. */
function fabricateTargetFromCatalog() {
  const target = {};
  for (const row of catalog.effects) {
    if (row.targetKind === 'abstract' || row.classification === 'pure-read') continue;
    const segments = row.targetPath.split('.');
    let holder = target;
    for (const segment of segments.slice(0, -1)) {
      if (segment === 'globalThis') continue;
      if (!holder[segment] || typeof holder[segment] !== 'object') {
        holder[segment] = {};
      }
      holder = holder[segment];
    }
    const key = segments[segments.length - 1];
    if (holder[key] !== undefined) continue;
    if (row.targetKind === 'member-accessor') {
      let stored = row.targetPath.includes('cookie') ? '' : new Map();
      Object.defineProperty(holder, key, {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (next) => { stored = next; },
      });
    } else {
      holder[key] = function stub() { return undefined; };
    }
  }
  return target;
}

function fabricateTarget() {
  const calls = { fetch: 0, beacon: 0, timeout: 0, worker: 0 };
  const target = fabricateTargetFromCatalog();
  const storage = new Map();
  target.fetch = (...args) => { calls.fetch += 1; return ['network', ...args]; };
  Object.defineProperty(target, 'localStorage', {
    configurable: true,
    enumerable: true,
    get: () => storage,
  });
  let cookieValue = '';
  Object.defineProperty(target.document, 'cookie', {
    configurable: true,
    enumerable: true,
    get: () => cookieValue,
    set: (next) => { cookieValue = next; },
  });
  target.navigator.sendBeacon = () => { calls.beacon += 1; return true; };
  target.setTimeout = () => { calls.timeout += 1; return 1; };
  target.Worker = function Worker() { calls.worker += 1; };
  return { target, calls };
}

function catalogWithEffects(effects) {
  return {
    ...catalog,
    effects,
  };
}

function catalogRow(targetPath) {
  const row = catalog.effects.find((entry) => entry.targetPath === targetPath);
  assert.ok(row, `missing catalog row for ${targetPath}`);
  return row;
}

test('catalog is generated from the authority tables with digest binding', () => {
  assert.equal(catalog.schema, 'nimi.simulator.effect-catalog/v1');
  assert.match(catalog.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(catalog.authorityDigests.browserEffects, /^sha256:[0-9a-f]{64}$/);
  assert.match(catalog.authorityDigests.listenerFamilies, /^sha256:[0-9a-f]{64}$/);
  assert.ok(catalog.effects.length > 40);
  assert.deepEqual(
    catalog.listenerFamilies.map((family) => family.id),
    ['keyboard', 'pointer_dismissal', 'focus', 'route_history', 'viewport', 'document_visibility', 'integrity_error'],
  );
});

test('forbidden effects deny governed owners and record evidence', () => {
  const { target, calls } = fabricateTarget();
  const denied = [];
  const handle = installSimulatorEffectGuards({ catalog, target, onDeniedAttempt: (record) => denied.push(record) });
  assert.ok(handle.report.installedGuards.includes('globalThis.fetch'));

  handle.withScope({ owner: 'canonical-renderer', phase: 'render' }, () => {
    assert.throws(() => target.fetch('https://runtime.example'), (error) => error instanceof SimulatorEffectForbiddenError);
  });
  assert.equal(calls.fetch, 0);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].effectId, 'network_fetch');
  assert.equal(denied[0].owner, 'canonical-renderer');
  assert.equal(denied[0].phase, 'render');
  assert.equal(handle.report.deniedAttempts.length, 1);
});

test('storage accessors deny governed owners on get and set', () => {
  const { target } = fabricateTarget();
  const guarded = installSimulatorEffectGuards({ catalog, target });
  guarded.withScope({ owner: 'app-adapter', phase: 'callback' }, () => {
    assert.throws(() => target.localStorage, SimulatorEffectForbiddenError);
  });
  guarded.withScope({ owner: 'app-adapter', phase: 'callback' }, () => {
    assert.throws(() => { target.document.cookie = 'session=1'; }, SimulatorEffectForbiddenError);
  });
});

test('port-only effects deny governed callers and pass through for ungoverned framework code', () => {
  const { target, calls } = fabricateTarget();
  const handle = installSimulatorEffectGuards({ catalog, target });
  handle.withScope({ owner: 'canonical-renderer', phase: 'callback' }, () => {
    assert.throws(() => target.setTimeout(() => {}, 10), SimulatorEffectForbiddenError);
  });
  assert.equal(calls.timeout, 0);
  // Framework/scheduler code runs ungoverned and passes through.
  target.setTimeout(() => {}, 10);
  assert.equal(calls.timeout, 1);
});

test('guards install before any selected module evaluates: late aliases capture only guarded surfaces', () => {
  const { target } = fabricateTarget();
  const handle = installSimulatorEffectGuards({ catalog, target });
  // A selected module evaluated now can only capture the guarded surface.
  const moduleCaptures = { fetch: target.fetch, storage: target.localStorage };
  assert.notEqual(moduleCaptures.fetch, handle.privileged['globalThis.fetch']);
  handle.withScope({ owner: 'selected-dependency', phase: 'module-evaluation' }, () => {
    assert.throws(() => moduleCaptures.fetch('/'), SimulatorEffectForbiddenError);
  });
  // The privileged port binding remains available to Simulator-owned ports.
  assert.equal(typeof handle.privileged['globalThis.fetch'], 'function');
});

test('unguarded framework construction preserves native constructor semantics', () => {
  const target = fabricateTargetFromCatalog();
  class WorkerFixture {
    constructor(value) { this.value = value; }
  }
  target.Worker = WorkerFixture;
  const handle = installSimulatorEffectGuards({ catalog, target });
  const worker = new target.Worker('framework');
  assert.equal(worker.value, 'framework');
  assert.equal(worker instanceof WorkerFixture, true);
  handle.withScope({ owner: 'canonical-renderer', phase: 'callback' }, () => {
    assert.throws(() => new target.Worker('selected'), SimulatorEffectForbiddenError);
  });
});

test('inherited browser descriptors are intercepted at their defining prototype', () => {
  let calls = 0;
  const navigatorPrototype = {};
  Object.defineProperty(navigatorPrototype, 'sendBeacon', {
    configurable: true,
    writable: true,
    value() { calls += 1; return true; },
  });
  const target = { navigator: Object.create(navigatorPrototype) };
  const inheritedCatalog = catalogWithEffects([catalogRow('navigator.sendBeacon')]);
  const handle = installSimulatorEffectGuards({ catalog: inheritedCatalog, target });
  assert.ok(handle.report.installedGuards.includes('navigator.sendBeacon'));
  assert.notEqual(navigatorPrototype.sendBeacon, handle.privileged['navigator.sendBeacon']);
  handle.withScope({ owner: 'canonical-renderer', phase: 'callback' }, () => {
    assert.throws(() => target.navigator.sendBeacon('/'), SimulatorEffectForbiddenError);
  });
  assert.equal(calls, 0);
});

test('unavailable and browser-unforgeable surfaces are explicit static/CSP-only evidence', () => {
  const originalFetch = () => 'native';
  const target = {};
  Object.defineProperty(target, 'fetch', {
    configurable: false,
    writable: false,
    value: originalFetch,
  });
  const staticCatalog = catalogWithEffects([
    catalogRow('globalThis.fetch'),
    catalogRow('globalThis.showOpenFilePicker'),
  ]);
  const handle = installSimulatorEffectGuards({ catalog: staticCatalog, target });
  assert.deepEqual(handle.report.staticOnlySurfaces, [
    { targetPath: 'globalThis.fetch', reason: 'non-configurable' },
    { targetPath: 'globalThis.showOpenFilePicker', reason: 'unavailable' },
  ]);
  assert.equal(target.fetch, originalFetch);
  assert.equal(handle.report.installedGuards.length, 0);
});

test('installation failure rolls back every previously patched descriptor', () => {
  const originalFetch = () => 'native-fetch';
  const beaconHolder = new Proxy({
    sendBeacon() { return true; },
  }, {
    defineProperty() {
      throw new Error('fixture install failure');
    },
  });
  const target = { fetch: originalFetch, navigator: beaconHolder };
  const rollbackCatalog = catalogWithEffects([
    catalogRow('globalThis.fetch'),
    catalogRow('navigator.sendBeacon'),
  ]);
  assert.throws(
    () => installSimulatorEffectGuards({ catalog: rollbackCatalog, target }),
    (error) => error instanceof SimulatorGuardInstallationError
      && error.reason === 'guard-installation-failed:navigator.sendBeacon',
  );
  assert.equal(target.fetch, originalFetch);
});

test('closed-world admission: uncataloged families, owners, and phases fail closed', () => {
  assert.equal(resolveEffectAdmission(catalog, 'network_fetch', 'canonical-renderer', 'render'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'network_fetch', 'simulator-shell', 'bootstrap'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'network_fetch', 'state-engine', 'callback'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'uncataloged_mutable_effect', 'simulator-shell', 'bootstrap'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'uncataloged_mutable_effect', 'canonical-renderer', 'callback'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'timer_scheduling', 'canonical-renderer', 'callback'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'timer_scheduling', 'state-engine', 'instance-lifecycle'), 'allow');
  assert.equal(resolveEffectAdmission(catalog, 'timer_scheduling', 'state-engine', 'render'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'network_fetch', 'unknown-owner', 'callback'), 'deny');
  assert.equal(resolveEffectAdmission(catalog, 'network_fetch', 'canonical-renderer', 'unknown-phase'), 'deny');
});

test('runtime wrappers enforce permitted-owner phases and unknown scoped owners', () => {
  const { target, calls } = fabricateTarget();
  const handle = installSimulatorEffectGuards({ catalog, target });
  handle.withScope({ owner: 'state-engine', phase: 'render' }, () => {
    assert.throws(() => target.setTimeout(() => {}, 1), SimulatorEffectForbiddenError);
  });
  handle.withScope({ owner: 'unknown-owner', phase: 'callback' }, () => {
    assert.throws(() => target.fetch('/'), SimulatorEffectForbiddenError);
  });
  assert.equal(calls.timeout, 0);
  assert.equal(calls.fetch, 0);
});

test('runtime scope is synchronous supplemental evidence, not ambient async attribution', async () => {
  const { target, calls } = fabricateTarget();
  const handle = installSimulatorEffectGuards({ catalog, target });
  assert.deepEqual(handle.report.runtimeScope, {
    coverage: 'synchronous-known-callbacks-only',
    unscopedBehavior: 'framework-passthrough',
    asyncAndModuleEvaluationAuthority: 'authority-derived-static-qualification',
  });
  await handle.withScope({ owner: 'canonical-renderer', phase: 'callback' }, async () => {
    await Promise.resolve();
    target.fetch('/statically-forbidden-source');
  });
  assert.equal(calls.fetch, 1);
  assert.equal(handle.report.deniedAttempts.length, 0);
});

test('guard report binds catalog identity, descriptor shape evidence, and installation order', () => {
  const { target } = fabricateTarget();
  const handle = installSimulatorEffectGuards({ catalog, target });
  assert.equal(handle.report.catalogDigest, catalog.digest);
  assert.ok(Object.keys(handle.report.descriptorShapes).length > 0);
  for (const hash of Object.values(handle.report.descriptorShapes)) {
    assert.match(hash, /^fnv1a:[0-9a-f]{8}$/);
  }
  const fetchIndex = handle.report.installedGuards.indexOf('globalThis.fetch');
  assert.ok(fetchIndex >= 0);
});

test('CSP floor holds and remaining sources follow emitted asset classes', () => {
  const classes = assetClassesFromFileList(['index.html', 'assets/main-abc.js', 'assets/main-abc.css']);
  const policy = generateSimulatorCsp(classes);
  for (const [directive, floor] of Object.entries(SIMULATOR_CSP_FLOOR)) {
    assert.ok(policy.includes(`${directive} ${floor}`), `${directive} floor`);
  }
  assert.equal(simulatorCspSatisfiesFloor(policy), true);
  assert.ok(policy.includes("img-src 'none'"), 'no image assets: img-src none');
  const withImage = generateSimulatorCsp({ script: true, style: true, image: true, font: true, media: false });
  assert.ok(withImage.includes("img-src 'self' data:"));
  assert.ok(withImage.includes("font-src 'self'"));
  const noAssets = generateSimulatorCsp({ script: true, style: true, image: false, font: false, media: false });
  assert.ok(noAssets.includes('img-src \'none\''));
  assert.ok(noAssets.includes('font-src \'none\''));
  const loosened = policy.replace("connect-src 'none'", "connect-src 'self'");
  assert.equal(simulatorCspSatisfiesFloor(loosened), false);
});
