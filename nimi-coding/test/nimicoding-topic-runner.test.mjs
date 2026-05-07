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

test("topic run-next-step emits mechanical decisions without mutating topic state", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "next-step-demo",
      "--justification",
      "next-step gate demo",
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

    const admitDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(admitDecisionResult.exitCode, 0);
    const admitDecision = JSON.parse(admitDecisionResult.stdout).decision;
    assert.equal(admitDecision.stop_class, "continue");
    assert.equal(admitDecision.recommended_action, "admit_wave");
    assert.equal(admitDecision.requires_human_confirmation, false);
    assert.doesNotMatch(admitDecision.next_command_ref, /</);

    const admitResult = await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    assert.equal(admitResult.exitCode, 0);

    const packetDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(packetDecisionResult.exitCode, 0);
    const packetDecision = JSON.parse(packetDecisionResult.stdout).decision;
    assert.equal(packetDecision.stop_class, "require_human_confirmation");
    assert.equal(packetDecision.recommended_action, "freeze_packet");
    assert.equal(packetDecision.reason_code, "admitted_wave_requires_packet");

    const topicDir = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId);
    const draftPath = path.join(topicDir, "draft-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation",
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

    const freezeDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(freezeDecisionResult.exitCode, 0);
    const freezeDecision = JSON.parse(freezeDecisionResult.stdout).decision;
    assert.equal(freezeDecision.stop_class, "continue");
    assert.equal(freezeDecision.recommended_action, "freeze_packet");
    assert.equal(freezeDecision.reason_code, "draft_packet_ready");
    assert.doesNotMatch(freezeDecision.next_command_ref, /</);

    const freezeResult = await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    assert.equal(freezeResult.exitCode, 0);

    const dispatchDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(dispatchDecisionResult.exitCode, 0);
    const dispatchDecision = JSON.parse(dispatchDecisionResult.stdout).decision;
    assert.equal(dispatchDecision.stop_class, "require_human_confirmation");
    assert.equal(dispatchDecision.recommended_action, "record_result");
    assert.equal(dispatchDecision.reason_code, "implementation_admission_result_required");
    assert.equal(dispatchDecision.requires_human_confirmation, true);

    const movedTopicYamlPath = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml");
    const topicYaml = YAML.parse(await readFile(movedTopicYamlPath, "utf8"));
    const wave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(wave.state, "preflight_admitted");
  });
});

test("authority/spec packet requires audit convergence before worker dispatch", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "authority-convergence-demo",
      "--justification",
      "authority convergence gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-authority", "authority",
      "--goal", "freeze authority before implementation", "--owner-domain", "nimi-coding/spec", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-authority", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-authority", "--json"]);

    const packetPath = path.join(projectRoot, "authority-convergence-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-authority-spec",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-authority",
        packet_kind: "spec",
        status: "draft",
        authority_owner: [".nimi/spec/runtime/kernel/example-contract.md"],
        canonical_seams: [".nimi/spec/runtime/kernel/example-contract.md"],
        forbidden_shortcuts: ["parallel_truth"],
        acceptance_invariants: ["downstream implementation consumes frozen vocabulary"],
        negative_tests: ["worker dispatch before audit convergence is refused"],
        reopen_conditions: ["authority owner split changes"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);

    const auditDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(auditDecisionResult.exitCode, 0);
    const auditDecision = JSON.parse(auditDecisionResult.stdout).decision;
    assert.equal(auditDecision.stop_class, "continue");
    assert.equal(auditDecision.recommended_action, "dispatch_audit");
    assert.equal(auditDecision.reason_code, "authority_convergence_audit_required");
    assert.match(auditDecision.next_command_ref, /audit dispatch/);

    const dispatchAudit = await captureRunCli([
      "topic",
      "audit",
      "dispatch",
      createPayload.topicId,
      "--packet",
      "wave-1-authority-spec",
      "--json",
    ]);
    assert.equal(dispatchAudit.exitCode, 0);
    const dispatchPayload = JSON.parse(dispatchAudit.stdout);
    const promptText = await readFile(path.join(projectRoot, dispatchPayload.promptRef), "utf8");
    assert.match(promptText, /Authority Convergence Audit/);
    assert.match(promptText, /Do not implement code/);

    const awaitingResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(awaitingResult.exitCode, 0);
    const awaitingDecision = JSON.parse(awaitingResult.stdout).decision;
    assert.equal(awaitingDecision.stop_class, "await_external_evidence");
    assert.equal(awaitingDecision.recommended_action, "record_result");
    assert.equal(awaitingDecision.reason_code, "awaiting_authority_convergence_audit_result");

    const auditSource = path.join(projectRoot, "authority-convergence-audit.md");
    await writeFile(
      auditSource,
      "# Authority Convergence Audit\n\nverdict: PASS\nblocking_findings: []\nready_for_implementation: true\n",
      "utf8",
    );
    const recordAudit = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      auditSource,
      "--verified-at",
      "2026-05-04T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(recordAudit.exitCode, 0);
    assert.equal(JSON.parse(recordAudit.stdout).waveState, "preflight_admitted");

    const admissionDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(admissionDecisionResult.exitCode, 0);
    const admissionDecision = JSON.parse(admissionDecisionResult.stdout).decision;
    assert.equal(admissionDecision.stop_class, "continue");
    assert.equal(admissionDecision.recommended_action, "record_result");
    assert.equal(admissionDecision.reason_code, "implementation_admission_result_required");
    assert.doesNotMatch(admissionDecision.next_command_ref, /</);

    const recordPreflight = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "preflight",
      "--verdict",
      "PASS",
      "--from",
      auditSource,
      "--verified-at",
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(recordPreflight.exitCode, 0);
    assert.equal(JSON.parse(recordPreflight.stdout).waveState, "implementation_admitted");

    const workerDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(workerDecisionResult.exitCode, 0);
    const workerDecision = JSON.parse(workerDecisionResult.stdout).decision;
    assert.equal(workerDecision.stop_class, "continue");
    assert.equal(workerDecision.recommended_action, "dispatch_worker");
  });
});

