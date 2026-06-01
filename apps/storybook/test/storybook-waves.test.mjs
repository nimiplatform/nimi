import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// Wave gap coverage: waves 4, 6, 7, 8, 9, 10, 11, 12, 13. Compiles the pure-TS
// engine with tsc (NodeNext) and imports the output — same approach as
// storybook-engine.test.mjs, doubling as a typecheck of the new modules.

const root = path.resolve(import.meta.dirname, '..');

function resolveTsc() {
  const candidates = [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(root, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Could not locate the local typescript compiler.');
  return found;
}

let engineBuildDir = null;
function buildEngine() {
  if (engineBuildDir) return engineBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const dir = mkdtempSync(path.join(root, '.tmp', 'waves-'));
  execFileSync(process.execPath, [
    resolveTsc(),
    '--outDir', dir, '--rootDir', 'src',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022',
    '--skipLibCheck', 'true', '--strict', 'true', '--noEmit', 'false',
    'src/storybook/engine/index.ts',
  ], { cwd: root, stdio: 'pipe' });
  engineBuildDir = dir;
  return dir;
}

async function importEngine() {
  const dir = buildEngine();
  return import(pathToFileURL(path.join(dir, 'storybook', 'engine', 'index.js')).href);
}

const NOW = '2026-06-01T00:00:00.000Z';

test.after(() => {
  if (engineBuildDir) rmSync(engineBuildDir, { recursive: true, force: true });
});

test('wave-4: projection freshness, drift, and refresh are explicit', async () => {
  const engine = await importEngine();
  const pkg = engine.buildExampleTruthPackage(NOW);
  // fresh out of the box
  assert.deepEqual(engine.validateProjectionFreshness(pkg), []);
  // an authority bump marks projections stale (explicit, surfaced)
  const bumped = engine.bumpVersion(pkg, NOW);
  const staleFindings = engine.validateProjectionFreshness(bumped);
  assert.ok(staleFindings.some((f) => f.code === 'projection_stale'), 'stale projection is surfaced');
  // refresh acknowledges the rebuild
  assert.deepEqual(engine.validateProjectionFreshness(engine.refreshProjectionInputs(bumped)), []);
  // a projection governing a ref absent from authority is drift
  const drifted = engine.addProjectionInput(pkg, { projectionType: 'play', governingTruthRefs: ['truth:example-foggy-harbor:world-rule:ghost'], validationStatus: 'valid' });
  assert.ok(engine.validateProjectionDrift(drifted).some((f) => f.code === 'projection_introduces_unbacked_rule'));
});

test('wave-6: realm imports/forks and run-state promotion is forbidden', async () => {
  const engine = await importEngine();
  const realmRef = engine.makeRealmRef('foggy', 'world-rule', 'w1');
  assert.equal(engine.isRealmRef(realmRef), true);

  const imported = engine.createImportedRef({ realmRef, realmObjectKind: 'world-rule', realmRelease: '1.0.0' });
  assert.equal(imported.ok, true);
  assert.equal(imported.value.state, 'imported_ref');
  // stale-ref detection
  assert.ok(engine.validateRealmImport(imported.value, '2.0.0').some((f) => f.code === 'realm_imported_ref_stale'));
  assert.deepEqual(engine.validateRealmImport(imported.value, '1.0.0'), []);

  const fork = engine.createAdaptedFork({ realmRef, realmObjectKind: 'world-rule', realmRelease: '1.0.0', originTruthRef: engine.makeTruthRef('p1', 'world-rule', 'x'), divergenceReason: '本地剧情需要', currentPackageVersion: 1 });
  assert.equal(fork.ok, true);
  assert.equal(fork.value.localPrecedence, true);

  // run/transcript state can never be promoted into Realm
  assert.equal(engine.isRunStateRef('run_abc'), true);
  assert.equal(engine.isRunStateRef('turn:1'), true);
  assert.equal(engine.isRunStateRef(engine.makeTruthRef('p1', 'world-rule', 'x')), false);
  const fromRun = engine.createRealmPromotionRequest({
    targetRealmObject: { kind: 'world-rule', ref: realmRef }, mutationType: 'update',
    sourceTruthRefs: ['turn:42'], evidenceRefs: [], authority: 'realm-reviewer', note: 'x', now: NOW,
  });
  assert.equal(fromRun.ok, false);
  assert.equal(fromRun.code, 'realm_run_state_promotion_forbidden');
  // a clean authority-sourced handshake is allowed
  const clean = engine.createRealmPromotionRequest({
    targetRealmObject: { kind: 'world-rule', ref: realmRef }, mutationType: 'update',
    sourceTruthRefs: [engine.makeTruthRef('p1', 'world-rule', 'x')], evidenceRefs: ['evid-1'], authority: 'realm-reviewer', note: 'ok', now: NOW,
  });
  assert.equal(clean.ok, true);
});

test('wave-7: adaptation brief stays spoiler-safe; divergence backs a bible claim', async () => {
  const engine = await importEngine();
  const goodBrief = { ref: engine.makeTruthRef('p1', 'adaptation-brief', 'b'), title: 't', premiseSummary: '前提', playerPerspective: '第一人称', coreTension: '张力', targetMilestone: '第一章', stylePlan: '写实', pacingPlan: '中速', endingDirection: '朝真相推进', approval: 'approved' };
  assert.deepEqual(engine.validateAdaptationBrief(goodBrief), []);
  assert.equal(engine.isAdaptationConfirmed(goodBrief), true);
  assert.equal(engine.isAdaptationConfirmed({ ...goodBrief, approval: 'pending' }), false);
  // a spoiler leak is caught
  const leaky = { ...goodBrief, endingDirection: '当 flag == true 时进入 endingId end-secret' };
  assert.ok(engine.validateAdaptationBrief(leaky).some((f) => f.code === 'adaptation_spoiler_leak'));

  // divergence backs the bible when there is no evidence/derivation
  const pkg = engine.buildExampleTruthPackage(NOW);
  const unbacked = { ...pkg, evidence: [], derivations: [] };
  assert.ok(engine.validateTruthPackage(unbacked).findings.some((f) => f.code === 'bible_validation_failed'), 'unbacked approved bible fails');
  const withDivergence = { ...unbacked, divergences: [{ id: 'd1', targetRef: pkg.bible.ref, reason: '原创改编', approvedBy: 'author', at: NOW }] };
  assert.ok(!engine.validateTruthPackage(withDivergence).findings.some((f) => f.code === 'bible_validation_failed'), 'divergence backs the claim');
});

test('wave-8: guarded turn pipeline writes spine only on approval/adjust', async () => {
  const engine = await importEngine();
  const context = { runId: 'r1', turnRef: 't1', scopes: { canon: ['风格'], story: ['章节'], subject: [], relation: [] }, governingTruthRefs: [] };
  const request = { id: 'req1', runId: 'r1', agentId: 'a1', trigger: 'free-text', userText: 'hi' };
  const envelope = engine.createRunEnvelope({ runId: 'r1', projectId: 'p1', packageVersion: 1 });

  const approved = await engine.processTurn({
    request, context, envelope,
    generate: () => ({ ok: true, candidate: { spineEvents: [{ id: 's1', kind: 'narration', text: '雾更浓了' }], stateChanges: [], metrics: {} } }),
  });
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.envelope.spine.events.length, 1);

  // context insufficient -> rejected, no spine
  const insufficient = await engine.processTurn({
    request, context: { ...context, scopes: { canon: [], story: [], subject: [], relation: [] } }, envelope,
    generate: () => ({ ok: true, candidate: { spineEvents: [], stateChanges: [], metrics: {} } }),
  });
  assert.equal(insufficient.status, 'REJECTED');
  assert.equal(insufficient.reasonCode ?? insufficient.record.reasonCode, 'narrative_context_insufficient');
  assert.equal(insufficient.envelope.spine.events.length, 0);

  // private-fact leak -> rejected
  const leak = await engine.processTurn({
    request, context, envelope, privateFacts: ['内部掩盖'],
    generate: () => ({ ok: true, candidate: { spineEvents: [{ id: 's', kind: 'dialogue', text: '其实这是内部掩盖' }], stateChanges: [], metrics: {} } }),
  });
  assert.equal(leak.status, 'REJECTED');
  assert.equal(leak.envelope.spine.events.length, 0);

  // append write conflict
  const spine = engine.createSpine('r1');
  const conflict = engine.appendSpine(spine, [{ id: 'x', kind: 'narration', text: 'y' }], 5);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'narrative_spine_write_conflict');

  // generation failure -> rejected, recorded, no spine
  const genFail = await engine.processTurn({
    request, context, envelope,
    generate: () => ({ ok: false, reason: 'ai-binding-missing', message: 'no binding' }),
  });
  assert.equal(genFail.status, 'REJECTED');
  assert.equal(genFail.record.coreOutput, null);
});

