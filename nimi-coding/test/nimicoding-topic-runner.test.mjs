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

test("topic-runner stops on human gates without executing placeholder commands", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-human-gate",
      "--justification",
      "runner human gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    const runnerResult = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "runner-human-gate",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 0);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.executed, false);
    assert.equal(payload.stopClass, "require_human_confirmation");
    assert.equal(payload.recommendedAction, "admit_wave");
    assert.match(payload.decision.next_command_ref, /<wave-id>/);
    assert.equal(payload.gate.reasonCode, "no_selected_next_target");
    assert.equal(payload.gate.recommendedAction, "admit_wave");
    assert.match(payload.gate.nextCommandRef, /<wave-id>/);

    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, createPayload.topicRef, "run-ledger-runner-human-gate.yaml"),
      "utf8",
    ));
    assert.equal(ledger.event_count, 1);
    assert.equal(ledger.current_human_gate.recommended_action, "admit_wave");
    assert.match(ledger.latest_decision_ref, /runner-decision-runner-human-gate-0001\.json/);
  });
});

test("topic-runner run records a runner_blocked event when the max-step circuit breaker opens", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-circuit-breaker",
      "--justification",
      "runner circuit breaker demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-runner", "runner",
      "--goal", "trip runner max step breaker", "--owner-domain", "nimicoding/topic-runner", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-runner", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-runner", "--json"]);

    const draftPath = path.join(projectRoot, "runner-breaker-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-runner",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-runner",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic-runner"],
        canonical_seams: ["runner circuit breaker"],
        forbidden_shortcuts: ["unbounded retry"],
        acceptance_invariants: ["max step exhaustion records runner_blocked"],
        negative_tests: ["max step exhaustion is not success"],
        reopen_conditions: ["runner needs hidden retry state"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json"]);

    const runnerResult = await captureRunCli([
      "topic-runner",
      "run",
      createPayload.topicId,
      "--run-id",
      "runner-circuit-breaker",
      "--adapter",
      "codex",
      "--max-steps",
      "1",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 1);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.runnerStatus, "blocked");
    assert.equal(payload.circuitBreaker.state, "open");
    assert.equal(payload.circuitBreaker.reason, "max_steps_exhausted");

    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, payload.topicRef, "run-ledger-runner-circuit-breaker.yaml"),
      "utf8",
    ));
    assert.equal(ledger.run_status, "blocked");
    assert.equal(ledger.event_count, 3);
    assert.deepEqual(ledger.event_refs, [
      "run-event-runner-circuit-breaker-0001-decision_emitted.yaml",
      "run-event-runner-circuit-breaker-0002-worker_dispatched.yaml",
      "run-event-runner-circuit-breaker-0003-runner_blocked.yaml",
    ]);
  });
});

test("topic-runner run executes mechanical dispatch and records run-ledger lineage", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-dispatch",
      "--justification",
      "runner dispatch demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-runner", "runner",
      "--goal", "dispatch via topic runner", "--owner-domain", "nimicoding/topic-runner", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-runner", "--json"]);

    const topicDir = path.join(projectRoot, createPayload.topicRef);
    const draftPath = path.join(topicDir, "draft-runner-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-runner",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-runner",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic-runner"],
        canonical_seams: ["runner dispatch command"],
        forbidden_shortcuts: ["manual run-ledger primitive chain"],
        acceptance_invariants: ["topic-runner records decision and dispatch"],
        negative_tests: ["placeholder command is refused"],
        reopen_conditions: ["runner needs semantic ownership"],
      }),
      "utf8",
    );

    const runnerResult = await captureRunCli([
      "topic-runner",
      "run",
      createPayload.topicId,
      "--run-id",
      "runner-dispatch",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 0);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.mode, "run");
    assert.equal(payload.stepCount, 4);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "await_external_evidence");
    assert.equal(payload.steps[0].runnerStatus, "continued");
    assert.equal(payload.steps[0].recommendedAction, "admit_wave");
    assert.equal(payload.steps[0].command.waveState, "preflight_admitted");
    assert.equal(payload.steps[1].recommendedAction, "freeze_packet");
    assert.equal(payload.steps[1].command.packetId, "wave-1-runner");
    assert.equal(payload.steps[2].runnerStatus, "continued");
    assert.equal(payload.steps[2].dispatch.role, "worker");

    await readFile(path.join(projectRoot, payload.steps[2].dispatch.promptRef), "utf8");
    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, payload.topicRef, "run-ledger-runner-dispatch.yaml"),
      "utf8",
    ));
    assert.equal(ledger.event_count, 7);
    assert.deepEqual(ledger.event_refs, [
      "run-event-runner-dispatch-0001-decision_emitted.yaml",
      "run-event-runner-dispatch-0002-wave_admitted.yaml",
      "run-event-runner-dispatch-0003-decision_emitted.yaml",
      "run-event-runner-dispatch-0004-packet_frozen.yaml",
      "run-event-runner-dispatch-0005-decision_emitted.yaml",
      "run-event-runner-dispatch-0006-worker_dispatched.yaml",
      "run-event-runner-dispatch-0007-decision_emitted.yaml",
    ]);
    assert.equal(ledger.latest_packet_ref, `${payload.topicRef}/packet-wave-1-runner.md`);
    assert.equal(ledger.latest_prompt_ref, `${payload.topicRef}/prompt-wave-1-runner-worker.md`);
    assert.equal(ledger.current_human_gate, null);
    assert.equal(ledger.run_status, "awaiting_external_evidence");
  });
});