test("implementation-active wave requires implementation result before closeout", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "implementation-result-required-demo",
      "--justification",
      "implementation result lineage gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-impl", "impl",
      "--goal", "implementation result required", "--owner-domain", "nimi-coding/topic", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-impl", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-impl", "--json"]);

    const packetPath = path.join(projectRoot, "implementation-result-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-impl-packet",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-impl",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic implementation result lineage"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["closeout waits for implementation result"],
        negative_tests: ["preflight result alone cannot close implementation"],
        reopen_conditions: ["implementation result missing"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);
    const recordPreflight = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "preflight",
      "--verdict",
      "PASS",
      "--from",
      packetPath,
      "--verified-at",
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(recordPreflight.exitCode, 0);
    assert.equal(JSON.parse(recordPreflight.stdout).waveState, "implementation_admitted");

    const dispatchWorker = await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId,
      "--packet", "wave-1-impl-packet", "--json",
    ]);
    assert.equal(dispatchWorker.exitCode, 0);
    assert.equal(JSON.parse(dispatchWorker.stdout).waveState, "implementation_active");

    const awaitingResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(awaitingResult.exitCode, 0);
    const awaitingDecision = JSON.parse(awaitingResult.stdout).decision;
    assert.equal(awaitingDecision.stop_class, "await_external_evidence");
    assert.equal(awaitingDecision.recommended_action, "record_result");
    assert.equal(awaitingDecision.reason_code, "awaiting_implementation_result");
  });
});