test('wave-9: generation batch schedules, retries, and never fakes an artifact', async () => {
  const engine = await importEngine();
  const created = engine.createGenerationBatch({ projectId: 'p1', items: [{ kind: 'image', targetRef: 'asset:1', maxAttempts: 2 }], now: NOW });
  assert.equal(created.ok, true);
  let batch = created.value;
  const itemId = batch.items[0].id;

  let r = engine.startItem(batch, itemId, 'genrun_1', NOW); assert.equal(r.ok, true); batch = r.value;
  assert.equal(batch.items[0].state, 'running');
  // completing with no artifact is NOT success
  const noArtifact = engine.completeItem(batch, itemId, '', NOW);
  assert.equal(noArtifact.ok, false);
  assert.equal(noArtifact.code, 'artifact_missing');
  // fail -> retry -> fail -> retry exhausted
  r = engine.failItem(batch, itemId, 'timeout', NOW); batch = r.value;
  r = engine.retryItem(batch, itemId, NOW); assert.equal(r.ok, true); batch = r.value;
  r = engine.startItem(batch, itemId, 'genrun_2', NOW); batch = r.value;
  r = engine.failItem(batch, itemId, 'timeout', NOW); batch = r.value;
  const exhausted = engine.retryItem(batch, itemId, NOW);
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.code, 'generation_retry_exhausted');
  // a fresh batch can complete with a real artifact
  const ok2 = engine.createGenerationBatch({ projectId: 'p1', items: [{ kind: 'text', targetRef: 'scope:bible' }], now: NOW }).value;
  const started = engine.startItem(ok2, ok2.items[0].id, 'genrun_3', NOW).value;
  const done = engine.completeItem(started, ok2.items[0].id, 'artifact://x', NOW);
  assert.equal(done.ok, true);
  assert.equal(engine.batchProgress(done.value).succeeded, 1);
  assert.equal(done.value.status, 'completed');
});