test("topic-runner completed stop does not true-close the topic", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-completed-boundary",
      "--justification",
      "runner completed boundary demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-runner", "runner",
      "--goal", "prove runner completion is not true-close", "--owner-domain", "nimicoding/topic-runner", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-runner", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-runner", "--json"]);

    const draftPath = path.join(projectRoot, "runner-completed-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-runner",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-runner",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic-runner"],
        canonical_seams: ["runner completed stop is operational only"],
        forbidden_shortcuts: ["runner_true_close_promotion"],
        acceptance_invariants: ["completed stop records ledger only"],
        negative_tests: ["completed stop creates no true-close artifacts"],
        reopen_conditions: ["runner closes topic without true-close audit"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json"]);
    await captureRunCli(["topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-runner", "--json"]);

    const resultSource = path.join(projectRoot, "runner-completed-result.md");
    await writeFile(resultSource, "# Runner Result\n\nCompleted boundary evidence.\n", "utf8");
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
      "2026-04-24T00:00:00Z",
      "--json",
    ]);
    await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-runner",
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

    const runnerResult = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "runner-completed-boundary",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 0);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.executed, false);
    assert.equal(payload.stopClass, "completed");
    assert.equal(payload.recommendedAction, "closeout_topic");
    assert.equal(payload.gate.stopClass, "completed");

    const topicDir = path.join(projectRoot, payload.topicRef);
    const ledger = YAML.parse(await readFile(
      path.join(topicDir, "run-ledger-runner-completed-boundary.yaml"),
      "utf8",
    ));
    assert.equal(ledger.run_status, "completed");
    assert.equal(ledger.event_count, 1);
    await assert.rejects(readFile(path.join(topicDir, "topic-true-close-audit.md"), "utf8"));
    await assert.rejects(readFile(path.join(topicDir, "topic-true-close-record.md"), "utf8"));
  });
});

test("topic worker dispatch writes a prompt artifact and moves the selected wave into active implementation", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "dispatch-demo",
      "--justification",
      "dispatch discipline demo",
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

    const draftPath = path.join(projectRoot, "dispatch-packet.yaml");
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
        acceptance_invariants: ["packet fields remain explicit"],
        negative_tests: ["missing packet id fails"],
        reopen_conditions: ["owner-cut change reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);

    const dispatchResult = await captureRunCli([
      "topic",
      "worker",
      "dispatch",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-implementation",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);
    const dispatchPayload = JSON.parse(dispatchResult.stdout);
    assert.equal(dispatchPayload.ok, true);
    assert.equal(dispatchPayload.command, "topic.worker.dispatch");
    assert.equal(dispatchPayload.waveState, "implementation_active");

    const promptText = await readFile(path.join(projectRoot, dispatchPayload.promptRef), "utf8");
    assert.match(promptText, /# Worker Dispatch/);
    assert.match(promptText, /Packet: `wave-1-foundation-implementation`/);

    const topicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    const wave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(wave.state, "implementation_active");

    const packetText = await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "packet-wave-1-foundation-implementation.md"),
      "utf8",
    );
    assert.match(packetText, /status: dispatched/);
  });
});

