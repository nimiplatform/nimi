import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
let buildDir = null;

test.after(async () => {
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
});

async function loadModules() {
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-tester-simulator-persona-'));
  await build({
    entryPoints: [
      path.join(root, 'src/simulator/behavior.ts'),
      path.join(root, 'src/simulator/fixture.ts'),
    ],
    outdir: buildDir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
  });
  const behavior = await import(pathToFileURL(path.join(buildDir, 'behavior.mjs')).href);
  const fixture = await import(pathToFileURL(path.join(buildDir, 'fixture.mjs')).href);
  return { behavior, fixture };
}

const { behavior: { testerSimulatorBehavior }, fixture: { simulatorConformanceFixture } } = await loadModules();

const initialInput = {
  scenarioId: 'tester-persona-test',
  scenarioRevision: '1',
  moduleData: simulatorConformanceFixture.catalog.moduleData,
  sharedProjection: {},
};

const context = { now: 42, drawRandom: () => 0.5 };

const personaPayload = {
  protocolRevision: 1,
  ecosystemRevision: 7,
  interactionId: '1:instance:1:persona-share:2',
  persona: {
    accountId: 'sim-account-linche',
    userId: 'u_7f3a',
    displayName: '林澈',
    role: '生态居民 · 早期体验者',
    realmEnvironmentId: 'sim-realm-env-desktop',
  },
  committedAt: 42,
};

test('tester derives the canonical persona from the shared Scenario projection', () => {
  const initial = testerSimulatorBehavior.initialState({
    ...initialInput,
    sharedProjection: { persona: personaPayload },
  });
  assert.deepEqual(initial.personaReference, personaPayload);
});

test('tester persona.observe commits the persona reference without events', () => {
  const initial = testerSimulatorBehavior.initialState(initialInput);
  const reduced = testerSimulatorBehavior.reduce(
    initial,
    { type: 'tester.persona.observe', payload: personaPayload },
    context,
  );

  assert.deepEqual(reduced.events, []);
  assert.deepEqual(reduced.state.personaReference, personaPayload);
  assert.equal(reduced.state.ecosystemReference, null);

  const projected = testerSimulatorBehavior.project(reduced.state, {
    surfaceId: 'main',
    route: { pathname: '/', search: [], fragment: null },
    sharedProjection: {},
  });
  assert.equal(projected.personaReference.persona.displayName, '林澈');
  assert.equal(projected.personaReference.persona.accountId, 'sim-account-linche');
});

test('tester persona.observe fails closed for malformed payloads', () => {
  const initial = testerSimulatorBehavior.initialState(initialInput);
  assert.throws(
    () => testerSimulatorBehavior.reduce(
      initial,
      { type: 'tester.persona.observe', payload: { ...personaPayload, protocolRevision: 2 } },
      context,
    ),
    /TESTER_SIMULATOR_PERSONA_REFERENCE_INVALID/,
  );
  assert.throws(
    () => testerSimulatorBehavior.reduce(
      initial,
      { type: 'tester.persona.observe', payload: { ...personaPayload, persona: { displayName: '林澈' } } },
      context,
    ),
    /TESTER_SIMULATOR_PERSONA/,
  );
});

test('tester behavior keeps undeclared commands fail-closed', () => {
  const initial = testerSimulatorBehavior.initialState(initialInput);
  assert.throws(
    () => testerSimulatorBehavior.reduce(
      initial,
      { type: 'tester.persona.drop', payload: {} },
      context,
    ),
    /TESTER_SIMULATOR_COMMAND_UNDECLARED/,
  );
});
