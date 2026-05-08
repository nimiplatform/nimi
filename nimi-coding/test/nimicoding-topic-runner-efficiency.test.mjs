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

async function loadTopicYamlPath(projectRoot, topicId) {
  for (const state of ["ongoing", "proposal", "pending", "closed"]) {
    const candidate = path.join(projectRoot, ".nimi", "topics", state, topicId, "topic.yaml");
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // keep searching lifecycle roots
    }
  }
  throw new Error(`topic.yaml not found for ${topicId}`);
}

async function mutateTopicYaml(projectRoot, topicId, mutator) {
  const topicYamlPath = await loadTopicYamlPath(projectRoot, topicId);
  const topic = YAML.parse(await readFile(topicYamlPath, "utf8"));
  await mutator(topic);
  await writeFile(topicYamlPath, YAML.stringify(topic), "utf8");
  return { topicYamlPath, topic };
}

async function createDeferralDemoTopic(
  projectRoot,
  slug,
  {
    nextDep = null,
    globalBlocker = false,
    missingEvidenceFlags = false,
    omitMissingAuthorityRefs = false,
    vagueMissingAuthorityRefs = false,
    broadAuthorityScopeAmbiguity = false,
    productSemanticAmbiguity = false,
    productSemanticDecision = false,
    sourceAuditMutation = false,
    sourceSweepDesignMutation = false,
    loweredGate = false,
    sourceEvidenceChange = false,
    destructiveEvidenceDeletion = false,
    explicitHumanDecision = false,
  } = {},
) {
  const startResult = await captureRunCli(["start"]);
  assert.equal(startResult.exitCode, 0);

  const createResult = await captureRunCli([
    "topic",
    "create",
    slug,
    "--justification",
    `${slug} deferral demo`,
    "--json",
  ]);
  assert.equal(createResult.exitCode, 0, createResult.stderr);
  const createPayload = JSON.parse(createResult.stdout);

  await captureRunCli([
    "topic", "wave", "add", createPayload.topicId, "wave-1-blocked", "blocked",
    "--goal", "local packet authority remediation", "--owner-domain", "apps/desktop", "--json",
  ]);
  const nextArgs = [
    "topic", "wave", "add", createPayload.topicId, "wave-2-next", "next",
    "--goal", "independent ready wave", "--owner-domain", "apps/desktop",
  ];
  if (nextDep) {
    nextArgs.push("--dep", nextDep);
  }
  nextArgs.push("--json");
  await captureRunCli(nextArgs);
  await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-blocked", "--json"]);
  await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-blocked", "--json"]);

  const packetPath = path.join(projectRoot, `${slug}-packet.yaml`);
  await writeFile(
    packetPath,
    YAML.stringify({
      packet_id: "wave-1-blocked-audit",
      topic_id: createPayload.topicId,
      wave_id: "wave-1-blocked",
      packet_kind: "audit",
      status: "draft",
      authority_owner: ["nimi-coding/topic-runner"],
      canonical_seams: ["topic.yaml waves[]", "topic runner deferred blocker evidence"],
      forbidden_shortcuts: ["placeholder_success", "record_result_without_packet_lineage"],
      acceptance_invariants: ["local blocker evidence must keep packet lineage"],
      negative_tests: ["result recording without packet lineage fails closed"],
      reopen_conditions: ["authority or scope changes require a new packet"],
    }),
    "utf8",
  );
  const freezeResult = await captureRunCli([
    "topic", "packet", "freeze", createPayload.topicId, "--from", packetPath, "--json",
  ]);
  assert.equal(freezeResult.exitCode, 0, freezeResult.stderr);

  const auditSource = path.join(projectRoot, `${slug}-audit.md`);
  await writeFile(
    auditSource,
    [
      "# Local Blocker Audit",
      "",
      "verdict: NEEDS_REVISION",
      "ready_for_implementation: false",
      "required_remediation: local wave packet authority/scope remediation only",
      "blocking_findings:",
      "- selected wave packet authority requires remediation before implementation",
      ...(omitMissingAuthorityRefs
        ? []
        : [
          "missing_authority_refs:",
          `  - ${vagueMissingAuthorityRefs ? "TBD route authority" : "apps/demo/spec/kernel/route-authority-contract.md"}`,
        ]),
      ...(missingEvidenceFlags
        ? []
        : [
          `source_audit_findings_mutated: ${sourceAuditMutation ? "true" : "false"}`,
          `source_sweep_design_artifacts_mutated: ${sourceSweepDesignMutation ? "true" : "false"}`,
          `lowered_gate: ${loweredGate ? "true" : "false"}`,
          `topic_global_contract_change_required: ${globalBlocker ? "true" : "false"}`,
          `source_evidence_change_required: ${sourceEvidenceChange ? "true" : "false"}`,
          `destructive_evidence_deletion_required: ${destructiveEvidenceDeletion ? "true" : "false"}`,
          `explicit_human_decision_packet: ${explicitHumanDecision ? "true" : "false"}`,
          "local_packet_authority_scope_remediation_only: true",
          `product_semantic_ambiguity: ${productSemanticAmbiguity ? "true" : "false"}`,
          `product_semantic_decision_required: ${productSemanticDecision ? "true" : "false"}`,
        ]),
      ...(globalBlocker
        ? [
          "topic_contract_change_required: true",
          "required_manager_decision: global topic contract change",
        ]
        : []),
      ...(broadAuthorityScopeAmbiguity
        ? [
          "unresolved_authority_scope_gate_product_semantic_ambiguity: true",
          "authority/scope mismatch in the packet metadata, not a product fork",
        ]
        : []),
      ...(productSemanticDecision
        ? [
          "required_manager_decision: product semantics fork",
        ]
        : []),
      "",
    ].join("\n"),
    "utf8",
  );
  const recordResult = await captureRunCli([
    "topic", "result", "record", createPayload.topicId,
    "--kind", "audit",
    "--verdict", "NEEDS_REVISION",
    "--from", auditSource,
    "--verified-at", "2026-05-04T00:00:00Z",
    "--json",
  ]);
  assert.equal(recordResult.exitCode, 0, recordResult.stderr);

  await mutateTopicYaml(projectRoot, createPayload.topicId, (topic) => {
    topic.selected_next_target = "wave-1-blocked";
    topic.waves = topic.waves.map((wave) => {
      if (wave.wave_id === "wave-1-blocked") {
        return {
          ...wave,
          goal: globalBlocker ? "global topic contract blocker" : wave.goal,
          state: "needs_revision",
          selected: true,
          ...(globalBlocker ? { blocker_scope: "global_topic_contract" } : {}),
        };
      }
      if (wave.wave_id === "wave-2-next") {
        return { ...wave, state: "candidate", selected: false };
      }
      return wave;
    });
  });

  return createPayload;
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
    const sourcePath = await addSweepSourceDesign(projectRoot, createPayload.topicRef, "wave-sweep-draft", {
      authority_owner: ".nimi/spec/platform/kernel/governance-contract.md",
      merged_root_cause_keys: [
        ".nimi/spec/platform/kernel/governance-contract.md",
        ".nimi/spec/platform/kernel/package-authority-admission-contract.md",
        "wave-sweep-draft",
      ],
    });
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
    const draftPacket = YAML.parse(await readFile(draftPath, "utf8"));
    assert.deepEqual(draftPacket.authority_owner, [
      ".nimi/spec/platform/kernel/governance-contract.md",
      ".nimi/spec/platform/kernel/package-authority-admission-contract.md",
    ]);
    assert.ok(draftPacket.canonical_seams.includes(".nimi/spec/platform/kernel/package-authority-admission-contract.md"));
    assert.match(await readFile(packetPath, "utf8"), /source_design_packet_refs/);
    assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
  });
});