test("topic audit dispatch writes an audit prompt without mutating the wave back out of implementation flow", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "audit-dispatch-demo",
      "--justification",
      "audit dispatch coverage",
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

    const draftPath = path.join(projectRoot, "audit-dispatch-packet.yaml");
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
        acceptance_invariants: ["audit prompt remains packet-bound"],
        negative_tests: ["missing packet fails"],
        reopen_conditions: ["owner-cut drift reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);

    const auditDispatch = await captureRunCli([
      "topic",
      "audit",
      "dispatch",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-implementation",
      "--json",
    ]);
    assert.equal(auditDispatch.exitCode, 0);
    const auditPayload = JSON.parse(auditDispatch.stdout);
    assert.equal(auditPayload.ok, true);
    assert.equal(auditPayload.command, "topic.audit.dispatch");

    const promptText = await readFile(path.join(projectRoot, auditPayload.promptRef), "utf8");
    assert.match(promptText, /# Audit Dispatch/);
    assert.match(promptText, /Role: `audit`/);
  });
});

test("topic result record writes result artifacts and updates wave state by verdict", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "result-demo",
      "--justification",
      "result recording demo",
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

    const draftPath = path.join(projectRoot, "result-packet.yaml");
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
        acceptance_invariants: ["result lineage remains wave-bound"],
        negative_tests: ["missing packet lineage fails"],
        reopen_conditions: ["owner-cut drift reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);

    const sourcePath = path.join(projectRoot, "worker-result.md");
    await writeFile(sourcePath, "# Worker Result\n\nImplementation closed.\n", "utf8");

    const passResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "preflight",
      "--verdict",
      "PASS",
      "--from",
      sourcePath,
      "--verified-at",
      "2026-04-23T10:00:00Z",
      "--json",
    ]);
    assert.equal(passResult.exitCode, 0);
    const passPayload = JSON.parse(passResult.stdout);
    assert.equal(passPayload.ok, true);
    assert.equal(passPayload.waveState, "implementation_admitted");
    assert.equal(passPayload.resultKind, "preflight");

    const overflowResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "OVERFLOW",
      "--from",
      sourcePath,
      "--verified-at",
      "2026-04-23T11:00:00Z",
      "--json",
    ]);
    assert.equal(overflowResult.exitCode, 0);
    const overflowPayload = JSON.parse(overflowResult.stdout);
    assert.equal(overflowPayload.ok, true);
    assert.equal(overflowPayload.waveState, "overflowed");

    const resultText = await readFile(path.join(projectRoot, overflowPayload.resultRef), "utf8");
    assert.match(resultText, /result_kind: audit/);
    assert.match(resultText, /verdict: OVERFLOW/);

    const invalidTimestamp = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      sourcePath,
      "--verified-at",
      "2026-04-23 11:00:00",
      "--json",
    ]);
    assert.equal(invalidTimestamp.exitCode, 1);
    assert.match(invalidTimestamp.stderr, /ISO-8601 UTC timestamp/);
  });
});

test("topic decision-review records owner-cut changes and can supersede the selected wave", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "decision-review-demo",
      "--justification",
      "owner-cut review demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId);

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

    const reviewResult = await captureRunCli([
      "topic",
      "decision-review",
      createPayload.topicId,
      "re-cut-foundation",
      "--decision",
      "wave-1 is no longer the active owner cut",
      "--replaced-scope",
      "foundation packet line",
      "--active-replacement-scope",
      "wave-2-follow-on",
      "--disposition",
      "superseded",
      "--target-wave",
      "wave-1-foundation",
      "--date",
      "2026-04-23",
      "--json",
    ]);
    assert.equal(reviewResult.exitCode, 0);
    const reviewPayload = JSON.parse(reviewResult.stdout);
    assert.equal(reviewPayload.ok, true);
    assert.equal(reviewPayload.disposition, "superseded");
    assert.equal(reviewPayload.targetWaveId, "wave-1-foundation");

    const topicYaml = YAML.parse(await readFile(path.join(topicDir, "topic.yaml"), "utf8"));
    const retiredWave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(retiredWave.state, "superseded");
    assert.equal(retiredWave.selected, false);
    assert.equal(topicYaml.selected_next_target, "wave-2-follow-on");

    const reviewText = await readFile(path.join(topicDir, "decision-review-re-cut-foundation.md"), "utf8");
    assert.match(reviewText, /decision_review_id: re-cut-foundation/);
    assert.match(reviewText, /disposition: superseded/);

    const invalidReview = await captureRunCli([
      "topic",
      "decision-review",
      createPayload.topicId,
      "bad-re-cut",
      "--decision",
      "replacement scope is not machine identifiable",
      "--replaced-scope",
      "foundation packet line",
      "--active-replacement-scope",
      "freeform-note",
      "--disposition",
      "unchanged",
      "--date",
      "2026-04-23",
      "--json",
    ]);
    assert.equal(invalidReview.exitCode, 1);
    assert.match(invalidReview.stderr, /machine-identifiable/);
  });
});

