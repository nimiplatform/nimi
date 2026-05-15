import {
  mkdir,
  readFile,
  rm,
  writeFile,
  path,
  test,
  assert,
  YAML,
  repoRoot,
  runNativeCodexSdkPrompt,
  createBootstrapSeedFileMap,
  applyFixtureScenario,
  withTempProject,
  writeGovernanceConfig,
  captureRunCli,
  runCliSubprocess,
  runCutoverReadinessCheck,
  updateSpecGenerationInputs,
  writeBlueprintReference,
  seedReconstructedTargetTruth,
  seedTargetTruthFilesOnly,
  seedHighRiskCandidateArtifacts,
  readYamlFile,
  markCanonicalTreeReady,
  writeLocalCloseoutArtifact,
  materializeFixtureScenario,
  runSpecReconstructionFixtureLoop,
  seedFrozenAuditSweep,
  clusteredAuditFinding,
  writeAuditEvidence,
} from "./nimicoding-test-utils.mjs";

test("topic closeout wave, validate closure, true-close-audit, and closeout topic enforce final closure gates", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "closeout-demo",
      "--justification",
      "full closure and true-close demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "closeout-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["closure evidence remains explicit"],
        negative_tests: ["missing closeout evidence fails"],
        reopen_conditions: ["owner-cut drift reopens wave"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);
    const resultSource = path.join(projectRoot, "closeout-result.md");
    await writeFile(resultSource, "# Implementation Result\n\nWave evidence closed.\n", "utf8");
    const resultRecord = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-23T13:00:00Z",
      "--json",
    ]);
    assert.equal(resultRecord.exitCode, 0);

    const earlyAudit = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "wave is still active so true close cannot pass",
      "--json",
    ]);
    assert.equal(earlyAudit.exitCode, 1);
    const earlyAuditPayload = JSON.parse(earlyAudit.stdout);
    assert.equal(earlyAuditPayload.status, "pending");
    assert.ok(earlyAuditPayload.checks.some((entry) => entry.id === "all_waves_terminal" && entry.ok === false));

    const closeoutWave = await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-foundation",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutWave.exitCode, 0);
    const closeoutWavePayload = JSON.parse(closeoutWave.stdout);
    assert.equal(closeoutWavePayload.waveState, "closed");

    const validateClosure = await captureRunCli([
      "topic",
      "validate",
      "closure",
      createPayload.topicId,
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(validateClosure.exitCode, 0);
    const closurePayload = JSON.parse(validateClosure.stdout);
    assert.equal(closurePayload.ok, true);

    const passAudit = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "all waves are terminal and no active target remains",
      "--json",
    ]);
    assert.equal(passAudit.exitCode, 0);
    const passAuditPayload = JSON.parse(passAudit.stdout);
    assert.equal(passAuditPayload.status, "passed");

    const closeoutTopic = await captureRunCli([
      "topic",
      "closeout",
      "topic",
      createPayload.topicId,
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutTopic.exitCode, 0);
    const closeoutTopicPayload = JSON.parse(closeoutTopic.stdout);
    assert.equal(closeoutTopicPayload.state, "closed");
    assert.equal(closeoutTopicPayload.currentTrueCloseStatus, "true_closed");

    const closedTopicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "closed", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    assert.equal(closedTopicYaml.state, "closed");
    assert.equal(closedTopicYaml.current_true_close_status, "true_closed");
  });
});

test("topic closeout wave allows preflight design closure with packet and result lineage", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "preflight-closeout-demo",
      "--justification",
      "preflight design closeout demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-design", "design",
      "--goal", "close design preflight", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-design", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-design", "--json"]);

    const draftPath = path.join(projectRoot, "preflight-closeout-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-design-preflight",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-design",
        packet_kind: "preflight",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["preflight closure has explicit evidence"],
        negative_tests: ["preflight closeout without result fails"],
        reopen_conditions: ["design admission boundary changes"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json"]);

    const resultSource = path.join(projectRoot, "preflight-result.md");
    await writeFile(resultSource, "# Preflight Result\n\nDesign packet passed.\n", "utf8");
    const resultRecord = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-23T13:00:00Z",
      "--json",
    ]);
    assert.equal(resultRecord.exitCode, 0);
    assert.equal(JSON.parse(resultRecord.stdout).waveState, "preflight_admitted");

    const closeoutWave = await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-design",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutWave.exitCode, 0);
    assert.equal(JSON.parse(closeoutWave.stdout).waveState, "closed");
  });
});

