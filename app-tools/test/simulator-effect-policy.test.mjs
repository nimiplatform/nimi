import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { SIMULATOR_EFFECT_POLICY } from '../lib/simulator-effect-policy.generated.mjs';
import { assertSimulatorStaticEffects } from '../lib/simulator-static-effects.mjs';

function source(code) {
  return ts.createSourceFile('probe.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function probeFor(surface) {
  if (surface === 'new_Date_without_explicit_value') return 'new Date();';
  if (surface === 'global_aria_state') return 'document.body.setAttribute("aria-hidden", "true");';
  if (surface === 'global_scroll_lock') return 'document.documentElement.style.overflow = "hidden";';
  if (surface === 'portal_into_assigned_overlay_root') {
    return 'import { createPortal } from "react-dom"; createPortal(null, overlayRoot);';
  }
  return `${surface};`;
}

test('generated effect policy binds its source policy identity', () => {
  assert.equal(
    SIMULATOR_EFFECT_POLICY.source.path,
    'config/platform-simulator-browser-effects.yaml',
  );
  assert.equal(
    SIMULATOR_EFFECT_POLICY.source.protocolId,
    'platform_simulator_browser_effects',
  );
  assert.match(SIMULATOR_EFFECT_POLICY.source.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(SIMULATOR_EFFECT_POLICY.entries.length > 0);
});

test('every generated forbidden or port-only target has an executable negative probe', async (context) => {
  for (const entry of SIMULATOR_EFFECT_POLICY.entries) {
    if (entry.classification === 'pure_read') continue;
    for (const surface of entry.surfaces) {
      await context.test(`${entry.id}:${surface}`, () => {
        const owner = entry.governedOwners[0];
        assert.throws(
          () => assertSimulatorStaticEffects(source(probeFor(surface)), 'probe.tsx', owner),
          (error) => error?.code === 'SIMULATOR_EFFECT_FORBIDDEN',
        );
      });
    }
  }
});

test('static effect scan closes computed and alias browser access', async (context) => {
  for (const code of [
    'globalThis["fetch"]("/real");',
    'navigator["sendBeacon"]("/real", "x");',
    'crypto[`randomUUID`]();',
    'const effectName = "sendBeacon"; navigator[effectName]("/real");',
    'const { fetch: realFetch } = globalThis; realFetch("/real");',
    'const browser = navigator; browser.sendBeacon("/real");',
    'function openWith(w = window) { w.open(); }',
    'const holder = { w: window }; holder.w.open();',
    '[window].at(0)?.open();',
    'new globalThis.Date();',
    'globalThis.Date();',
    'Date(0);',
    'const D = Date; new D();',
    'Reflect.construct(Date, []);',
    'globalThis.Math.random();',
  ]) {
    await context.test(code, () => {
      assert.throws(
        () => assertSimulatorStaticEffects(source(code), 'computed.ts', 'canonical_renderer'),
        (error) => [
          'SIMULATOR_EFFECT_FORBIDDEN',
          'SIM_EFFECT_DYNAMIC_BROWSER_ACCESS',
          'SIM_EFFECT_ALIAS_BROWSER_ACCESS',
        ].includes(error?.code),
      );
    });
  }
});

test('catalogued pure reads and explicit Date values remain admitted', () => {
  assert.doesNotThrow(() => assertSimulatorStaticEffects(
    source('element.getBoundingClientRect(); getComputedStyle(element); matchMedia("screen"); new Date(0); new globalThis.Date(0);'),
    'pure.ts',
    'canonical_renderer',
  ));
});
