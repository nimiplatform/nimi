import {
  mkdir,
  readFile,
  writeFile,
  path,
  test,
  assert,
  YAML,
  captureRunCli,
  withTempProject,
} from "./nimicoding-test-utils.mjs";
import {
  parseMechanicalCommandRef,
} from "../cli/lib/topic-runner.mjs";
import {
  classifyValidationCommandResult,
  runValidationCommandEvidence,
} from "../cli/lib/topic-runner-validation.mjs";

async function addSweepSourceDesign(projectRoot, topicRef, waveId, overrides = {}) {
  const topicId = path.basename(topicRef);
  let topicYamlPath = path.join(projectRoot, topicRef, "topic.yaml");
  for (const state of ["ongoing", "proposal", "pending", "closed"]) {
    const candidate = path.join(projectRoot, ".nimi", "topics", state, topicId, "topic.yaml");
    try {
      await readFile(candidate, "utf8");
      topicYamlPath = candidate;
      break;
    } catch {
      // keep searching lifecycle roots
    }
  }
  const topicYaml = YAML.parse(await readFile(topicYamlPath, "utf8"));
  const sourcePath = path.join(projectRoot, ".nimi", "local", "sweep-design", "runner-test-source.yaml");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, "source: immutable\n", "utf8");
  topicYaml.waves = topicYaml.waves.map((wave) => wave.wave_id === waveId
    ? {
      ...wave,
      source_sweep_design: {
        run_id: "runner-test-sweep",
        authority_owner: ".nimi/spec/platform/kernel/governance-contract.md",
        validation_commands: ["node --test runner-test.mjs"],
        negative_checks: ["No pseudo-success."],
        drift_resistance_checks: ["Source sweep-design provenance remains read-only."],
        closeout_criteria: ["Validation evidence exists."],
        source_design_packet_refs: [".nimi/local/sweep-design/runner-test-source.yaml"],
        design_auditor_result_refs: [".nimi/local/sweep-design/runner-test-source.yaml"],
        revision_ledger_entry_refs: [".nimi/local/sweep-design/runner-test-source.yaml#rev-1"],
        blocked_gate_refs: [],
        ...overrides,
      },
    }
    : wave);
  await writeFile(topicYamlPath, YAML.stringify(topicYaml), "utf8");
  return sourcePath;
}

test("topic runner mechanically records concrete result commands exactly once", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-result-record-demo",
      "--justification",
      "runner result record demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-authority", "authority",
      "--goal", "record concrete result", "--owner-domain", "nimi-coding/spec", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-authority", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-authority", "--json"]);

    const packetPath = path.join(projectRoot, "runner-result-record-packet.yaml");
    await writeFile(
      packetPath,
      YAML.stringify({
        packet_id: "wave-1-authority-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-authority",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: [".nimi/spec/runtime/kernel/example-contract.md"],
        canonical_seams: [".nimi/spec/runtime/kernel/example-contract.md"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["preflight result is recorded by package-owned writer"],
        negative_tests: ["placeholder result command is refused"],
        reopen_conditions: ["authority owner split changes"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json"]);
    await captureRunCli([
      "topic", "audit", "dispatch", createPayload.topicId,
      "--packet", "wave-1-authority-implementation", "--json",
    ]);

    const auditSource = path.join(projectRoot, "runner-result-record-audit.md");
    await writeFile(
      auditSource,
      "# Authority Convergence Audit\n\nverdict: PASS\nready_for_implementation: true\n",
      "utf8",
    );
    await captureRunCli([
      "topic", "result", "record", createPayload.topicId,
      "--kind", "audit",
      "--verdict", "PASS",
      "--from", auditSource,
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);

    const stepResult = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "result-record-demo",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-05-04T00:01:00Z",
      "--json",
    ]);
    assert.equal(stepResult.exitCode, 0, stepResult.stderr);
    const payload = JSON.parse(stepResult.stdout);
    assert.equal(payload.runnerStatus, "continued");
    assert.equal(payload.recommendedAction, "record_result");
    assert.equal(payload.command.resultKind, "preflight");
    assert.equal(payload.command.waveState, "implementation_admitted");

    const ledger = YAML.parse(await readFile(path.join(projectRoot, payload.ledgerRef), "utf8"));
    const resultEvents = ledger.event_refs.filter((ref) => ref.includes("result_recorded"));
    assert.equal(resultEvents.length, 1);
    assert.equal(ledger.latest_result_ref, payload.command.resultRef);
  });
});

