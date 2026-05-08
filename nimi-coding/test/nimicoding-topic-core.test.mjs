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

test("topic create scaffolds an enriched proposal topic and status/validate succeed", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "wave-one-demo",
      "--title",
      "Wave One Demo",
      "--justification",
      "authority-bearing redesign line",
      "--applicability",
      "authority-bearing",
      "--json",
    ]);

    assert.equal(createResult.exitCode, 0);
    const createPayload = JSON.parse(createResult.stdout);
    assert.equal(createPayload.ok, true);
    assert.equal(createPayload.command, "topic.create");
    assert.match(createPayload.topicRef, /^\.nimi\/topics\/proposal\/\d{4}-\d{2}-\d{2}-wave-one-demo$/);

    const topicDir = path.join(projectRoot, createPayload.topicRef);
    const topicYaml = await readFile(path.join(topicDir, "topic.yaml"), "utf8");
    assert.match(topicYaml, /title: Wave One Demo/);
    assert.match(topicYaml, /mode: greenfield/);
    assert.match(topicYaml, /posture: no_legacy_hard_cut/);
    assert.match(topicYaml, /applicability: authority_bearing/);
    assert.match(topicYaml, /execution_mode: manager_worker_auditor/);
    await assert.doesNotReject(readFile(path.join(topicDir, "README.md"), "utf8"));
    await assert.doesNotReject(readFile(path.join(topicDir, "design.md"), "utf8"));
    await assert.doesNotReject(readFile(path.join(topicDir, "preflight.md"), "utf8"));
    await assert.doesNotReject(readFile(path.join(topicDir, "waves.md"), "utf8"));

    const statusResult = await captureRunCli([
      "topic",
      "status",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(statusResult.exitCode, 0);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.command, "topic.status");
    assert.equal(statusPayload.schemaMode, "enriched");
    assert.equal(statusPayload.state, "proposal");
    assert.equal(statusPayload.selectedNextTarget, "topic_design_baseline");
    assert.equal(statusPayload.currentTrueCloseStatus, "not_started");

    const validateResult = await captureRunCli([
      "topic",
      "validate",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
    assert.equal(validatePayload.command, "topic.validate");
    assert.equal(validatePayload.schemaMode, "enriched");
    assert.deepEqual(validatePayload.warnings, []);

    const previousCwd = process.cwd();
    try {
      process.chdir(topicDir);
      const nestedStatusResult = await captureRunCli([
        "topic",
        "status",
        "--json",
      ]);
      assert.equal(nestedStatusResult.exitCode, 0);
      const nestedStatusPayload = JSON.parse(nestedStatusResult.stdout);
      assert.equal(nestedStatusPayload.ok, true);
      assert.equal(nestedStatusPayload.topicId, createPayload.topicId);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

test("topic status accepts a legacy minimal topic root and reports schema mode explicitly", async () => {
  await withTempProject(async (projectRoot) => {
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", "2026-04-23-legacy-minimal-topic");
    await mkdir(topicDir, { recursive: true });
    await writeFile(
      path.join(topicDir, "topic.yaml"),
      YAML.stringify({
        topic_id: "2026-04-23-legacy-minimal-topic",
        state: "proposal",
        created_at: "2026-04-23",
        last_transition_at: "2026-04-23",
        last_transition_reason: "legacy_topic_root_seeded_for_status_test",
      }),
      "utf8",
    );
    await writeFile(path.join(topicDir, "README.md"), "# Legacy Minimal Topic\n", "utf8");
    await writeFile(path.join(topicDir, "design.md"), "# Design\n", "utf8");

    const statusResult = await captureRunCli([
      "topic",
      "status",
      "2026-04-23-legacy-minimal-topic",
      "--json",
    ]);

    assert.equal(statusResult.exitCode, 0);
    const payload = JSON.parse(statusResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.schemaMode, "legacy_minimal");
    assert.ok(payload.warnings.some((entry) => entry.includes("legacy minimal shape")));
  });
});

test("topic decision-review selects active replacement when retiring selected wave", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "decision-replacement-demo",
      "--justification",
      "decision replacement demo",
      "--json",
    ]);
    assert.equal(createResult.exitCode, 0);
    const createPayload = JSON.parse(createResult.stdout);

    for (const [waveId, slug] of [
      ["wave-old-scope", "old-scope"],
      ["wave-new-scope", "new-scope"],
    ]) {
      const addResult = await captureRunCli([
        "topic",
        "wave",
        "add",
        createPayload.topicId,
        waveId,
        slug,
        "--goal",
        `close ${slug}`,
        "--owner-domain",
        "nimicoding/topic",
        "--json",
      ]);
      assert.equal(addResult.exitCode, 0);
    }

    const selectResult = await captureRunCli([
      "topic",
      "wave",
      "select",
      createPayload.topicId,
      "wave-old-scope",
      "--json",
    ]);
    assert.equal(selectResult.exitCode, 0);

    const decisionResult = await captureRunCli([
      "topic",
      "decision-review",
      createPayload.topicId,
      "retire-old-scope",
      "--decision",
      "Retire old scope and continue from replacement.",
      "--replaced-scope",
      "wave-old-scope",
      "--active-replacement-scope",
      "wave-new-scope",
      "--disposition",
      "retired",
      "--target-wave",
      "wave-old-scope",
      "--date",
      "2026-05-08",
      "--json",
    ]);
    assert.equal(decisionResult.exitCode, 0);

    const statusResult = await captureRunCli([
      "topic",
      "status",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(statusResult.exitCode, 0);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.equal(statusPayload.selectedNextTarget, "wave-new-scope");

    const validateResult = await captureRunCli([
      "topic",
      "validate",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
  });
});

test("topic validate fails closed on legacy numeric artifact lineage without declared waves", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const fixtureId = "2026-04-20-desktop-agent-live2d-companion-substrate";
    const topicDir = path.join(projectRoot, ".nimi", "topics", "closed", fixtureId);
    await mkdir(topicDir, { recursive: true });
    await writeFile(
      path.join(topicDir, "topic.yaml"),
      YAML.stringify({
        topic_id: fixtureId,
        state: "closed",
        created_at: "2026-04-20",
        last_transition_at: "2026-04-20",
        last_transition_reason: "legacy_dense_fixture_seeded",
      }),
      "utf8",
    );
    await writeFile(path.join(topicDir, "README.md"), "# Legacy Dense Topic\n", "utf8");
    await writeFile(path.join(topicDir, "design.md"), "# Design\n", "utf8");

    const waveIds = Array.from({ length: 12 }, (_, index) => `wave-${index + 1}`);
    waveIds[5] = "wave-6a";
    for (const waveId of waveIds) {
      await writeFile(path.join(topicDir, `packet-${waveId}-legacy.md`), `# Packet ${waveId}\n`, "utf8");
      await writeFile(path.join(topicDir, `result-${waveId}-legacy.md`), `# Result ${waveId}\n`, "utf8");
      await writeFile(path.join(topicDir, `closeout-${waveId}-legacy.md`), `# Closeout ${waveId}\n`, "utf8");
    }
    for (let index = 1; index <= 5; index += 1) {
      await writeFile(path.join(topicDir, `decision-review-wave-${index}-legacy.md`), "# Decision Review\n", "utf8");
      await writeFile(path.join(topicDir, `remediation-wave-${index}-legacy.md`), "# Remediation\n", "utf8");
      await writeFile(path.join(topicDir, `overflow-continuation-wave-${index}-legacy.md`), "# Overflow\n", "utf8");
      await writeFile(path.join(topicDir, `exec-pack-wave-${index}-legacy.md`), "# Exec Pack\n", "utf8");
    }
    await writeFile(path.join(topicDir, "topic-true-close-audit.md"), "# True Close Audit\n", "utf8");
    await writeFile(path.join(topicDir, "result-topic-true-close.md"), "# True Close Result\n", "utf8");

    const result = await captureRunCli([
      "topic",
      "validate",
      fixtureId,
      "--json",
    ]);

    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.schemaMode, "legacy_minimal");
    assert.equal(payload.migrationPosture, "explicit_legacy_reconstruction_required");
    assert.equal(payload.validationDisposition, "report_only");
    assert.equal(payload.canonicalValidated, false);
    assert.equal(payload.ignoredByPolicy, true);
    assert.equal(payload.ignorePolicyReason, "historical_dense_topic_pre_machine_wave_registry");
    assert.ok(payload.artifactSummary.files > 50);
    assert.ok(payload.artifactSummary.packets > 10);
    assert.ok(payload.artifactSummary.results > 10);
    assert.equal(payload.featureFlags.decision_review_lineage, true);
    assert.equal(payload.featureFlags.remediation_lineage, true);
    assert.equal(payload.featureFlags.overflow_lineage, true);
    assert.equal(payload.featureFlags.true_close_lineage, true);
    assert.equal(payload.featureFlags.exec_pack_lineage, true);
    assert.ok(payload.checks.some((entry) => entry.id === "packet_wave_lineage_resolves" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "result_wave_lineage_resolves" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "closeout_wave_lineage_resolves" && entry.ok === false));
    assert.ok(payload.unresolvedPacketWaveRefs.some((entry) => entry.includes("packet-wave-1-legacy.md:unresolved")));
    assert.ok(payload.unresolvedResultWaveIds.some((entry) => entry.includes("result-wave-1-legacy.md:unresolved")));
    assert.ok(payload.unresolvedCloseoutWaveRefs.some((entry) => entry.includes("closeout-wave-1-legacy.md:unresolved")));
    assert.equal(payload.waveIds.includes("wave-1"), false);
    assert.equal(payload.waveIds.includes("wave-6a"), false);
    assert.ok(Array.isArray(payload.observedWaves));
    assert.equal(payload.observedWaves.length, 0);
  });
});