test("topic runner refuses sweep-fix draft packets missing source authority coverage", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-sweep-authority-coverage-demo",
      "--justification",
      "runner sweep authority coverage demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-sweep-authority", "sweep-authority",
      "--goal", "refuse incomplete authority coverage", "--owner-domain", "ci", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-sweep-authority", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-sweep-authority", "--json"]);
    await addSweepSourceDesign(projectRoot, createPayload.topicRef, "wave-sweep-authority", {
      authority_owner: ".nimi/spec/platform/kernel/governance-contract.md",
      merged_root_cause_keys: [
        ".nimi/spec/platform/kernel/governance-contract.md",
        ".nimi/spec/platform/kernel/package-authority-admission-contract.md",
      ],
    });

    const topicYamlPath = await loadTopicYamlPath(projectRoot, createPayload.topicId);
    const topicDir = path.dirname(topicYamlPath);
    await writeFile(path.join(topicDir, "draft-wave-sweep-authority-implementation.yaml"), YAML.stringify({
      packet_id: "wave-sweep-authority-implementation",
      topic_id: createPayload.topicId,
      wave_id: "wave-sweep-authority",
      packet_kind: "implementation",
      status: "draft",
      authority_owner: [".nimi/spec/platform/kernel/governance-contract.md"],
      canonical_seams: [".nimi/spec/platform/kernel/governance-contract.md"],
      forbidden_shortcuts: ["mvp_subset_contract"],
      acceptance_invariants: ["Validation evidence exists."],
      negative_tests: ["No pseudo-success."],
      reopen_conditions: ["Source sweep-design provenance remains read-only."],
    }), "utf8");

    const stepResult = await captureRunCli([
      "topic-runner", "step", createPayload.topicId,
      "--run-id", "sweep-authority-coverage-demo",
      "--adapter", "codex",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(stepResult.exitCode, 0, stepResult.stderr);
    const payload = JSON.parse(stepResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "require_human_confirmation");
    assert.equal(payload.decision.reason_code, "admitted_wave_packet_authority_coverage_incomplete");
    assert.deepEqual(payload.decision.blocking_checks, []);
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

test("topic runner run defers a local needs_revision blocker and advances to next ready wave", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-defers-local-blocker-demo");

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "defer-local-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.steps[0].runnerStatus, "continued");
    assert.equal(payload.steps[0].recommendedAction, "defer_local_wave_blocker");
    assert.equal(payload.steps[0].deferredBlocker.waveId, "wave-1-blocked");
    assert.equal(payload.steps[0].deferredBlocker.nextWaveId, "wave-2-next");

    const blockerRef = payload.steps[0].deferredBlocker.blockerRef;
    const blockerText = await readFile(path.join(projectRoot, blockerRef), "utf8");
    assert.match(blockerText, /deferrable_scope: local_wave/);
    assert.match(blockerText, /status: active/);
    assert.match(blockerText, /missing_authority_refs:/);
    assert.match(blockerText, /apps\/demo\/spec\/kernel\/route-authority-contract\.md/);
    assert.match(blockerText, /product_semantic_ambiguity: false/);
    assert.match(blockerText, /local_packet_authority_scope_remediation_only: true/);

    const topicYaml = YAML.parse(await readFile(await loadTopicYamlPath(projectRoot, createPayload.topicId), "utf8"));
    const blockedWave = topicYaml.waves.find((wave) => wave.wave_id === "wave-1-blocked");
    assert.equal(blockedWave.state, "needs_revision");
    assert.equal(topicYaml.selected_next_target, "wave-2-next");
  });
});