test("topic runner result command parser refuses placeholders, wrong topic, and invalid flags", () => {
  const topicId = "2026-05-04-parser-demo";
  assert.equal(
    parseMechanicalCommandRef(
      `nimicoding topic result record ${topicId} --kind implementation --verdict <verdict> --from result.md --verified-at 2026-05-04T00:00:00Z`,
      topicId,
    ).ok,
    false,
  );
  assert.match(
    parseMechanicalCommandRef(
      "nimicoding topic result record 2026-05-04-other --kind implementation --verdict PASS --from result.md --verified-at 2026-05-04T00:00:00Z",
      topicId,
    ).error,
    /does not match/,
  );
  assert.match(
    parseMechanicalCommandRef(
      `nimicoding topic result record ${topicId} --kind implementation --verdict PASS --verified-at 2026-05-04T00:00:00Z`,
      topicId,
    ).error,
    /missing --from/,
  );
});

test("topic runner does not clear unrelated stale human gates", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-unrelated-gate-demo",
      "--justification",
      "runner unrelated gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "admit foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json"]);
    await captureRunCli([
      "topic", "run-ledger", "init", createPayload.topicId,
      "--run-id", "unrelated-gate-demo", "--json",
    ]);

    const decisionRef = "unrelated-decision.json";
    await writeFile(
      path.join(projectRoot, decisionRef),
      `${JSON.stringify({
        stop_class: "require_human_confirmation",
        recommended_action: "admit_wave",
        reason_code: "manual_wave_selection_required",
        expected_artifacts: ["topic.yaml"],
      }, null, 2)}\n`,
      "utf8",
    );
    await captureRunCli([
      "topic", "run-ledger", "record", createPayload.topicId,
      "--run-id", "unrelated-gate-demo",
      "--event", "decision_emitted",
      "--stop-class", "require_human_confirmation",
      "--action", "admit_wave",
      "--source", `${createPayload.topicRef}/topic.yaml`,
      "--summary", "manual wave selection gate",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--artifact", `decision_ref=${decisionRef}`,
      "--json",
    ]);

    const stepResult = await captureRunCli([
      "topic-runner", "step", createPayload.topicId,
      "--run-id", "unrelated-gate-demo",
      "--adapter", "codex",
      "--verified-at", "2026-05-04T00:01:00Z",
      "--json",
    ]);
    assert.equal(stepResult.exitCode, 0, stepResult.stderr);
    const payload = JSON.parse(stepResult.stdout);
    assert.equal(payload.runnerStatus, "continued");
    const ledger = YAML.parse(await readFile(path.join(projectRoot, payload.ledgerRef), "utf8"));
    assert.equal(ledger.event_refs.some((ref) => ref.includes("human_gate_resolved")), false);
    assert.equal(ledger.current_human_gate.recommended_action, "admit_wave");
  });
});

test("topic runner generates and freezes deterministic sweep-fix draft packets", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-sweep-draft-demo",
      "--justification",
      "runner sweep draft demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-sweep-draft", "sweep-draft",
      "--goal", "freeze deterministic sweep draft", "--owner-domain", "ci", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-sweep-draft", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-sweep-draft", "--json"]);
    const sourcePath = await addSweepSourceDesign(projectRoot, createPayload.topicRef, "wave-sweep-draft");
    const sourceBefore = await readFile(sourcePath, "utf8");

    const stepResult = await captureRunCli([
      "topic-runner", "step", createPayload.topicId,
      "--run-id", "sweep-draft-demo",
      "--adapter", "codex",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(stepResult.exitCode, 0, stepResult.stderr);
    const payload = JSON.parse(stepResult.stdout);
    assert.equal(payload.runnerStatus, "continued");
    assert.equal(payload.recommendedAction, "freeze_packet");
    assert.equal(payload.command.packetId, "wave-sweep-draft-implementation");

    const topicDir = path.dirname(path.join(projectRoot, payload.command.packetRef));
    const draftPath = path.join(topicDir, "draft-wave-sweep-draft-implementation.yaml");
    const packetPath = path.join(projectRoot, payload.command.packetRef);
    assert.match(await readFile(draftPath, "utf8"), /packet_id: wave-sweep-draft-implementation/);
    assert.match(await readFile(packetPath, "utf8"), /source_design_packet_refs/);
    assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
  });
});