test("redesign topic implementation packet requires authority convergence before worker dispatch", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "redesign-implementation-gate-demo",
      "--justification",
      "redesign implementation gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    const topicYamlPath = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId, "topic.yaml");
    const topicYaml = YAML.parse(await readFile(topicYamlPath, "utf8"));
    topicYaml.work_type = "redesign";
    await writeFile(topicYamlPath, YAML.stringify(topicYaml), "utf8");

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-redesign-impl", "redesign-impl",
      "--goal", "implement redesign authority seam", "--owner-domain", "nimi-coding/sweep", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-redesign-impl", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-redesign-impl", "--json"]);

    const packetPath = path.join(projectRoot, "redesign-implementation-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-redesign-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-redesign-impl",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/sweep"],
        canonical_seams: ["sweep command authority"],
        forbidden_shortcuts: ["legacy_alias"],
        acceptance_invariants: ["implementation waits for authority convergence"],
        negative_tests: ["worker dispatch before audit convergence is refused"],
        reopen_conditions: ["authority owner changes"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);

    const auditDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(auditDecisionResult.exitCode, 0);
    const auditDecision = JSON.parse(auditDecisionResult.stdout).decision;
    assert.equal(auditDecision.stop_class, "continue");
    assert.equal(auditDecision.recommended_action, "dispatch_audit");
    assert.equal(auditDecision.reason_code, "authority_convergence_audit_required");
    assert.match(auditDecision.next_command_ref, /audit dispatch/);

    await captureRunCli([
      "topic", "audit", "dispatch", createPayload.topicId,
      "--packet", "wave-1-redesign-implementation", "--json",
    ]);
    const auditSource = path.join(projectRoot, "redesign-authority-pass.md");
    await writeFile(
      auditSource,
      "# Authority Convergence Audit\n\nverdict: PASS\nblocking_findings: []\nready_for_implementation: true\n",
      "utf8",
    );
    const recordAudit = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      auditSource,
      "--verified-at",
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(recordAudit.exitCode, 0);

    const admissionDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(admissionDecisionResult.exitCode, 0);
    const admissionDecision = JSON.parse(admissionDecisionResult.stdout).decision;
    assert.equal(admissionDecision.stop_class, "continue");
    assert.equal(admissionDecision.recommended_action, "record_result");
    assert.equal(admissionDecision.reason_code, "implementation_admission_result_required");
  });
});

test("authority convergence audit revision blocks worker dispatch", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "authority-convergence-revision-demo",
      "--justification",
      "authority convergence revision demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-authority", "authority",
      "--goal", "freeze authority before implementation", "--owner-domain", "nimi-coding/spec", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-authority", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-authority", "--json"]);

    const packetPath = path.join(projectRoot, "authority-convergence-revision-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-authority-spec",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-authority",
        packet_kind: "spec",
        status: "draft",
        authority_owner: [".nimi/spec/runtime/kernel/example-contract.md"],
        canonical_seams: [".nimi/spec/runtime/kernel/example-contract.md"],
        forbidden_shortcuts: ["parallel_truth"],
        acceptance_invariants: ["downstream implementation consumes frozen vocabulary"],
        negative_tests: ["worker dispatch before audit convergence is refused"],
        reopen_conditions: ["authority owner split changes"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);
    await captureRunCli([
      "topic", "audit", "dispatch", createPayload.topicId,
      "--packet", "wave-1-authority-spec", "--json",
    ]);

    const auditSource = path.join(projectRoot, "authority-convergence-needs-revision.md");
    await writeFile(
      auditSource,
      "# Authority Convergence Audit\n\nverdict: NEEDS_REVISION\nblocking_findings:\n- owner split unresolved\n",
      "utf8",
    );
    const recordAudit = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "NEEDS_REVISION",
      "--from",
      auditSource,
      "--verified-at",
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(recordAudit.exitCode, 0);
    assert.equal(JSON.parse(recordAudit.stdout).waveState, "needs_revision");

    const nextStep = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(nextStep.exitCode, 0);
    const decision = JSON.parse(nextStep.stdout).decision;
    assert.equal(decision.stop_class, "blocked");
    assert.equal(decision.recommended_action, "open_remediation");
    assert.equal(decision.reason_code, "revise");
  });
});

test("preflight authority audit pass requires implementation packet before worker dispatch", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "preflight-authority-audit-demo",
      "--justification",
      "preflight authority audit demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-preflight", "preflight",
      "--goal", "freeze preflight before implementation", "--owner-domain", "nimi-coding/topic", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-preflight", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-preflight", "--json"]);

    const packetPath = path.join(projectRoot, "preflight-authority-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-preflight-authority",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-preflight",
        packet_kind: "preflight",
        status: "draft",
        authority_owner: [".nimi/spec/runtime/kernel/example-contract.md"],
        canonical_seams: [".nimi/spec/runtime/kernel/example-contract.md"],
        forbidden_shortcuts: ["parallel_truth"],
        acceptance_invariants: ["preflight evidence does not dispatch worker"],
        negative_tests: ["preflight audit pass does not equal implementation admission"],
        reopen_conditions: ["implementation packet missing"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);
    await captureRunCli([
      "topic", "audit", "dispatch", createPayload.topicId,
      "--packet", "wave-1-preflight-authority", "--json",
    ]);

    const auditSource = path.join(projectRoot, "preflight-authority-pass.md");
    await writeFile(
      auditSource,
      "# Authority Convergence Audit\n\nverdict: PASS\nblocking_findings: []\nready_for_implementation: false\n",
      "utf8",
    );
    const recordAudit = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      auditSource,
      "--verified-at",
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(recordAudit.exitCode, 0);
    assert.equal(JSON.parse(recordAudit.stdout).waveState, "preflight_admitted");

    const nextStep = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(nextStep.exitCode, 0);
    const decision = JSON.parse(nextStep.stdout).decision;
    assert.equal(decision.stop_class, "require_human_confirmation");
    assert.equal(decision.recommended_action, "freeze_packet");
    assert.equal(decision.reason_code, "preflight_authority_audit_passed_requires_implementation_packet");
  });
});

