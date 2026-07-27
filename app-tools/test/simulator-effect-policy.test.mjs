import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { assertSimulatorStaticEffects } from '../lib/simulator-static-effects.mjs';

function source(code) {
  return ts.createSourceFile('probe.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

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
