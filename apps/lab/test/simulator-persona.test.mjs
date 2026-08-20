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
  buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-lab-simulator-persona-'));
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

const { behavior: { labSimulatorBehavior }, fixture: { simulatorConformanceFixture } } = await loadModules();

const initialInput = {
  scenarioId: 'lab-persona-test',
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

test('lab derives the canonical persona from the shared Scenario projection', () => {
  const initial = labSimulatorBehavior.initialState({
    ...initialInput,
    sharedProjection: { persona: personaPayload },
  });
  assert.deepEqual(initial.personaReference, personaPayload);
});

test('lab persona.observe commits the persona reference without events', () => {
  const initial = labSimulatorBehavior.initialState(initialInput);
  const reduced = labSimulatorBehavior.reduce(
    initial,
    { type: 'lab.persona.observe', payload: personaPayload },
    context,
  );

  assert.deepEqual(reduced.events, []);
  assert.deepEqual(reduced.state.personaReference, personaPayload);
  assert.equal(reduced.state.ecosystemReference, null);

  const projected = labSimulatorBehavior.project(reduced.state, {
    surfaceId: 'main',
    route: { pathname: '/', search: [], fragment: null },
    sharedProjection: {},
  });
  assert.equal(projected.personaReference.persona.displayName, '林澈');
  assert.equal(projected.personaReference.persona.accountId, 'sim-account-linche');
});

test('lab persona.observe fails closed for malformed payloads', () => {
  const initial = labSimulatorBehavior.initialState(initialInput);
  assert.throws(
    () => labSimulatorBehavior.reduce(
      initial,
      { type: 'lab.persona.observe', payload: { ...personaPayload, protocolRevision: 2 } },
      context,
    ),
    /LAB_SIMULATOR_PERSONA_REFERENCE_INVALID/,
  );
  assert.throws(
    () => labSimulatorBehavior.reduce(
      initial,
      { type: 'lab.persona.observe', payload: { ...personaPayload, persona: { displayName: '林澈' } } },
      context,
    ),
    /LAB_SIMULATOR_PERSONA/,
  );
});

test('lab behavior keeps undeclared commands fail-closed', () => {
  const initial = labSimulatorBehavior.initialState(initialInput);
  assert.throws(
    () => labSimulatorBehavior.reduce(
      initial,
      { type: 'lab.persona.drop', payload: {} },
      context,
    ),
    /LAB_SIMULATOR_COMMAND_UNDECLARED/,
  );
});