test("authority convergence audit does not reuse stale pass result for a fresh packet", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "authority-convergence-stale-pass-demo",
      "--justification",
      "authority convergence stale pass demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-authority", "authority",
      "--goal", "freeze authority before implementation", "--owner-domain", "nimi-coding/spec", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-authority", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-authority", "--json"]);

    const packetBase = {
      topic_id: createPayload.topicId,
      wave_id: "wave-1-authority",
      packet_kind: "spec",
      status: "draft",
      authority_owner: [".nimi/spec/runtime/kernel/example-contract.md"],
      canonical_seams: [".nimi/spec/runtime/kernel/example-contract.md"],
      forbidden_shortcuts: ["parallel_truth"],
      acceptance_invariants: ["downstream implementation consumes frozen vocabulary"],
      negative_tests: ["worker dispatch before audit convergence is refused"],
      reopen_conditions: ["authority owner split changes"],
    };
    const firstPacketPath = path.join(projectRoot, "authority-convergence-first-packet.yaml");
    await writeFile(firstPacketPath, YAML.stringify({ ...packetBase, packet_id: "wave-1-authority-first" }), "utf8");
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", firstPacketPath, "--json"]);
    await captureRunCli(["topic", "audit", "dispatch", createPayload.topicId, "--packet", "wave-1-authority-first", "--json"]);

    const auditSource = path.join(projectRoot, "authority-convergence-stale-pass.md");
    await writeFile(auditSource, "# Authority Convergence Audit\n\nverdict: PASS\n", "utf8");
    const recordAudit = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      auditSource,
      "--verified-at",
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(recordAudit.exitCode, 0);

    const topicYamlPath = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml");
    const topicYaml = YAML.parse(await readFile(topicYamlPath, "utf8"));
    topicYaml.waves = topicYaml.waves.map((wave) => (
      wave.wave_id === "wave-1-authority" ? { ...wave, state: "preflight_admitted" } : wave
    ));
    await writeFile(topicYamlPath, YAML.stringify(topicYaml), "utf8");

    const secondPacketPath = path.join(projectRoot, "authority-convergence-second-packet.yaml");
    await writeFile(secondPacketPath, YAML.stringify({ ...packetBase, packet_id: "wave-1-authority-second" }), "utf8");
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", secondPacketPath, "--json"]);

    const nextStep = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(nextStep.exitCode, 0);
    const decision = JSON.parse(nextStep.stdout).decision;
    assert.equal(decision.stop_class, "continue");
    assert.equal(decision.recommended_action, "dispatch_audit");
    assert.equal(decision.reason_code, "authority_convergence_audit_required");
    assert.match(decision.next_command_ref, /wave-1-authority-second/);
  });
});