test("topic validate fails closed on ambiguous lifecycle naming, active-wave closeout conflict, and premature true-close", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "validator-rail-demo",
      "--justification",
      "validator rail demo",
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

    const topicDir = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId);
    await writeFile(path.join(topicDir, "result-bad.md"), "# bad result\n", "utf8");
    await writeFile(
      path.join(topicDir, "closeout-wave-1-foundation.md"),
      `---\n${YAML.stringify({
        closeout_id: "wave-1-foundation",
        topic_id: createPayload.topicId,
        scope: "wave",
        authority_closure: "closed",
        semantic_closure: "closed",
        consumer_closure: "closed",
        drift_resistance_closure: "closed",
        disposition: "complete",
      }).trimEnd()}\n---\n\n# bad closeout\n`,
      "utf8",
    );
    await writeFile(
      path.join(topicDir, "topic-true-close-audit.md"),
      `---\n${YAML.stringify({
        topic_id: createPayload.topicId,
        status: "passed",
      }).trimEnd()}\n---\n\n# premature true-close\n`,
      "utf8",
    );

    const validateResult = await captureRunCli([
      "topic",
      "validate",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 1);
    const payload = JSON.parse(validateResult.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((entry) => entry.id === "artifact_naming_unambiguous" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "no_active_wave_closeout_conflict" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "true_close_not_premature" && entry.ok === false));
  });
});