test("topic closeout wave refuses drift-resistance closure without placement report evidence", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "placement-closeout-demo",
      "--justification",
      "placement closeout evidence demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-placement", "placement",
      "--goal", "close placement integration", "--owner-domain", "nimi-coding", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-placement", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-placement", "--json"]);

    const draftPath = path.join(projectRoot, "placement-closeout-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-placement-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-placement",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/cli/lib/topic-closeout.mjs"],
        canonical_seams: ["closeout consumes placement validation evidence"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["closeout_drift_resistance_requires_placement_report"],
        negative_tests: ["placement_failure_cannot_be_reported_as_successful_wave_closeout"],
        reopen_conditions: ["placement_validation_is_only_documented_not_executed"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json"]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId,
      "--packet", "wave-1-placement-implementation", "--json",
    ]);

    const resultSource = path.join(projectRoot, "placement-result-without-report.md");
    await writeFile(resultSource, "# Implementation Result\n\nNo placement report is attached.\n", "utf8");
    assert.equal((await captureRunCli([
      "topic", "result", "record", createPayload.topicId,
      "--kind", "implementation",
      "--verdict", "PASS",
      "--from", resultSource,
      "--verified-at", "2026-04-23T13:00:00Z",
      "--json",
    ])).exitCode, 0);

    const refused = await captureRunCli([
      "topic", "closeout", "wave", createPayload.topicId, "wave-1-placement",
      "--authority", "closed",
      "--semantic", "closed",
      "--consumer", "closed",
      "--drift-resistance", "closed",
      "--disposition", "complete",
      "--json",
    ]);
    assert.equal(refused.exitCode, 1);
    assert.match(`${refused.stdout}\n${refused.stderr}`, /placement validation evidence/);

    const placementReportSource = path.join(projectRoot, "placement-report.md");
    await writeFile(
      placementReportSource,
      [
        "# Placement Report",
        "",
        "contract: nimicoding.surface-validator-result.v1",
        "validator: validate-placement",
        "ok: false",
        "expected_current_tree_failure: true",
      ].join("\n"),
      "utf8",
    );
    assert.equal((await captureRunCli([
      "topic", "result", "record", createPayload.topicId,
      "--kind", "audit",
      "--verdict", "PASS",
      "--from", placementReportSource,
      "--verified-at", "2026-04-23T13:10:00Z",
      "--json",
    ])).exitCode, 0);

    const closeout = await captureRunCli([
      "topic", "closeout", "wave", createPayload.topicId, "wave-1-placement",
      "--authority", "closed",
      "--semantic", "closed",
      "--consumer", "closed",
      "--drift-resistance", "closed",
      "--disposition", "complete",
      "--json",
    ]);
    assert.equal(closeout.exitCode, 0, closeout.stderr);
    assert.equal(JSON.parse(closeout.stdout).waveState, "closed");
  });
});

test("topic hold and resume create pending-note lineage and move the topic between pending and ongoing", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "pending-resume-demo",
      "--justification",
      "pending hold and resume demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-2-follow-on", "follow-on",
      "--goal", "close follow-on", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "pending-demo-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["pending only after prior wave is closed"],
        negative_tests: ["active implementation hold fails"],
        reopen_conditions: ["new owner-cut needs a fresh packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);

    const resultSource = path.join(projectRoot, "pending-demo-result.md");
    await writeFile(resultSource, "# Result\n\nFoundation wave closed.\n", "utf8");
    await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-23T14:00:00Z",
      "--json",
    ]);
    await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-foundation",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-2-follow-on", "--json",
    ]);

    const holdResult = await captureRunCli([
      "topic",
      "hold",
      createPayload.topicId,
      "--reason",
      "external-dependency-wait",
      "--summary",
      "waiting on an external dependency before wave-2 can reopen",
      "--reopen-criteria",
      "dependency owner confirms the contract is stable",
      "--json",
    ]);
    assert.equal(holdResult.exitCode, 0);
    const holdPayload = JSON.parse(holdResult.stdout);
    assert.equal(holdPayload.state, "pending");

    const pendingTopicDir = path.join(projectRoot, ".nimi", "topics", "pending", createPayload.topicId);
    const pendingNote = await readFile(path.join(pendingTopicDir, "pending-note.md"), "utf8");
    assert.match(pendingNote, /reason: external-dependency-wait/);
    assert.match(pendingNote, /status: active/);

    const validatePending = await captureRunCli([
      "topic",
      "validate",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(validatePending.exitCode, 0);
    const validatePendingPayload = JSON.parse(validatePending.stdout);
    assert.equal(validatePendingPayload.state, "pending");
    assert.equal(validatePendingPayload.pendingNoteStatus, "active");

    const resumeResult = await captureRunCli([
      "topic",
      "resume",
      createPayload.topicId,
      "--criteria-met",
      "dependency owner confirmed the contract is stable",
      "--json",
    ]);
    assert.equal(resumeResult.exitCode, 0);
    const resumePayload = JSON.parse(resumeResult.stdout);
    assert.equal(resumePayload.state, "ongoing");

    const resumedTopicDir = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId);
    const resumedPendingNote = await readFile(path.join(resumedTopicDir, "pending-note.md"), "utf8");
    assert.match(resumedPendingNote, /status: resumed/);
    assert.match(resumedPendingNote, /last_resume_reason: dependency owner confirmed the contract is stable/);
  });
});