test("spec implementation pass requires fresh judgement before wave closeout", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "spec-update-review-demo",
      "--justification",
      "spec update review gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-spec", "spec",
      "--goal", "update spec before implementation closeout", "--owner-domain", "nimi-coding/spec", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-spec", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-spec", "--json"]);

    const packetPath = path.join(projectRoot, "spec-update-review-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-spec-authority",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-spec",
        packet_kind: "spec",
        status: "draft",
        authority_owner: [".nimi/spec/runtime/kernel/example-contract.md"],
        canonical_seams: [".nimi/spec/runtime/kernel/example-contract.md"],
        forbidden_shortcuts: ["parallel_truth"],
        acceptance_invariants: ["spec review happens after implementation PASS"],
        negative_tests: ["wave closeout before judgement PASS is refused"],
        reopen_conditions: ["spec authority drift"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);
    await captureRunCli([
      "topic", "audit", "dispatch", createPayload.topicId,
      "--packet", "wave-1-spec-authority", "--json",
    ]);

    const auditSource = path.join(projectRoot, "spec-update-review-audit.md");
    await writeFile(auditSource, "# Authority Convergence Audit\n\nverdict: PASS\n", "utf8");
    const auditResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      auditSource,
      "--verified-at",
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(auditResult.exitCode, 0);

    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId,
      "--packet", "wave-1-spec-authority", "--json",
    ]);

    const staleJudgementSource = path.join(projectRoot, "spec-update-review-stale-judgement.md");
    await writeFile(staleJudgementSource, "# Judgement\n\nPASS before implementation result.\n", "utf8");
    const staleJudgement = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "judgement",
      "--verdict",
      "PASS",
      "--from",
      staleJudgementSource,
      "--verified-at",
      "2026-05-04T00:01:00Z",
      "--json",
    ]);
    assert.equal(staleJudgement.exitCode, 0);

    const implementationSource = path.join(projectRoot, "spec-update-review-implementation.md");
    await writeFile(implementationSource, "# Implementation Result\n\nSpec update landed.\n", "utf8");
    const implementationResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      implementationSource,
      "--verified-at",
      "2026-05-04T00:02:00Z",
      "--json",
    ]);
    assert.equal(implementationResult.exitCode, 0);

    const gatedDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(gatedDecisionResult.exitCode, 0);
    const gatedDecision = JSON.parse(gatedDecisionResult.stdout).decision;
    assert.equal(gatedDecision.stop_class, "require_human_confirmation");
    assert.equal(gatedDecision.recommended_action, "record_result");
    assert.equal(gatedDecision.reason_code, "spec_update_review_required");
    assert.match(gatedDecision.next_command_ref, /--kind judgement/);

    const gatedStep = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "spec-update-review-demo",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-05-04T00:03:00Z",
      "--json",
    ]);
    assert.equal(gatedStep.exitCode, 0);
    const gatedPayload = JSON.parse(gatedStep.stdout);
    assert.equal(gatedPayload.runnerStatus, "stopped");
    assert.equal(gatedPayload.stopClass, "require_human_confirmation");
    const gatedLedger = YAML.parse(await readFile(path.join(projectRoot, gatedPayload.ledgerRef), "utf8"));
    assert.equal(gatedLedger.run_status, "awaiting_human_confirmation");
    assert.equal(gatedLedger.current_human_gate.recommended_action, "record_result");

    const freshJudgementSource = path.join(projectRoot, "spec-update-review-fresh-judgement.md");
    await writeFile(freshJudgementSource, "# Judgement\n\nPASS after implementation result.\n", "utf8");
    const freshJudgement = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "judgement",
      "--verdict",
      "PASS",
      "--from",
      freshJudgementSource,
      "--verified-at",
      "2026-05-04T00:04:00Z",
      "--json",
    ]);
    assert.equal(freshJudgement.exitCode, 0);

    const closeoutDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(closeoutDecisionResult.exitCode, 0);
    const closeoutDecision = JSON.parse(closeoutDecisionResult.stdout).decision;
    assert.equal(closeoutDecision.stop_class, "continue");
    assert.equal(closeoutDecision.recommended_action, "closeout_wave");

    const closeoutStep = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "spec-update-review-demo",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-05-04T00:05:00Z",
      "--json",
    ]);
    assert.equal(closeoutStep.exitCode, 0);
    const closeoutPayload = JSON.parse(closeoutStep.stdout);
    assert.equal(closeoutPayload.runnerStatus, "continued");
    assert.equal(closeoutPayload.recommendedAction, "closeout_wave");
    assert.equal(closeoutPayload.command.waveState, "closed");
    const closedLedger = YAML.parse(await readFile(path.join(projectRoot, closeoutPayload.ledgerRef), "utf8"));
    assert.equal(closedLedger.current_human_gate, null);
  });
});