test('wave-10: route conditions, chapter switch, achievements, checkpoints, ending closure', async () => {
  const engine = await importEngine();
  const baseRun = engine.startRun({ projectId: 'p1', packageId: 'pkg1', chapter: { ref: engine.makeTruthRef('p1', 'chapter', 'ch1'), id: 'ch1', title: 'c', startNodeId: 'n1', nodes: [{ id: 'n1', chapterId: 'ch1', text: 't', choices: [] }] }, variables: { clues: 1 }, flags: { door: true }, now: NOW });

  assert.equal(engine.evaluateRouteCondition(baseRun, 'clues >= 1').value, true);
  assert.equal(engine.evaluateRouteCondition(baseRun, 'door == true').value, true);
  assert.equal(engine.evaluateRouteCondition(baseRun, '').value, true);
  assert.equal(engine.evaluateRouteCondition(baseRun, 'unknownVar > 0').ok, false);

  const ch2 = { ref: engine.makeTruthRef('p1', 'chapter', 'ch2'), id: 'ch2', title: 'c2', startNodeId: 'm1', nodes: [{ id: 'm1', chapterId: 'ch2', text: 't2', choices: [] }] };
  const topology = { ref: engine.makeTruthRef('p1', 'branch-topology', 'topo'), startChapterId: 'ch1', chapterIds: ['ch1', 'ch2'], routes: [{ fromChapterId: 'ch1', toChapterId: 'ch2', condition: 'clues >= 1' }], switchPoints: [] };
  const switched = engine.switchChapter({ run: baseRun, topology, targetChapter: ch2, now: NOW });
  assert.equal(switched.ok, true);
  assert.equal(switched.value.chapterId, 'ch2');
  // no route -> invalid
  const noRoute = engine.switchChapter({ run: baseRun, topology: { ...topology, routes: [] }, targetChapter: ch2, now: NOW });
  assert.equal(noRoute.ok, false);
  assert.equal(noRoute.code, 'branch_switch_invalid');

  const matrix = { ref: engine.makeTruthRef('p1', 'state-ending-matrix', 'm'), variables: [], flags: [], endings: [{ id: 'e1', label: 'E', reachableFromChapterId: 'ch1' }], achievements: [{ id: 'a1', label: 'A' }] };
  const awarded = engine.awardAchievement(baseRun, 'a1', matrix, NOW);
  assert.equal(awarded.ok, true);
  assert.deepEqual(awarded.value.achievements, ['a1']);
  assert.equal(engine.awardAchievement(baseRun, 'nope', matrix, NOW).ok, false);

  // ending-closure: a declared ending without a closure node fails
  const noClosure = engine.validateEndingClosure(matrix, [{ ref: engine.makeTruthRef('p1', 'chapter', 'ch1'), id: 'ch1', title: 'c', startNodeId: 'n1', nodes: [{ id: 'n1', chapterId: 'ch1', text: 't', choices: [] }] }]);
  assert.ok(noClosure.some((f) => f.code === 'ending_closure_missing'));

  // example: traversal awards the achievement end-to-end, and endings have closure
  const pkg = engine.buildExampleTruthPackage(NOW);
  assert.deepEqual(engine.validateEndingClosure(pkg.stateEndingMatrix, pkg.chapters), []);
  const chapter = pkg.chapters[0];
  let run = engine.startRun({ projectId: pkg.projectId, packageId: 'pkg', chapter, variables: { clues: 0 }, flags: {}, now: NOW });
  const toN2 = engine.applyChoice(run, chapter, chapter.nodes[0].choices[0], NOW); run = toN2.value; // n1 -> n2
  const collect = engine.applyChoice(run, chapter, engine.findNode(chapter, 'n2').choices[0], NOW); run = collect.value; // n2 -> nEnd (awards)
  assert.ok(run.achievements.includes('first-clue'), 'achievement awarded during traversal');
  assert.equal(run.status, 'ended');
});