test("topic hold fails closed while active implementation tracking remains", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "pending-blocker-demo",
      "--justification",
      "pending blocker demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "pending-blocker-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["hold must refuse active implementation"],
        negative_tests: ["implementation-active hold fails"],
        reopen_conditions: ["new owner-cut needs a fresh packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);

    const holdResult = await captureRunCli([
      "topic",
      "hold",
      createPayload.topicId,
      "--reason",
      "external-dependency-wait",
      "--summary",
      "cannot pause while implementation is still active",
      "--reopen-criteria",
      "not relevant",
      "--json",
    ]);
    assert.equal(holdResult.exitCode, 1);
    assert.match(holdResult.stderr, /no active implementation wave/);
  });
});

test("topic closeout from pending requires a close trigger and records pending-note closure", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "pending-closeout-demo",
      "--justification",
      "close from pending demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "pending-closeout-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["pending closeout remains explicit"],
        negative_tests: ["closeout from pending without close trigger fails"],
        reopen_conditions: ["new owner-cut needs a fresh packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);
    const resultSource = path.join(projectRoot, "pending-closeout-result.md");
    await writeFile(resultSource, "# Result\n\nTopic can close.\n", "utf8");
    await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-23T15:00:00Z",
      "--json",
    ]);
    await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-foundation",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);

    const holdWithoutCloseTrigger = await captureRunCli([
      "topic",
      "hold",
      createPayload.topicId,
      "--reason",
      "rollout-observation",
      "--summary",
      "waiting for a final closure signal",
      "--reopen-criteria",
      "sponsor asks for follow-on work",
      "--json",
    ]);
    assert.equal(holdWithoutCloseTrigger.exitCode, 0);

    const passAudit = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "all waves are terminal and the topic may close if the close trigger exists",
      "--json",
    ]);
    assert.equal(passAudit.exitCode, 0);

    const closeoutWithoutTrigger = await captureRunCli([
      "topic",
      "closeout",
      "topic",
      createPayload.topicId,
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutWithoutTrigger.exitCode, 1);
    const closeoutWithoutTriggerPayload = JSON.parse(closeoutWithoutTrigger.stdout);
    assert.match(closeoutWithoutTriggerPayload.error, /close trigger/);

    const pendingTopicDir = path.join(projectRoot, ".nimi", "topics", "pending", createPayload.topicId);
    const pendingNotePath = path.join(pendingTopicDir, "pending-note.md");
    const existingPendingNote = await readFile(pendingNotePath, "utf8");
    const closingPendingNote = YAML.parse(existingPendingNote.match(/^---\n([\s\S]*?)\n---\n/m)[1]);
    closingPendingNote.close_trigger = "sponsor confirmed no follow-on work remains";
    await writeFile(
      pendingNotePath,
      `---\n${YAML.stringify(closingPendingNote).trimEnd()}\n---\n\n# Pending Note\n`,
      "utf8",
    );

    const closeoutTopic = await captureRunCli([
      "topic",
      "closeout",
      "topic",
      createPayload.topicId,
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutTopic.exitCode, 0);
    const closeoutPayload = JSON.parse(closeoutTopic.stdout);
    assert.equal(closeoutPayload.state, "closed");

    const closedPendingNote = await readFile(
      path.join(projectRoot, ".nimi", "topics", "closed", createPayload.topicId, "pending-note.md"),
      "utf8",
    );
    assert.match(closedPendingNote, /status: closed/);
  });
});