test("topic validate fails closed when topic root state evidence is malformed", async () => {
  await withTempProject(async (projectRoot) => {
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", "2026-04-23-malformed-topic");
    await mkdir(topicDir, { recursive: true });
    await writeFile(
      path.join(topicDir, "topic.yaml"),
      YAML.stringify({
        topic_id: "2026-04-23-malformed-topic",
        state: "ongoing",
        created_at: "2026-04-23",
        last_transition_at: "2026-04-23",
      }),
      "utf8",
    );

    const validateResult = await captureRunCli([
      "topic",
      "validate",
      "2026-04-23-malformed-topic",
      "--json",
    ]);

    assert.equal(validateResult.exitCode, 1);
    const payload = JSON.parse(validateResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.schemaMode, "legacy_minimal");
    assert.ok(payload.checks.some((entry) => entry.id === "state_matches_root" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "minimal_state_evidence" && entry.ok === false));
  });
});

test("topic wave add/select/admit and graph validation manage machine wave state", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "graph-demo",
      "--justification",
      "multi-wave authority-bearing line",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    const waveOneAdd = await captureRunCli([
      "topic",
      "wave",
      "add",
      createPayload.topicId,
      "wave-1-foundation",
      "foundation",
      "--goal",
      "close the foundation cut",
      "--owner-domain",
      "nimicoding/topic",
      "--json",
    ]);
    assert.equal(waveOneAdd.exitCode, 0);

    const waveTwoAdd = await captureRunCli([
      "topic",
      "wave",
      "add",
      createPayload.topicId,
      "wave-2-follow-on",
      "follow-on",
      "--goal",
      "close the dependent follow-on cut",
      "--owner-domain",
      "nimicoding/topic",
      "--dep",
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(waveTwoAdd.exitCode, 0);

    const selectResult = await captureRunCli([
      "topic",
      "wave",
      "select",
      createPayload.topicId,
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(selectResult.exitCode, 0);

    const graphResult = await captureRunCli([
      "topic",
      "validate",
      "graph",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(graphResult.exitCode, 0);
    const graphPayload = JSON.parse(graphResult.stdout);
    assert.equal(graphPayload.ok, true);
    assert.equal(graphPayload.command, "topic.validate.graph");
    assert.equal(graphPayload.waveCount, 2);

    const admitResult = await captureRunCli([
      "topic",
      "wave",
      "admit",
      createPayload.topicId,
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(admitResult.exitCode, 0);
    const admitPayload = JSON.parse(admitResult.stdout);
    assert.equal(admitPayload.ok, true);
    assert.equal(admitPayload.waveState, "preflight_admitted");
    assert.equal(admitPayload.state, "ongoing");

    const topicYamlPath = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId, "topic.yaml");
    const movedTopicYamlPath = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml");
    const activeTopicYamlPath = await readFile(movedTopicYamlPath, "utf8").then(() => movedTopicYamlPath).catch(() => topicYamlPath);
    const topicYaml = YAML.parse(await readFile(activeTopicYamlPath, "utf8"));
    const waveOne = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(waveOne.state, "preflight_admitted");
    assert.equal(topicYaml.selected_next_target, "wave-1-foundation");
  });
});

test("topic wave add fails closed on unresolved dependencies before mutating topic.yaml", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "graph-hardening-demo",
      "--justification",
      "graph hardening demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    const topicYamlPath = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId, "topic.yaml");

    const addResult = await captureRunCli([
      "topic",
      "wave",
      "add",
      createPayload.topicId,
      "wave-2-dependent",
      "dependent",
      "--goal",
      "close a missing dependency",
      "--owner-domain",
      "nimicoding/topic",
      "--dep",
      "wave-1-missing",
      "--json",
    ]);
    assert.equal(addResult.exitCode, 1);
    assert.match(addResult.stderr, /missing dependency refs/);

    const topicYaml = YAML.parse(await readFile(topicYamlPath, "utf8"));
    assert.deepEqual(topicYaml.waves, []);
  });
});

test("topic validate admission fails closed when upstream dependencies are not closed", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "admission-demo",
      "--justification",
      "multi-wave authority-bearing line",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-2-dependent", "dependent",
      "--goal", "close dependent", "--owner-domain", "nimicoding/topic", "--dep", "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-2-dependent", "--json",
    ]);

    const admissionResult = await captureRunCli([
      "topic",
      "validate",
      "admission",
      createPayload.topicId,
      "wave-2-dependent",
      "--json",
    ]);
    assert.equal(admissionResult.exitCode, 1);
    const payload = JSON.parse(admissionResult.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((entry) => entry.id === "upstream_dependencies_closed" && entry.ok === false));

    const topicYaml = YAML.parse(await readFile(path.join(topicDir, "topic.yaml"), "utf8"));
    topicYaml.waves = topicYaml.waves.map((entry) => (
      entry.wave_id === "wave-1-foundation"
        ? { ...entry, state: "closed" }
        : entry
    ));
    await writeFile(path.join(topicDir, "topic.yaml"), YAML.stringify(topicYaml), "utf8");

    const admissionPass = await captureRunCli([
      "topic",
      "validate",
      "admission",
      createPayload.topicId,
      "wave-2-dependent",
      "--json",
    ]);
    assert.equal(admissionPass.exitCode, 0);
    const passPayload = JSON.parse(admissionPass.stdout);
    assert.equal(passPayload.ok, true);
  });
});