test('wave-11: candidate derivation, conservative assessor, memory wiring', async () => {
  const engine = await importEngine();
  // a change to an ending is a protected class -> never auto_accept
  const endingCandidate = engine.deriveCandidateFromTurn({ turnId: 't1', targetTruthRef: null, targetObjectFamily: 'state-ending-matrix', mutationType: 'update', proposedChange: {} });
  assert.ok(endingCandidate.protectedClasses.includes('ending'));
  assert.deepEqual(endingCandidate.sourceRefs, ['turn:t1']);
  const protAssessment = engine.assessPromotionCandidateLocally(endingCandidate);
  assert.notEqual(protAssessment.recommendedOutcome, 'auto_accept');

  // an unprotected feedback candidate can be recommended auto_accept
  const feedbackCandidate = engine.deriveCandidateFromTurn({ turnId: 't2', targetTruthRef: null, targetObjectFamily: 'feedback-rule', mutationType: 'add-feedback', proposedChange: {} });
  const okAssessment = engine.assessPromotionCandidateLocally(feedbackCandidate);
  assert.equal(okAssessment.recommendedOutcome, 'auto_accept');
  const decision = engine.enforcePromotionPolicy({ candidate: feedbackCandidate, assessment: okAssessment, proposedDecision: 'auto_accept', now: NOW });
  assert.equal(decision.ok, true);

  // accepted add-feedback materializes app-internal memory
  const pkg = engine.buildExampleTruthPackage(NOW);
  const memory = engine.createProjectMemory(pkg.projectId);
  const wired = engine.recordAcceptedPromotion(memory, { decision: decision.value.decision, candidate: feedbackCandidate, now: NOW }, pkg);
  assert.equal(wired.ok, true);
  assert.equal(wired.value.feedbackPatches.length, 1);
  assert.ok(wired.value.promotionRecordRefs.includes(decision.value.decision.id));
});