test("topic remediation open records explicit remediation lineage and moves the wave into needs_revision", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "remediation-demo",
      "--justification",
      "explicit remediation lineage demo",
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

    const remediationResult = await captureRunCli([
      "topic",
      "remediation",
      "open",
      createPayload.topicId,
      "--kind",
      "a",
      "--reason",
      "split-owner-cut",
      "--json",
    ]);
    assert.equal(remediationResult.exitCode, 0);
    const remediationPayload = JSON.parse(remediationResult.stdout);
    assert.equal(remediationPayload.ok, true);
    assert.equal(remediationPayload.kind, "a");
    assert.equal(remediationPayload.waveState, "needs_revision");

    const topicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    const wave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(wave.state, "needs_revision");

    const remediationText = await readFile(path.join(projectRoot, remediationPayload.remediationRef), "utf8");
    assert.match(remediationText, /remediation_id: wave-1-foundation-remediation-a-split-owner-cut/);
    assert.match(remediationText, /kind: a/);
  });
});

test("topic overflow continue records explicit continuation lineage and reopens dispatch through continuation_packet_open", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "overflow-demo",
      "--justification",
      "explicit overflow continuation demo",
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

    const initialPacketDraft = path.join(projectRoot, "initial-overflow-packet.yaml");
    await writeFile(
      initialPacketDraft,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["packet fields remain explicit"],
        negative_tests: ["missing packet id fails"],
        reopen_conditions: ["owner-cut change reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", initialPacketDraft, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);

    const overflowResultSource = path.join(projectRoot, "overflow-result.md");
    await writeFile(overflowResultSource, "# Overflow\n\nPacket boundary was too thin.\n", "utf8");
    const overflowResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "OVERFLOW",
      "--from",
      overflowResultSource,
      "--verified-at",
      "2026-04-23T12:00:00Z",
      "--json",
    ]);
    assert.equal(overflowResult.exitCode, 0);
    const overflowPayload = JSON.parse(overflowResult.stdout);
    assert.equal(overflowPayload.waveState, "overflowed");

    const continuationPacketDraft = path.join(projectRoot, "continuation-packet.yaml");
    await writeFile(
      continuationPacketDraft,
      YAML.stringify({
        packet_id: "wave-1-foundation-continuation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["continuation stays inside owner domain"],
        negative_tests: ["cross-domain continuation fails"],
        reopen_conditions: ["owner-cut drift reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", continuationPacketDraft, "--json",
    ]);

    const continueResult = await captureRunCli([
      "topic",
      "overflow",
      "continue",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-continuation",
      "--overflowed-packet",
      "wave-1-foundation-implementation",
      "--manager-judgement",
      "direction stayed correct and owner domain did not move",
      "--same-owner-domain",
      "--json",
    ]);
    assert.equal(continueResult.exitCode, 0);
    const continuePayload = JSON.parse(continueResult.stdout);
    assert.equal(continuePayload.ok, true);
    assert.equal(continuePayload.waveState, "continuation_packet_open");

    const continuationText = await readFile(path.join(projectRoot, continuePayload.continuationRef), "utf8");
    assert.match(continuationText, /overflowed_packet_id: wave-1-foundation-implementation/);
    assert.match(continuationText, /continuation_packet_id: wave-1-foundation-continuation/);
    assert.match(continuationText, /same_owner_domain: true/);

    const dispatchContinuation = await captureRunCli([
      "topic",
      "worker",
      "dispatch",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-continuation",
      "--json",
    ]);
    assert.equal(dispatchContinuation.exitCode, 0);
    const dispatchPayload = JSON.parse(dispatchContinuation.stdout);
    assert.equal(dispatchPayload.waveState, "implementation_active");
  });
});
