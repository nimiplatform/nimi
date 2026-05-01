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
    assert.equal(dispatchDecision.stop_class, "continue");
    assert.equal(dispatchDecision.recommended_action, "dispatch_worker");
    assert.equal(dispatchDecision.requires_human_confirmation, false);

    const movedTopicYamlPath = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml");
    const topicYaml = YAML.parse(await readFile(movedTopicYamlPath, "utf8"));
    const wave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(wave.state, "preflight_admitted");
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