test("topic runner run defers local packet authority remediation with structured non-ambiguity evidence", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(
      projectRoot,
      "runner-defers-local-structured-evidence-demo",
    );

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "defer-local-structured-evidence-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.steps[0].runnerStatus, "continued");
    assert.equal(payload.steps[0].recommendedAction, "defer_local_wave_blocker");
    assert.equal(payload.steps[0].deferredBlocker.waveId, "wave-1-blocked");
    assert.equal(payload.steps[0].deferredBlocker.nextWaveId, "wave-2-next");
  });
});

test("topic runner run does not defer local packet remediation with broad unresolved ambiguity", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(
      projectRoot,
      "runner-blocks-local-authority-scope-flag-demo",
      { broadAuthorityScopeAmbiguity: true },
    );

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "block-local-authority-scope-flag-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("topic runner run does not defer local packet authority omissions without concrete missing authority refs", async () => {
  for (const [slug, options] of [
    ["runner-missing-authority-refs-demo", { omitMissingAuthorityRefs: true }],
    ["runner-vague-authority-refs-demo", { vagueMissingAuthorityRefs: true }],
  ]) {
    await withTempProject(async (projectRoot) => {
      const createPayload = await createDeferralDemoTopic(projectRoot, slug, options);

      const runResult = await captureRunCli([
        "topic-runner", "run", createPayload.topicId,
        "--run-id", `${slug}-run`,
        "--adapter", "codex",
        "--max-steps", "3",
        "--verified-at", "2026-05-04T00:00:00Z",
        "--json",
      ]);
      assert.equal(runResult.exitCode, 0, runResult.stderr);
      const payload = JSON.parse(runResult.stdout);
      assert.equal(payload.runnerStatus, "stopped");
      assert.equal(payload.stopClass, "blocked");
      assert.equal(payload.recommendedAction, "open_remediation");
      assert.equal(payload.deferredBlocker, undefined);
    });
  }
});

