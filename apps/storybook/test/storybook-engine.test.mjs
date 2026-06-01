import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');

function resolveTsc() {
  const candidates = [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    path.join(root, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Could not locate the local typescript compiler (node_modules/typescript/bin/tsc).');
  return found;
}

// The engine is pure TypeScript (no SDK/Kit/React imports), so we compile it with
// tsc (NodeNext) and import the compiled output. This doubles as a typecheck of the
// whole engine surface. We invoke tsc via the current node binary (cross-platform;
// avoids the pnpm/.cmd shim resolution problem on Windows).
let engineBuildDir = null;
function buildEngine() {
  if (engineBuildDir) return engineBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const dir = mkdtempSync(path.join(root, '.tmp', 'engine-'));
  execFileSync(process.execPath, [
    resolveTsc(),
    '--outDir', dir,
    '--rootDir', 'src',
    '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext',
    '--target', 'ES2022',
    '--skipLibCheck', 'true',
    '--strict', 'true',
    '--noEmit', 'false',
    'src/storybook/engine/index.ts',
  ], { cwd: root, stdio: 'pipe' });
  engineBuildDir = dir; // memoize only after a successful compile
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

test('structured intake conversion normalizes inputs and fails closed', async () => {
  const engine = await importEngine();

  // original scenario -> structured records before any generation
  const original = engine.convertIntake({
    kind: 'original-scenario',
    projectId: 'p1',
    premise: '一座被诅咒的钟楼',
    cast: [{ name: '钟楼管理员', summary: '守着秘密的人' }],
    rules: ['每天午夜钟声会改变规则'],
  }, NOW);
  assert.equal(original.ok, true);
  assert.ok(original.value.scenarioFrame, 'scenario frame produced');
  assert.ok(original.value.agentCast && original.value.agentCast.agents.length === 1, 'cast produced');
  assert.equal(original.value.bible.approved, false, 'bible starts unapproved (review gate)');
  assert.ok(original.value.evidenceSeeds.length > 0, 'evidence seeds produced');

  // character card requires a name + a descriptive field
  const badCard = engine.convertIntake({ kind: 'character-card', projectId: 'p1', card: { name: '' } }, NOW);
  assert.equal(badCard.ok, false);
  assert.equal(badCard.code, 'character_card_invalid');

  // oversize source rejects long-novel extraction
  const huge = 'x'.repeat(engine.MAX_SOURCE_CHARS + 1);
  const tooBig = engine.convertIntake({ kind: 'short-fiction', projectId: 'p1', text: huge }, NOW);
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.code, 'source_too_large_for_app_lite_builder');

  // scenario seed without premise fails
  const noPremise = engine.convertIntake({ kind: 'original-scenario', projectId: 'p1', premise: '', cast: [], rules: [] }, NOW);
  assert.equal(noPremise.ok, false);
  assert.equal(noPremise.code, 'scenario_seed_invalid');
});

test('generated choices are the default progression path (no typing required)', async () => {
  const engine = await importEngine();

  // a non-ending node with NO authored choices still yields a generated choice
  const chapter = {
    ref: engine.makeTruthRef('p1', 'chapter', 'ch1'),
    id: 'ch1',
    title: 'c',
    startNodeId: 'a',
    nodes: [
      { id: 'a', chapterId: 'ch1', text: 'start', choices: [] },
      { id: 'b', chapterId: 'ch1', text: 'end', choices: [], isEnding: true, endingId: 'e' },
    ],
  };
  const generated = engine.generateChoicesForNode(chapter, chapter.nodes[0]);
  assert.equal(generated.length, 1, 'a generated choice is offered');
  assert.equal(generated[0].source, 'generated');
  assert.equal(generated[0].targetNodeId, 'b');
  assert.equal(engine.requiresFreeText(chapter.nodes[0]), false, 'free text is never required');

  // the example chapters validate the default progression with no findings
  const pkg = engine.buildExampleTruthPackage(NOW);
  for (const ch of pkg.chapters) {
    assert.deepEqual(engine.validateDefaultProgression(ch), [], `chapter ${ch.id} has a viable default path`);
  }
});

test('prepared package builds, validates, and fails closed on tampering', async () => {
  const engine = await importEngine();

  const built = engine.buildExamplePreparedPackage(NOW);
  assert.equal(built.ok, true, JSON.stringify(built));
  const report = engine.validatePreparedPackage(built.value);
  assert.equal(report.valid, true, JSON.stringify(report.findings));

  // incompatible schema version fails
  const badSchema = { ...built.value, manifest: { ...built.value.manifest, schemaVersion: 999 } };
  const schemaReport = engine.validatePreparedPackage(badSchema);
  assert.equal(schemaReport.valid, false);
  assert.ok(schemaReport.findings.some((f) => f.code === 'prepared_package_incompatible_version'));

  // a required asset that is not present fails
  const withRequiredMissing = {
    ...built.value,
    assetManifest: [{ ref: 'truth:x:asset-spec:a', kind: 'background', requiredness: 'required', state: 'missing', present: false }],
  };
  const assetReport = engine.validatePreparedPackage(withRequiredMissing);
  assert.equal(assetReport.valid, false);
  assert.ok(assetReport.findings.some((f) => f.code === 'prepared_package_missing_required_asset'));

  // a missing start node fails
  const noStart = { ...built.value, startSemantics: { chapterId: 'nope', nodeId: 'nope' } };
  const startReport = engine.validatePreparedPackage(noStart);
  assert.equal(startReport.valid, false);
  assert.ok(startReport.findings.some((f) => f.code === 'prepared_package_missing_start_entry'));
});

test('malformed prepared packages fail closed (no throw) on import validation', async () => {
  const engine = await importEngine();

  // The import fast-path must never throw on arbitrary JSON; it returns typed findings.
  for (const malformed of [undefined, null, 42, 'a string', [], {}, { manifest: {} }, { manifest: { packageId: 'x' } }]) {
    let report;
    assert.doesNotThrow(() => { report = engine.validatePreparedPackage(malformed); }, `validatePreparedPackage must not throw for ${JSON.stringify(malformed)}`);
    assert.equal(report.valid, false, `malformed input ${JSON.stringify(malformed)} must be invalid`);
    assert.ok(report.findings.length > 0, 'malformed input yields findings');
  }

  // The classic crash case: an empty object. It used to throw on manifest.packageId.
  const emptyReport = engine.validatePreparedPackage({});
  assert.ok(emptyReport.findings.some((f) => f.code === 'prepared_package_invalid_manifest'), 'empty object reports a manifest finding');

  // A package missing the player-facing minimum contract is invalid (would crash Play otherwise).
  const built = engine.buildExamplePreparedPackage(NOW);
  assert.equal(built.ok, true);
  const noStateMatrix = { ...built.value };
  delete noStateMatrix.stateMatrix;
  const smReport = engine.validatePreparedPackage(noStateMatrix);
  assert.equal(smReport.valid, false);
  assert.ok(smReport.findings.some((f) => f.pointers && f.pointers.includes('stateMatrix')));
});

test('asset states: fallback/prebuilt are usable, required-missing is not success, replacement keeps provenance', async () => {
  const engine = await importEngine();
  const ref = engine.makeTruthRef('p1', 'asset-spec', 'a1');

  const missingRequired = engine.createAssetSpec({ ref, kind: 'background', description: 'bg', requiredness: 'required', now: NOW });
  assert.equal(missingRequired.state, 'missing');
  const missingFindings = engine.validateAssetSpec(missingRequired);
  assert.ok(missingFindings.some((f) => f.code === 'asset_missing_generation_not_success'), 'missing required asset is not success');

  const fallback = engine.attachFallbackArtifact(missingRequired, 'asset://fallback.png', 'image/png', NOW);
  assert.equal(fallback.state, 'fallback');
  assert.equal(engine.isAssetUsable(fallback), true);
  assert.deepEqual(engine.validateAssetSpec(fallback), []);

  const prebuilt = engine.attachPrebuiltArtifact(missingRequired, 'asset://prebuilt.png', 'image/png', NOW);
  assert.equal(prebuilt.state, 'prebuilt');
  assert.equal(engine.isAssetUsable(prebuilt), true);

  const replaced = engine.replaceAsset(prebuilt, 'asset://new.png', 'image/png', 'creator replaced', NOW);
  assert.equal(replaced.state, 'replaced');
  assert.equal(replaced.artifactRef, 'asset://new.png');
  const last = replaced.provenance[replaced.provenance.length - 1];
  assert.equal(last.action, 'replaced');
  assert.equal(last.supersededArtifactRef, 'asset://prebuilt.png', 'provenance preserves the superseded artifact');
});

test('app-internal memory is project-scoped and feedback targets are validated', async () => {
  const engine = await importEngine();
  const pkg = engine.buildExampleTruthPackage(NOW);
  const memory = engine.createProjectMemory(pkg.projectId);
  assert.equal(memory.scope, 'app-internal-project-scoped');
  assert.equal(engine.STORYBOOK_MEMORY_SCOPE, 'app-internal-project-scoped');

  // invalid (non-resolving) target fails closed
  const bad = engine.addFeedbackPatch(memory, { targetRef: 'truth:p1:world-rule:does-not-exist', kind: 'correction', note: 'x', now: NOW }, pkg);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'feedback_patch_target_invalid');

  // a real bible ref resolves
  const good = engine.addFeedbackPatch(memory, { targetRef: pkg.bible.ref, kind: 'preference', note: '更克制', now: NOW }, pkg);
  assert.equal(good.ok, true);
  assert.equal(good.value.feedbackPatches.length, 1);

  // a null target (project-global) is allowed
  const global = engine.addFeedbackPatch(memory, { targetRef: null, kind: 'preference', note: 'global', now: NOW }, pkg);
  assert.equal(global.ok, true);
});

test('promotion forbids auto_accept for protected classes and enforces the enum', async () => {
  const engine = await importEngine();

  const protectedCandidate = engine.createPromotionCandidate({
    sourceRefs: ['turn:1'],
    evidenceRefs: [],
    targetTruthRef: engine.makeTruthRef('p1', 'world-rule', 'hard'),
    targetObjectFamily: 'world-rule',
    mutationType: 'update',
    protectedClasses: ['hard-world-rule'],
    proposedChange: {},
  });
  const assessment = {
    candidateId: protectedCandidate.id,
    riskClass: 'low', impactClass: 'durable', confidence: 0.99,
    contradictionCheck: true, visibilityCheck: true, policyCheck: true, scopeCheck: true,
    assessor: { identity: 'engine-test' }, rationale: 'looks fine',
  };
  const forbidden = engine.enforcePromotionPolicy({ candidate: protectedCandidate, assessment, proposedDecision: 'auto_accept', now: NOW });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.code, 'promotion_auto_accept_forbidden_class');

  // needs_review is allowed for the same protected candidate
  const reviewed = engine.enforcePromotionPolicy({ candidate: protectedCandidate, assessment, proposedDecision: 'needs_review', now: NOW });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.value.decision.decision, 'needs_review');

  // a non-canonical enum value fails
  const bogus = engine.enforcePromotionPolicy({ candidate: protectedCandidate, assessment, proposedDecision: 'auto-accept', now: NOW });
  assert.equal(bogus.ok, false);
  assert.equal(bogus.code, 'promotion_enum_invalid');

  // low-risk, unprotected, high-confidence auto_accept is allowed
  const softCandidate = engine.createPromotionCandidate({
    sourceRefs: ['turn:2'], evidenceRefs: [], targetTruthRef: null, targetObjectFamily: 'feedback-rule',
    mutationType: 'add-feedback', protectedClasses: [], proposedChange: {},
  });
  const softAssessment = { ...assessment, candidateId: softCandidate.id };
  const accepted = engine.enforcePromotionPolicy({ candidate: softCandidate, assessment: softAssessment, proposedDecision: 'auto_accept', now: NOW });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.decision.decision, 'auto_accept');
});

test('rule-of-truth -> projection: example truth package is play-valid end to end', async () => {
  const engine = await importEngine();
  const pkg = engine.buildExampleTruthPackage(NOW);
  const report = engine.validateTruthPackage(pkg);
  assert.equal(report.valid, true, JSON.stringify(report.findings));

  const studio = engine.buildStudioProjection(pkg);
  assert.equal(studio.projectionType, 'studio');
  assert.ok(studio.governingTruthRefs.length > 0, 'studio projection carries governing truth refs');

  const play = engine.buildPlayProjection(pkg);
  // redaction: no private fact leaks into the public cast
  const publicFacts = play.payload.publicCast.flatMap((c) => c.publicFacts.map((f) => f.toLowerCase()));
  for (const agent of pkg.agentCast.agents) {
    for (const priv of agent.privateFacts) {
      assert.ok(!publicFacts.includes(priv.toLowerCase()), 'private fact must not appear in the play projection');
    }
  }
  assert.equal(engine.isProjectionStale(play, pkg), false);
  assert.equal(engine.isProjectionStale({ ...play, packageVersion: pkg.version + 1 }, pkg), true);
});