test("topic packet freeze validates required fields and writes a frozen packet artifact", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "packet-freeze-demo",
      "--justification",
      "packet discipline demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);

    const draftPath = path.join(projectRoot, "draft-packet.yaml");
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
        acceptance_invariants: ["all required fields stay explicit"],
        negative_tests: ["missing required field fails closed"],
        reopen_conditions: ["owner-cut changes require new packet"],
      }),
      "utf8",
    );

    const freezeResult = await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);
    assert.equal(freezeResult.exitCode, 0);
    const freezePayload = JSON.parse(freezeResult.stdout);
    assert.equal(freezePayload.ok, true);
    assert.equal(freezePayload.status, "candidate");
    const packetText = await readFile(path.join(projectRoot, freezePayload.packetRef), "utf8");
    assert.match(packetText, /^---\n/);
    assert.match(packetText, /status: candidate/);

    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "smoke-1",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["all required fields stay explicit"],
        negative_tests: ["ambiguous packet id fails closed"],
        reopen_conditions: ["owner-cut changes require new packet"],
      }),
      "utf8",
    );
    const ambiguousFreeze = await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);
    assert.equal(ambiguousFreeze.exitCode, 1);
    assert.match(ambiguousFreeze.stderr, /ambiguous lifecycle artifact name/);

    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "broken-packet",
        topic_id: createPayload.topicId,
      }),
      "utf8",
    );
    const brokenFreeze = await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);
    assert.equal(brokenFreeze.exitCode, 1);
    assert.match(brokenFreeze.stderr, /missing required fields/);
  });
});