test("topic runner run does not defer when product semantic ambiguity is true", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-product-ambiguity-blocker-demo", {
      productSemanticAmbiguity: true,
    });

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "product-ambiguity-blocker-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("topic runner run does not let older deferrable evidence mask newer non-deferrable blockers", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(
      projectRoot,
      "runner-latest-non-deferrable-blocker-demo",
    );
    const laterSource = path.join(projectRoot, "runner-latest-non-deferrable-blocker.md");
    await writeFile(
      laterSource,
      [
        "# Later Blocking Result",
        "",
        "verdict: NEEDS_REVISION",
        "source_audit_findings_mutated: false",
        "source_sweep_design_artifacts_mutated: false",
        "lowered_gate: false",
        "topic_global_contract_change_required: false",
        "source_evidence_change_required: false",
        "destructive_evidence_deletion_required: false",
        "explicit_human_decision_packet: false",
        "local_packet_authority_scope_remediation_only: true",
        "product_semantic_ambiguity: true",
        "missing_authority_refs:",
        "  - apps/demo/spec/kernel/route-authority-contract.md",
        "",
      ].join("\n"),
      "utf8",
    );
    const laterResult = await captureRunCli([
      "topic", "result", "record", createPayload.topicId,
      "--kind", "preflight",
      "--verdict", "NEEDS_REVISION",
      "--from", laterSource,
      "--verified-at", "2026-05-04T00:01:00Z",
      "--json",
    ]);
    assert.equal(laterResult.exitCode, 0, laterResult.stderr);

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "latest-non-deferrable-blocker-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:02:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("topic runner run does not defer global source mutation or lowered gate flags", async () => {
  for (const [slug, options] of [
    ["runner-source-audit-mutation-demo", { sourceAuditMutation: true }],
    ["runner-source-sweep-mutation-demo", { sourceSweepDesignMutation: true }],
    ["runner-source-evidence-change-demo", { sourceEvidenceChange: true }],
    ["runner-lowered-gate-demo", { loweredGate: true }],
    ["runner-destructive-evidence-deletion-demo", { destructiveEvidenceDeletion: true }],
    ["runner-explicit-human-decision-demo", { explicitHumanDecision: true }],
    ["runner-global-contract-evidence-demo", { globalBlocker: true }],
  ]) {
    await withTempProject(async (projectRoot) => {
      const createPayload = await createDeferralDemoTopic(projectRoot, slug, options);

      const runResult = await captureRunCli([
        "topic-runner", "run", createPayload.topicId,
        "--run-id", `${slug}-run`,
        "--adapter", "codex",
        "--max-steps", "3",
        "--verified-at", "2026-05-04T00:00:00Z",
        "--json",
      ]);
      assert.equal(runResult.exitCode, 0, runResult.stderr);
      const payload = JSON.parse(runResult.stdout);
      assert.equal(payload.runnerStatus, "stopped");
      assert.equal(payload.stopClass, "blocked");
      assert.equal(payload.recommendedAction, "open_remediation");
      assert.equal(payload.deferredBlocker, undefined);
    });
  }
});

