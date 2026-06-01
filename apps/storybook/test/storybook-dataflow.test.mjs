import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Round-2 data-flow tests: prove the REAL product loops (not demo) at the
// engine + app-internal store level. Compiles engine/index.ts AND the store
// (both pure TS, no React) and exercises the cross-store wave-11 path, wave-6
// realm persistence, and wave-12 regeneration lifecycle.

const root = path.resolve(import.meta.dirname, '..');

function resolveTsc() {
  const candidates = [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(root, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('Could not locate tsc.');
  return found;
}

let buildDir = null;
function build() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const dir = mkdtempSync(path.join(root, '.tmp', 'dataflow-'));
  execFileSync(process.execPath, [
    resolveTsc(),
    '--outDir', dir, '--rootDir', 'src',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022',
    '--skipLibCheck', 'true', '--strict', 'true', '--noEmit', 'false',
    'src/storybook/engine/index.ts', 'src/storybook/store/storybook-store.ts',
  ], { cwd: root, stdio: 'pipe' });
  buildDir = dir;
  return dir;
}

async function load() {
  const dir = build();
  const engine = await import(pathToFileURL(path.join(dir, 'storybook', 'engine', 'index.js')).href);
  const store = await import(pathToFileURL(path.join(dir, 'storybook', 'store', 'storybook-store.js')).href);
  return { engine, store };
}

const NOW = '2026-06-01T00:00:00.000Z';

test.after(() => {
  if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});

test('wave-11 REAL loop: run-emerged candidate → Studio review query → memory → consumable preference', async () => {
  const { engine, store } = await load();
  const projectId = 'p-dataflow';
  const truth = { ...engine.buildExampleTruthPackage(NOW), projectId };
  store.saveProject({ project: { id: projectId, name: 'T', mode: 'original-scenario', truthPackageId: truth.id, createdAt: NOW, updatedAt: NOW }, truthPackage: truth, memory: engine.createProjectMemory(projectId) });

  // a creator package linked to the project
  const pkgId = 'pkg-dataflow';
  const prepared = engine.buildExamplePreparedPackage(NOW);
  assert.equal(prepared.ok, true);
  const linkedPackage = { ...prepared.value, manifest: { ...prepared.value.manifest, packageId: pkgId } };
  store.saveImportedPackage({ id: pkgId, label: 'creator', source: 'local-import', entryLabel: 'creator-provided', package: linkedPackage, importedAt: NOW, sourceProjectId: projectId });

  // a Play run that produced a REAL candidate from a guarded turn
  const candidate = engine.deriveCandidateFromTurn({ turnId: 't1', targetTruthRef: null, targetObjectFamily: 'feedback-rule', mutationType: 'add-feedback', proposedChange: { playerSteer: '希望更克制', guardedOutput: '（克制的回应）' } });
  const chapter = linkedPackage.playableChapters[0];
  const run = engine.startRun({ projectId, packageId: pkgId, chapter, variables: {}, flags: {}, now: NOW });
  store.saveRun({ packageId: pkgId, run, transcript: engine.createTranscript(run.id), snapshots: [], promotionCandidates: [candidate] });

  // replicate the Studio promotion-review query (link project → packages → runs → candidates)
  const projectPackageIds = new Set(store.listImportedPackages().filter((p) => p.sourceProjectId === projectId).map((p) => p.package.manifest.packageId));
  const runs = store.listRuns().filter((r) => projectPackageIds.has(r.packageId));
  const pending = runs.flatMap((r) => (r.promotionCandidates ?? []).filter((c) => !(r.resolvedCandidateIds ?? []).includes(c.id)));
  assert.equal(pending.length, 1, 'Studio finds the real run-emerged candidate (not a demo)');

  // accept → app-internal memory feedback patch
  const rec = store.getProject(projectId);
  const assessment = engine.assessPromotionCandidateLocally(candidate);
  const decided = engine.enforcePromotionPolicy({ candidate, assessment, proposedDecision: 'auto_accept', now: NOW });
  assert.equal(decided.ok, true);
  const wired = engine.recordAcceptedPromotion(rec.memory, { decision: decided.value.decision, candidate, note: '希望更克制', now: NOW }, rec.truthPackage);
  assert.equal(wired.ok, true);
  assert.equal(wired.value.feedbackPatches.length, 1, 'accepted candidate materializes a feedback patch');

  // the preference is now consumable by future generation (the quality-rises input)
  const prefs = wired.value.feedbackPatches.filter((p) => p.kind === 'preference').map((p) => p.note);
  assert.ok(prefs.some((n) => n.includes('更克制')), 'accepted preference feeds the next generation input');

  // mark resolved → it does not reappear in the review queue
  store.saveRun({ ...store.getRun(run.id), resolvedCandidateIds: [candidate.id] });
  const stillPending = store.listRuns().filter((r) => projectPackageIds.has(r.packageId)).flatMap((r) => (r.promotionCandidates ?? []).filter((c) => !(r.resolvedCandidateIds ?? []).includes(c.id)));
  assert.equal(stillPending.length, 0, 'resolved candidate is not re-surfaced');
});

test('wave-6 persistence: realm imports live on the truth package and gate its validity', async () => {
  const { engine } = await load();
  let pkg = engine.buildExampleTruthPackage(NOW);
  const imported = engine.createImportedRef({ realmRef: engine.makeRealmRef('foggy', 'world-rule', 'w'), realmObjectKind: 'world-rule', realmRelease: '1.0.0' });
  assert.equal(imported.ok, true);
  pkg = engine.addRealmImport(pkg, imported.value, NOW);
  assert.equal(pkg.realmImports.length, 1);
  assert.equal(engine.validateTruthPackage(pkg).valid, true, 'a valid imported_ref keeps the package valid');

  // a malformed adapted_fork persisted on the package makes the package invalid (it participates in validation)
  const badFork = { id: 'ri-bad', state: 'adapted_fork', realmRef: 'realm:n:world-rule:w', realmObjectKind: 'world-rule', realmRelease: '1.0.0', refNamespace: 'n', copyMode: 'copy', conflictStatus: 'local_divergence' };
  const pkg2 = engine.addRealmImport(pkg, badFork, NOW);
  const report = engine.validateTruthPackage(pkg2);
  assert.equal(report.valid, false);
  assert.ok(report.findings.some((f) => f.code === 'realm_world_agent_import_invalid'));
});

test('wave-12 lifecycle: regeneration requests carry a real status (queued → executed/deferred/failed)', async () => {
  const { engine } = await load();
  const pkg = engine.buildExampleTruthPackage(NOW);
  const req = engine.createRegenerationRequest({ pkg, scope: 'bible-slice', targetRef: pkg.bible.ref, reason: 'rework', now: NOW });
  assert.equal(req.ok, true);
  assert.equal(req.value.status, 'queued', 'a fresh request is queued, not done');

  const executed = engine.markRegeneration(req.value, 'executed', 'wrote back', NOW);
  assert.equal(executed.status, 'executed');
  assert.equal(executed.resolvedAt, NOW);

  const deferred = engine.markRegeneration(req.value, 'deferred', 'not wired yet', NOW);
  assert.equal(deferred.status, 'deferred');
  assert.notEqual(deferred.status, 'executed', 'unwired scopes are explicitly deferred, never faked as executed');
});