test("topic lifecycle artifacts accept slug-shaped wave ids in sweep-fix execution topics", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "slug-wave-lifecycle",
      "--justification",
      "slug wave lifecycle regression",
      "--json",
    ]);
    assert.equal(createResult.exitCode, 0);
    const createPayload = JSON.parse(createResult.stdout);
    const waveId = "wave-avatar-authority-consistency";
    const packetId = `${waveId}-implementation`;

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, waveId, "avatar-authority-consistency",
      "--goal", "close slug-shaped sweep-fix wave", "--owner-domain", "avatar/spec", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, waveId, "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, waveId, "--json"]);

    const topicDir = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId);
    const draftPath = path.join(topicDir, "draft-slug-wave.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: packetId,
        topic_id: createPayload.topicId,
        wave_id: waveId,
        packet_kind: "implementation",
        status: "draft",
        authority_owner: [".nimi/spec/avatar/kernel/agent-script-contract.md"],
        canonical_seams: [".nimi/spec/avatar/kernel/agent-script-contract.md"],
        forbidden_shortcuts: ["legacy_alias"],
        acceptance_invariants: ["slug-shaped wave lifecycle artifacts remain canonical"],
        negative_tests: ["validator rejects fake numeric aliases"],
        reopen_conditions: ["wave id ownership changes"],
      }),
      "utf8",
    );

    const freezeResult = await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    assert.equal(freezeResult.exitCode, 0);
    const freezePayload = JSON.parse(freezeResult.stdout);
    assert.equal(freezePayload.packetRef, `.nimi/topics/ongoing/${createPayload.topicId}/packet-${packetId}.md`);

    const sourcePath = path.join(topicDir, "source-slug-wave-audit.md");
    await writeFile(sourcePath, "# Slug Wave Audit\n\nverdict: PASS\n", "utf8");
    const resultRecord = await captureRunCli([
      "topic", "result", "record", createPayload.topicId,
      "--kind", "audit",
      "--verdict", "PASS",
      "--from", sourcePath,
      "--verified-at", "2026-05-07T00:00:00Z",
      "--json",
    ]);
    assert.equal(resultRecord.exitCode, 0);
    const resultPayload = JSON.parse(resultRecord.stdout);
    assert.equal(resultPayload.resultRef, `.nimi/topics/ongoing/${createPayload.topicId}/result-${waveId}-audit.md`);

    const closeoutResult = await captureRunCli([
      "topic", "closeout", "wave", createPayload.topicId, waveId,
      "--authority", "closed",
      "--semantic", "closed",
      "--consumer", "closed",
      "--drift-resistance", "closed",
      "--disposition", "complete",
      "--json",
    ]);
    assert.equal(closeoutResult.exitCode, 0);
    const closeoutPayload = JSON.parse(closeoutResult.stdout);
    assert.equal(closeoutPayload.closeoutRef, `.nimi/topics/ongoing/${createPayload.topicId}/closeout-${waveId}.md`);

    const validateResult = await captureRunCli(["topic", "validate", createPayload.topicId, "--json"]);
    assert.equal(validateResult.exitCode, 0);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
    assert.ok(validatePayload.checks.some((entry) => entry.id === "artifact_naming_unambiguous" && entry.ok === true));

    const graphResult = await captureRunCli(["topic", "validate", "graph", createPayload.topicId, "--json"]);
    assert.equal(graphResult.exitCode, 0);
    assert.equal(JSON.parse(graphResult.stdout).ok, true);
  });
});