test("topic runner continues deterministic wave closeout and next-wave transition", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-phase-transition-demo",
      "--justification",
      "runner phase transition demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-2-follow-on", "follow-on",
      "--goal", "close follow-on", "--owner-domain", "nimicoding/topic",
      "--dep", "wave-1-foundation", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json"]);

    const packetPath = path.join(projectRoot, "runner-phase-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["phase transitions stay mechanical when unique"],
        negative_tests: ["ambiguous next waves still require manager choice"],
        reopen_conditions: ["owner-cut drift reopens wave"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId,
      "--packet", "wave-1-foundation-implementation", "--json",
    ]);

    const resultSource = path.join(projectRoot, "runner-phase-result.md");
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
      "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(resultRecord.exitCode, 0);

    const closeoutDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(closeoutDecisionResult.exitCode, 0);
    const closeoutDecision = JSON.parse(closeoutDecisionResult.stdout).decision;
    assert.equal(closeoutDecision.stop_class, "continue");
    assert.equal(closeoutDecision.recommended_action, "closeout_wave");
    assert.equal(closeoutDecision.requires_human_confirmation, false);
    assert.doesNotMatch(closeoutDecision.next_command_ref, /</);

    const closeoutStep = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "phase-transition-demo",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-05-04T00:01:00Z",
      "--json",
    ]);
    assert.equal(closeoutStep.exitCode, 0);
    const closeoutPayload = JSON.parse(closeoutStep.stdout);
    assert.equal(closeoutPayload.runnerStatus, "continued");
    assert.equal(closeoutPayload.recommendedAction, "closeout_wave");
    assert.equal(closeoutPayload.command.waveState, "closed");

    const nextWaveStep = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "phase-transition-demo",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-05-04T00:02:00Z",
      "--json",
    ]);
    assert.equal(nextWaveStep.exitCode, 0);
    const nextWavePayload = JSON.parse(nextWaveStep.stdout);
    assert.equal(nextWavePayload.runnerStatus, "continued");
    assert.equal(nextWavePayload.recommendedAction, "admit_wave");
    assert.equal(nextWavePayload.decision.reason_code, "deterministic_next_wave_ready");

    const topicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    assert.equal(topicYaml.selected_next_target, "wave-2-follow-on");
    assert.equal(topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation").state, "closed");
    assert.notEqual(topicYaml.waves.find((entry) => entry.wave_id === "wave-2-follow-on").state, "candidate");

    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "run-ledger-phase-transition-demo.yaml"),
      "utf8",
    ));
    assert.equal(ledger.run_status, "running");
    assert.equal(ledger.current_human_gate, null);
  });
});

test("topic runner selects first dependency-ready wave in topic order when multiple waves are ready", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-ordered-next-wave-demo",
      "--justification",
      "runner ordered next wave demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-b-second", "second",
      "--goal", "close wave b first because topic order is canonical", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-a-first", "first",
      "--goal", "close wave a second despite lexical order", "--owner-domain", "nimicoding/topic", "--json",
    ]);

    const nextWaveStep = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "ordered-next-wave-demo",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-05-04T00:03:00Z",
      "--json",
    ]);
    assert.equal(nextWaveStep.exitCode, 0, nextWaveStep.stderr);
    const payload = JSON.parse(nextWaveStep.stdout);
    assert.equal(payload.runnerStatus, "continued");
    assert.equal(payload.recommendedAction, "admit_wave");
    assert.equal(payload.decision.reason_code, "deterministic_next_wave_ready");
    assert.equal(payload.decision.wave_id, "wave-b-second");

    const topicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    assert.equal(topicYaml.selected_next_target, "wave-b-second");
    assert.equal(topicYaml.waves.find((entry) => entry.wave_id === "wave-b-second").state, "preflight_admitted");
    assert.equal(topicYaml.waves.find((entry) => entry.wave_id === "wave-a-first").state, "candidate");
  });
});

test("topic run-next-step gates packet freeze when matching drafts are ambiguous", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "next-step-ambiguous-draft",
      "--justification",
      "next-step ambiguous draft demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json"]);

    const topicDir = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId);
    const draftBase = {
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
    };
    await writeFile(
      path.join(topicDir, "draft-a.yaml"),
      YAML.stringify({ ...draftBase, packet_id: "wave-1-foundation-a" }),
      "utf8",
    );
    await writeFile(
      path.join(topicDir, "draft-b.yaml"),
      YAML.stringify({ ...draftBase, packet_id: "wave-1-foundation-b" }),
      "utf8",
    );

    const decisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(decisionResult.exitCode, 0);
    const decision = JSON.parse(decisionResult.stdout).decision;
    assert.equal(decision.stop_class, "require_human_confirmation");
    assert.equal(decision.recommended_action, "freeze_packet");
    assert.equal(decision.reason_code, "admitted_wave_has_ambiguous_draft_packets");
    assert.match(decision.next_command_ref, /<draft-packet>/);
  });
});