test('wave-12: edit conflict, undo/redo lineage, scoped regeneration', async () => {
  const engine = await importEngine();
  const pkg = engine.buildExampleTruthPackage(NOW);
  let log = engine.createEditLog(pkg.projectId);

  const edit = engine.applyEdit({
    pkg, log,
    edit: { targetRef: pkg.bible.ref, targetKind: 'bible', operation: 'update-text', before: pkg.bible.worldSummary, after: '新的世界概述', baseVersion: pkg.version, note: 'tweak' },
    mutate: (p) => ({ ...p, bible: { ...p.bible, worldSummary: '新的世界概述' } }),
    now: NOW,
  });
  assert.equal(edit.ok, true);
  assert.equal(edit.value.pkg.bible.worldSummary, '新的世界概述');
  assert.equal(edit.value.pkg.version, pkg.version + 1);
  assert.equal(edit.value.log.operations.length, 1);

  // stale baseVersion -> conflict
  const conflict = engine.applyEdit({
    pkg: edit.value.pkg, log: edit.value.log,
    edit: { targetRef: pkg.bible.ref, targetKind: 'bible', operation: 'update-text', before: '', after: 'x', baseVersion: pkg.version, note: 'stale' },
    mutate: (p) => p, now: NOW,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'edit_conflict');

  // undo restores the prior package
  const undone = engine.undoEdit(edit.value.log, edit.value.pkg);
  assert.equal(undone.pkg.bible.worldSummary, pkg.bible.worldSummary);
  const redone = engine.redoEdit(undone.log, undone.pkg);
  assert.equal(redone.pkg.bible.worldSummary, '新的世界概述');

  // regeneration scopes are validated
  const badScope = engine.createRegenerationRequest({ pkg, scope: 'galaxy', targetRef: pkg.bible.ref, reason: 'x', now: NOW });
  assert.equal(badScope.ok, false);
  assert.equal(badScope.code, 'regeneration_scope_invalid');
  const badTarget = engine.createRegenerationRequest({ pkg, scope: 'node', targetRef: 'does-not-exist', reason: 'x', now: NOW });
  assert.equal(badTarget.ok, false);
  const okRegen = engine.createRegenerationRequest({ pkg, scope: 'chapter', targetRef: pkg.chapters[0].id, reason: 'rework', now: NOW });
  assert.equal(okRegen.ok, true);
});

test('wave-13: cross-product diagnostics, taxonomy, observability', async () => {
  const engine = await importEngine();
  const pkg = engine.buildExampleTruthPackage(NOW);
  const prepared = engine.buildExamplePreparedPackage(NOW);
  assert.equal(prepared.ok, true);

  const report = engine.runFullDiagnostics({
    pkg,
    preparedPackages: [prepared.value],
    generationRuns: [
      { id: 'g1', kind: 'text', provenance: { status: 'unavailable', reason: 'ai-binding-missing' } },
      { id: 'g2', kind: 'image', provenance: { status: 'succeeded' } },
    ],
  });
  assert.equal(report.ok, true, JSON.stringify(engine.flattenDiagnostics(report)));
  assert.equal(report.generationObservability.unavailable, 1);
  assert.equal(report.generationObservability.succeeded, 1);
  assert.equal(report.generationObservability.reasonHistogram['ai-binding-missing'], 1);
  assert.ok(report.provenanceAudit && report.provenanceAudit.refsWithEvidence >= 1);

  // a bad realm import fails the aggregate report
  const badImport = { id: 'ri1', state: 'adapted_fork', realmRef: 'realm:n:world-rule:w', realmObjectKind: 'world-rule', realmRelease: '1.0.0', refNamespace: 'n', copyMode: 'copy', conflictStatus: 'local_divergence' };
  const failing = engine.runFullDiagnostics({ pkg, realmImports: [badImport] });
  assert.equal(failing.ok, false, 'an adapted_fork missing origin/divergence fails diagnostics');

  // the failure taxonomy is complete and includes representative codes
  assert.ok(engine.FAILURE_TAXONOMY.length > 50);
  for (const code of ['projection_stale', 'realm_run_state_promotion_forbidden', 'narrative_spine_write_conflict', 'ending_closure_missing', 'edit_conflict', 'generation_retry_exhausted']) {
    assert.ok(engine.FAILURE_TAXONOMY.includes(code), `taxonomy includes ${code}`);
  }
});