test("topic runner stops deterministic sweep-fix packet generation when validation commands are missing", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-sweep-missing-validation-demo",
      "--justification",
      "runner sweep missing validation demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-sweep-missing-validation", "sweep-missing-validation",
      "--goal", "refuse missing validation", "--owner-domain", "ci", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-sweep-missing-validation", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-sweep-missing-validation", "--json"]);
    await addSweepSourceDesign(projectRoot, createPayload.topicRef, "wave-sweep-missing-validation", {
      validation_commands: [],
    });

    const stepResult = await captureRunCli([
      "topic-runner", "step", createPayload.topicId,
      "--run-id", "sweep-missing-validation-demo",
      "--adapter", "codex",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(stepResult.exitCode, 0, stepResult.stderr);
    const payload = JSON.parse(stepResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "require_human_confirmation");
    assert.equal(payload.decision.reason_code, "admitted_wave_missing_validation_commands");
  });
});

test("topic runner stops deterministic sweep-fix packet generation on blocked gate refs", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-sweep-blocked-gate-demo",
      "--justification",
      "runner sweep blocked gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-sweep-blocked-gate", "sweep-blocked-gate",
      "--goal", "refuse blocked gate", "--owner-domain", "ci", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-sweep-blocked-gate", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-sweep-blocked-gate", "--json"]);
    await addSweepSourceDesign(projectRoot, createPayload.topicRef, "wave-sweep-blocked-gate", {
      blocked_gate_refs: ["human://authority-decision"],
    });

    const decisionResult = await captureRunCli([
      "topic", "run-next-step", createPayload.topicId, "--json",
    ]);
    assert.equal(decisionResult.exitCode, 0);
    const decision = JSON.parse(decisionResult.stdout).decision;
    assert.equal(decision.stop_class, "require_human_confirmation");
    assert.equal(decision.reason_code, "admitted_wave_has_blocked_gate_refs");
  });
});

test("topic runner validation evidence utility stores full output with concise reports", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-validation-evidence-demo",
      "--justification",
      "runner validation evidence demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    const passReport = await runValidationCommandEvidence(projectRoot, {
      topicInput: createPayload.topicId,
      runId: "validation-evidence-demo",
      validationId: "passing",
      command: "node -e \"console.log('pass-output')\"",
      startedAt: "2026-05-04T00:00:00Z",
      completedAt: "2026-05-04T00:00:01Z",
    });
    assert.equal(passReport.ok, true);
    assert.equal(passReport.status, "pass");
    assert.equal("stdout" in passReport, false);
    const passEvidence = JSON.parse(await readFile(path.join(projectRoot, passReport.evidenceRef), "utf8"));
    assert.match(passEvidence.stdout, /pass-output/);

    const failReport = await runValidationCommandEvidence(projectRoot, {
      topicInput: createPayload.topicId,
      runId: "validation-evidence-demo",
      validationId: "failing",
      command: "node -e \"console.error('fail-output'); process.exit(2)\"",
      startedAt: "2026-05-04T00:00:02Z",
      completedAt: "2026-05-04T00:00:03Z",
    });
    assert.equal(failReport.ok, false);
    assert.equal(failReport.status, "fail");
    assert.match(failReport.summary, /fail-output/);
    const failEvidence = JSON.parse(await readFile(path.join(projectRoot, failReport.evidenceRef), "utf8"));
    assert.match(failEvidence.stderr, /fail-output/);
  });
});

test("topic runner validation classifier refuses no-op filtered package passes", () => {
  const noMatch = classifyValidationCommandResult(
    "pnpm --filter @nimiplatform/missing test",
    0,
    "No projects matched the filters in \"/tmp/project\"\n",
    "",
  );
  assert.equal(noMatch.status, "validation_drift");
  assert.equal(noMatch.passed, false);

  const realPass = classifyValidationCommandResult(
    "pnpm --filter @nimiplatform/sdk test",
    0,
    "tests 12 pass 12\n",
    "",
  );
  assert.equal(realPass.status, "pass");
  assert.equal(realPass.passed, true);

  const nonzero = classifyValidationCommandResult(
    "pnpm --filter @nimiplatform/sdk test",
    1,
    "",
    "test failed\n",
  );
  assert.equal(nonzero.status, "fail");
  assert.equal(nonzero.passed, false);
});