test("topic run-ledger records append-only events and rebuilds the run projection", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "run-ledger-demo",
      "--justification",
      "run ledger demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    const initResult = await captureRunCli([
      "topic",
      "run-ledger",
      "init",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--json",
    ]);
    assert.equal(initResult.exitCode, 0);
    const initPayload = JSON.parse(initResult.stdout);
    assert.equal(initPayload.runStatus, "running");
    assert.equal(initPayload.eventCount, 0);

    const decisionRef = "decision-output.json";
    await writeFile(
      path.join(projectRoot, decisionRef),
      `${JSON.stringify({ stop_class: "require_human_confirmation", recommended_action: "admit_wave" }, null, 2)}\n`,
      "utf8",
    );

    const sourceRef = `${createPayload.topicRef}/topic.yaml`;
    const gateResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--event",
      "decision_emitted",
      "--stop-class",
      "require_human_confirmation",
      "--action",
      "admit_wave",
      "--source",
      sourceRef,
      "--summary",
      "manager admission gate emitted",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--artifact",
      `decision_ref=${decisionRef}`,
      "--json",
    ]);
    assert.equal(gateResult.exitCode, 0);
    const gatePayload = JSON.parse(gateResult.stdout);
    assert.equal(gatePayload.runStatus, "awaiting_human_confirmation");
    assert.equal(gatePayload.eventCount, 1);
    assert.equal(gatePayload.ledger.current_human_gate.recommended_action, "admit_wave");

    const resolvedResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--event",
      "human_gate_resolved",
      "--stop-class",
      "continue",
      "--action",
      "admit_wave",
      "--source",
      sourceRef,
      "--summary",
      "manager approved wave admission",
      "--verified-at",
      "2026-04-24T00:01:00Z",
      "--json",
    ]);
    assert.equal(resolvedResult.exitCode, 0);

    const buildResult = await captureRunCli([
      "topic",
      "run-ledger",
      "build",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--json",
    ]);
    assert.equal(buildResult.exitCode, 0);
    const buildPayload = JSON.parse(buildResult.stdout);
    assert.equal(buildPayload.runStatus, "running");
    assert.equal(buildPayload.eventCount, 2);
    assert.equal(buildPayload.ledger.current_human_gate, null);
    assert.deepEqual(buildPayload.ledger.event_refs, [
      "run-event-ralph-loop-demo-0001-decision_emitted.yaml",
      "run-event-ralph-loop-demo-0002-human_gate_resolved.yaml",
    ]);

    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, createPayload.topicRef, "run-ledger-ralph-loop-demo.yaml"),
      "utf8",
    ));
    assert.equal(ledger.kind, "topic-run-ledger");
    assert.equal(ledger.latest_decision_ref, decisionRef);

    await writeFile(path.join(projectRoot, "closeout-wave-1-foundation.md"), "# closeout\n", "utf8");
    const closeResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--event",
      "wave_closed",
      "--stop-class",
      "continue",
      "--action",
      "no_action",
      "--source",
      "closeout-wave-1-foundation.md",
      "--summary",
      "wave closure resolved closeout gate",
      "--verified-at",
      "2026-04-24T00:02:00Z",
      "--artifact",
      "closeout_ref=closeout-wave-1-foundation.md",
      "--json",
    ]);
    assert.equal(closeResult.exitCode, 0);
    const closePayload = JSON.parse(closeResult.stdout);
    assert.equal(closePayload.ledger.current_human_gate, null);
  });
});

test("topic run-ledger fails closed on invalid artifact lineage", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "run-ledger-invalid",
      "--justification",
      "run ledger invalid lineage",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic",
      "run-ledger",
      "init",
      createPayload.topicId,
      "--run-id",
      "invalid-lineage",
      "--json",
    ]);

    const recordResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "invalid-lineage",
      "--event",
      "decision_emitted",
      "--stop-class",
      "continue",
      "--action",
      "dispatch_worker",
      "--source",
      `${createPayload.topicRef}/topic.yaml`,
      "--summary",
      "invalid artifact ref",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--artifact",
      "packet_ref=missing-packet.md",
      "--json",
    ]);
    assert.equal(recordResult.exitCode, 1);
    assert.match(recordResult.stderr, /packet_ref does not resolve to a file/);
  });
});