test("topic runner step remains focused and stops on local needs_revision blockers", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-focused-blocker-demo");

    const stepResult = await captureRunCli([
      "topic-runner", "step", createPayload.topicId,
      "--run-id", "focused-blocker-demo",
      "--adapter", "codex",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(stepResult.exitCode, 0, stepResult.stderr);
    const payload = JSON.parse(stepResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("topic runner run does not defer product semantic decision blockers", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-product-semantic-blocker-demo", {
      productSemanticDecision: true,
    });

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "product-semantic-blocker-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("topic runner run does not defer when no independent ready wave exists", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-no-independent-wave-demo", {
      nextDep: "wave-1-blocked",
    });

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "no-independent-wave-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("topic runner run does not defer global authority or contract blockers", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-global-blocker-demo", {
      globalBlocker: true,
    });

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "global-blocker-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("topic runner run does not defer needs_revision blockers without positive non-mutation evidence", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-missing-evidence-flags-demo", {
      missingEvidenceFlags: true,
    });

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "missing-evidence-flags-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);
    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "blocked");
    assert.equal(payload.recommendedAction, "open_remediation");
    assert.equal(payload.deferredBlocker, undefined);
  });
});

test("true-close refuses while deferred local blockers remain unresolved", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-deferral-true-close-demo");

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "deferred-true-close-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);

    const trueCloseResult = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "deferred blocker remains active",
      "--json",
    ]);
    assert.equal(trueCloseResult.exitCode, 1);
    const payload = JSON.parse(trueCloseResult.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((entry) => entry.id === "all_waves_terminal" && entry.ok === false));
  });
});

test("true-close refuses active deferred blocker artifacts even after waves are terminal", async () => {
  await withTempProject(async (projectRoot) => {
    const createPayload = await createDeferralDemoTopic(projectRoot, "runner-deferral-active-artifact-demo");

    const runResult = await captureRunCli([
      "topic-runner", "run", createPayload.topicId,
      "--run-id", "deferred-active-artifact-demo",
      "--adapter", "codex",
      "--max-steps", "3",
      "--verified-at", "2026-05-04T00:00:00Z",
      "--json",
    ]);
    assert.equal(runResult.exitCode, 0, runResult.stderr);

    const topicYamlPath = await loadTopicYamlPath(projectRoot, createPayload.topicId);
    const topicDir = path.dirname(topicYamlPath);
    await mutateTopicYaml(projectRoot, createPayload.topicId, (topic) => {
      topic.selected_next_target = null;
      topic.waves = topic.waves.map((wave) => {
        if (wave.wave_id === "wave-1-blocked") {
          return { ...wave, state: "closed", selected: false };
        }
        if (wave.wave_id === "wave-2-next") {
          return { ...wave, state: "retired", selected: false };
        }
        return wave;
      });
    });
    await writeFile(
      path.join(topicDir, "closeout-wave-1-blocked.md"),
      `---
${YAML.stringify({
  closeout_id: "wave-1-blocked",
  topic_id: createPayload.topicId,
  scope: "wave",
  authority_closure: "closed",
  semantic_closure: "closed",
  consumer_closure: "closed",
  drift_resistance_closure: "closed",
  disposition: "complete",
}).trimEnd()}
---

# Wave Closeout
`,
      "utf8",
    );

    const trueCloseResult = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "active deferred blocker artifact remains",
      "--json",
    ]);
    assert.equal(trueCloseResult.exitCode, 1);
    const payload = JSON.parse(trueCloseResult.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((entry) => entry.id === "all_waves_terminal" && entry.ok === true));
    assert.ok(payload.checks.some((entry) => entry.id === "no_active_deferred_blockers" && entry.ok === false));
  });
});
