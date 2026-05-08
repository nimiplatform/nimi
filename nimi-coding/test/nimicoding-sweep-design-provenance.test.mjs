import {
  mkdir,
  readFile,
  writeFile,
  path,
  test,
  assert,
  YAML,
  withTempProject,
  captureRunCli,
  seedReconstructedTargetTruth,
  seedFrozenAuditSweep,
} from "./nimicoding-test-utils.mjs";

test("sweep design batch packet build creates prompt manifest without mutating source findings", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-design-batch-test",
      actionability: "auto-fix",
      severity: "high",
      findingTitle: "Batch fixture finding",
    });

    const sourceFindingsPath = path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-design-batch-test", "findings.yaml");
    const source = YAML.parse(await readFile(sourceFindingsPath, "utf8"));
    const first = source.findings[0];
    source.findings = Array.from({ length: 5 }, (_, index) => ({
      ...first,
      id: `finding-${String(index + 1).padStart(4, "0")}`,
      title: `Batch fixture finding ${index + 1}`,
      location: { ...first.location, line: index + 1 },
    }));
    await writeFile(sourceFindingsPath, YAML.stringify(source), "utf8");
    const sourceBefore = await readFile(sourceFindingsPath, "utf8");

    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "intake",
      "--sweep-id",
      "audit-sweep-design-batch-test",
      "--run-id",
      "design-batch-test",
      "--json",
    ])).exitCode, 0);

    const batch = await captureRunCli([
      "sweep",
      "design",
      "packet-build-batch",
      "--run-id",
      "design-batch-test",
      "--batch-size",
      "2",
      "--packet-prefix",
      "llm-batch",
      "--manifest-id",
      "llm-batch-manifest",
      "--explicit-question",
      "Produce true LLM final outcomes and deterministic implementation waves.",
      "--json",
    ]);
    assert.equal(batch.exitCode, 0, batch.stderr);
    const payload = JSON.parse(batch.stdout);
    assert.equal(payload.packetCount, 3);
    assert.equal(payload.promptCount, 3);
    assert.equal(payload.findingCount, 5);

    const manifest = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-batch-test", "batch-manifests", "llm-batch-manifest.yaml"), "utf8"));
    assert.equal(manifest.kind, "sweep-design-batch-manifest");
    assert.equal(manifest.generated_artifact_policy, "packets_and_prompts_only_no_auditor_results");
    assert.deepEqual(manifest.packets.map((entry) => entry.finding_ids.length), [2, 2, 1]);
    const prompt = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-batch-test", "auditor-prompts", "llm-batch-0001.yaml"), "utf8"));
    assert.equal(prompt.required_result_origin, "external_llm_session");
    assert.equal(prompt.synthetic_result_policy, "synthetic_trial_results_are_load_tests_only_and_do_not_satisfy_true_llm_closeout");
    assert.equal(await readFile(sourceFindingsPath, "utf8"), sourceBefore);

    const rerun = await captureRunCli([
      "sweep",
      "design",
      "packet-build-batch",
      "--run-id",
      "design-batch-test",
      "--batch-size",
      "2",
      "--packet-prefix",
      "llm-batch",
      "--manifest-id",
      "llm-batch-manifest",
      "--json",
    ]);
    assert.equal(rerun.exitCode, 2);
    assert.match(rerun.stderr, /batch manifest already exists/);

    const invalidBatch = await captureRunCli([
      "sweep",
      "design",
      "packet-build-batch",
      "--run-id",
      "design-batch-test",
      "--batch-size",
      "0",
      "--json",
    ]);
    assert.equal(invalidBatch.exitCode, 2);
    assert.match(invalidBatch.stderr, /--batch-size must be a positive integer/);
  });
});

test("sweep design refuses unstable artifact ids before writing local design refs", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-design-id-boundary",
      actionability: "auto-fix",
      severity: "high",
      findingTitle: "ID boundary fixture finding",
    });

    const badRun = await captureRunCli([
      "sweep",
      "design",
      "intake",
      "--sweep-id",
      "audit-sweep-design-id-boundary",
      "--run-id",
      "../escaped-run",
      "--json",
    ]);
    assert.equal(badRun.exitCode, 2);
    assert.match(badRun.stderr, /--run-id must be a stable id/);

    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "intake",
      "--sweep-id",
      "audit-sweep-design-id-boundary",
      "--run-id",
      "design-id-boundary",
      "--json",
    ])).exitCode, 0);

    const badPacket = await captureRunCli([
      "sweep",
      "design",
      "packet-build",
      "--run-id",
      "design-id-boundary",
      "--packet-id",
      "../escaped-packet",
      "--finding-id",
      "finding-0001",
      "--json",
    ]);
    assert.equal(badPacket.exitCode, 2);
    assert.match(badPacket.stderr, /--packet-id must be a stable id/);

    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "packet-build",
      "--run-id",
      "design-id-boundary",
      "--packet-id",
      "safe-packet",
      "--finding-id",
      "finding-0001",
      "--json",
    ])).exitCode, 0);

    const resultInputRef = ".nimi/local/sweep-design/design-id-boundary/design-auditor-results/bad-result-id-input.yaml";
    await mkdir(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-id-boundary", "design-auditor-results"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ...resultInputRef.split("/")),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-design-auditor-result",
        run_id: "design-id-boundary",
        packet_id: "safe-packet",
        result_id: "../escaped-result",
        auditor: "fixture-auditor",
        auditor_family: "openai_codex",
        auditor_mode: "all",
        auditor_result_origin: "external_llm_session",
        methodology_ref: ".nimi/contracts/sweep-design-result.yaml",
        packet_ref: ".nimi/local/sweep-design/design-id-boundary/design-auditor-packets/safe-packet.yaml",
        session_ref: "codex-session-design-id-boundary",
        transcript_ref: "codex-transcript-design-id-boundary",
        llm_session_ref: "codex-session-design-id-boundary",
        llm_transcript_ref: "codex-transcript-design-id-boundary",
        llm_prompt_ref: ".nimi/local/sweep-design/design-id-boundary/auditor-prompts/safe-packet.yaml",
        result_schema_version: 2,
        provenance: { fixture: true },
        evidence_read: [],
        finding_outcomes: [],
        cluster_changes: [],
        wave_changes: [],
        revision_entries: [],
        human_decision_requests: [],
        extra_audit_requests: [],
        validation_recommendations: [],
        closeout_recommendations: [],
        rejection_status: "accepted",
      }),
      "utf8",
    );

    const badResult = await captureRunCli([
      "sweep",
      "design",
      "result-ingest",
      "--run-id",
      "design-id-boundary",
      "--from",
      resultInputRef,
      "--mode",
      "all",
      "--json",
    ]);
    assert.equal(badResult.exitCode, 2);
    assert.match(badResult.stderr, /result_id must be a stable id/);

    const missingOutcomeInputRef = ".nimi/local/sweep-design/design-id-boundary/design-auditor-results/missing-outcome-input.yaml";
    await writeFile(
      path.join(projectRoot, ...missingOutcomeInputRef.split("/")),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-design-auditor-result",
        run_id: "design-id-boundary",
        packet_id: "safe-packet",
        result_id: "missing-outcome-result",
        auditor: "fixture-auditor",
        auditor_family: "openai_codex",
        auditor_mode: "all",
        auditor_result_origin: "external_llm_session",
        methodology_ref: ".nimi/contracts/sweep-design-result.yaml",
        packet_ref: ".nimi/local/sweep-design/design-id-boundary/design-auditor-packets/safe-packet.yaml",
        session_ref: "codex-session-design-id-boundary",
        transcript_ref: "codex-transcript-design-id-boundary",
        llm_session_ref: "codex-session-design-id-boundary",
        llm_transcript_ref: "codex-transcript-design-id-boundary",
        llm_prompt_ref: ".nimi/local/sweep-design/design-id-boundary/auditor-prompts/safe-packet.yaml",
        result_schema_version: 2,
        provenance: { fixture: true },
        evidence_read: [],
        finding_outcomes: [],
        cluster_changes: [],
        wave_changes: [],
        revision_entries: [],
        human_decision_requests: [],
        extra_audit_requests: [],
        validation_recommendations: [],
        closeout_recommendations: [],
        rejection_status: "accepted",
      }),
      "utf8",
    );
    const missingOutcome = await captureRunCli([
      "sweep",
      "design",
      "result-ingest",
      "--run-id",
      "design-id-boundary",
      "--from",
      missingOutcomeInputRef,
      "--mode",
      "all",
      "--json",
    ]);
    assert.equal(missingOutcome.exitCode, 2);
    assert.match(missingOutcome.stderr, /missing final outcomes for included findings: finding-0001/);
  });
});

test("sweep design fix-topic materializes finalized wave plan into topic waves", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);

    const runId = "design-fix-topic-test";
    const runRoot = path.join(projectRoot, ".nimi", "local", "sweep-design", runId);
    await mkdir(runRoot, { recursive: true });
    await writeFile(
      path.join(runRoot, "inventory.yaml"),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-inventory",
        run_id: runId,
        source_findings_ref: ".nimi/local/audit/evidence/audit-sweep-design-fix-topic/findings.yaml",
        findings: [
          { finding_id: "finding-0001", source_finding_ref: ".nimi/local/audit/evidence/audit-sweep-design-fix-topic/findings.yaml#finding-0001" },
          { finding_id: "finding-0002", source_finding_ref: ".nimi/local/audit/evidence/audit-sweep-design-fix-topic/findings.yaml#finding-0002" },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(runRoot, "final-state-report.yaml"),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-final-state-report",
        run_id: runId,
        source_inventory_ref: `.nimi/local/sweep-design/${runId}/inventory.yaml`,
        source_revision_ledger_ref: `.nimi/local/sweep-design/${runId}/revision-ledger.yaml`,
        complete: true,
        final_outcome_complete: true,
        llm_closeout_eligible: true,
        total_finding_count: 2,
        final_finding_count: 2,
        transient_finding_count: 0,
        findings: [],
      }),
      "utf8",
    );
    await writeFile(
      path.join(runRoot, "wave-plan.yaml"),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-wave-plan",
        run_id: runId,
        topic_id: "future-topic",
        source_revision_ledger_ref: `.nimi/local/sweep-design/${runId}/revision-ledger.yaml`,
        mutates_topic_state: false,
        worker_dispatch_allowed: false,
        wave_count: 2,
        waves: [
          {
            wave_id: "wave-runtime-contract-hardcut",
            scope: "Runtime contract hard cut",
            owner_domain: "runtime",
            authority_owner: ".nimi/spec/runtime/kernel/runtime-contract.md",
            dependencies: [],
            finding_ids: ["finding-0001"],
            preflight_ref: `.nimi/local/sweep-design/${runId}/preflight/wave-runtime-contract-hardcut.yaml`,
            non_goals: ["desktop compatibility shim"],
            validation_commands: ["go test ./runtime/..."],
            negative_checks: ["no app-level runtime bypass"],
            drift_resistance_checks: ["no legacy alias"],
            closeout_criteria: ["runtime contract tests pass"],
            source_design_packet_refs: [`.nimi/local/sweep-design/${runId}/design-auditor-packets/packet-0001.yaml`],
            design_auditor_result_refs: [`.nimi/local/sweep-design/${runId}/design-auditor-results/result-0001.yaml`],
            revision_ledger_entry_refs: [`.nimi/local/sweep-design/${runId}/revision-ledger.yaml#entry-0001`],
            blocked_gate_refs: [],
            merged_cluster_ids: ["cluster-runtime-contract"],
            merged_root_cause_keys: [
              ".nimi/spec/runtime/kernel/runtime-contract.md",
              ".nimi/spec/runtime/kernel/auth-service.md",
              "runtime-contract",
            ],
            isolation_justification: "single root cause wave",
          },
          {
            wave_id: "wave-desktop-runtime-adapter",
            scope: "Desktop runtime adapter alignment",
            owner_domain: "apps/desktop",
            authority_owner: ".nimi/spec/apps/desktop",
            dependencies: ["wave-runtime-contract-hardcut"],
            finding_ids: ["finding-0002"],
            preflight_ref: `.nimi/local/sweep-design/${runId}/preflight/wave-desktop-runtime-adapter.yaml`,
            non_goals: ["runtime downgrade"],
            validation_commands: ["pnpm --filter @nimiplatform/desktop test"],
            negative_checks: ["desktop does not bypass runtime auth"],
            drift_resistance_checks: ["desktop imports no runtime/internal private modules"],
            closeout_criteria: ["desktop tests pass"],
            source_design_packet_refs: [`.nimi/local/sweep-design/${runId}/design-auditor-packets/packet-0002.yaml`],
            design_auditor_result_refs: [`.nimi/local/sweep-design/${runId}/design-auditor-results/result-0002.yaml`],
            revision_ledger_entry_refs: [`.nimi/local/sweep-design/${runId}/revision-ledger.yaml#entry-0002`],
            blocked_gate_refs: [],
            merged_cluster_ids: ["cluster-desktop-runtime"],
            merged_root_cause_keys: ["desktop-runtime-adapter"],
            isolation_justification: "single root cause wave",
          },
        ],
      }),
      "utf8",
    );

    const result = await captureRunCli([
      "sweep",
      "design",
      "fix-topic",
      "--run-id",
      runId,
      "--slug",
      "sweep-fix-topic-test",
      "--title",
      "Sweep Fix Topic Test",
      "--admit-first-wave",
      "--verified-at",
      "2026-05-07T03:00:00.000Z",
      "--json",
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.waveCount, 2);
    assert.equal(payload.admittedWaveId, "wave-runtime-contract-hardcut");
    assert.match(payload.topicRef, /^\.nimi\/topics\/ongoing\//);
    assert.deepEqual(payload.materializedWaveIds, ["wave-runtime-contract-hardcut", "wave-desktop-runtime-adapter"]);

    const topicYaml = YAML.parse(await readFile(path.join(projectRoot, payload.topicRef, "topic.yaml"), "utf8"));
    assert.equal(topicYaml.waves.length, 2);
    assert.equal(topicYaml.waves[0].state, "preflight_admitted");
    assert.equal(topicYaml.waves[0].source_sweep_design.run_id, runId);
    assert.deepEqual(topicYaml.waves[0].source_sweep_design.authority_owner, [
      ".nimi/spec/runtime/kernel/runtime-contract.md",
      ".nimi/spec/runtime/kernel/auth-service.md",
    ]);
    assert.deepEqual(topicYaml.waves[0].source_sweep_design.source_authority_refs, [
      ".nimi/spec/runtime/kernel/runtime-contract.md",
      ".nimi/spec/runtime/kernel/auth-service.md",
    ]);
    assert.deepEqual(topicYaml.waves[1].deps, ["wave-runtime-contract-hardcut"]);

    const catalog = YAML.parse(await readFile(path.join(projectRoot, payload.topicRef, "sweep-fix", "wave-catalog.yaml"), "utf8"));
    assert.equal(catalog.kind, "sweep-fix-wave-catalog");
    assert.equal(catalog.wave_count, 2);
    assert.equal(catalog.source_findings_mutation_policy, "read_only_never_update_from_sweep_fix_topic");

    const preflight = await readFile(path.join(projectRoot, payload.topicRef, "preflight.md"), "utf8");
    assert.match(preflight, /topic goal .*preflight_admitted or a later execution-stage state/);

    const graph = await captureRunCli(["topic", "validate", "graph", payload.topicId, "--json"]);
    assert.equal(graph.exitCode, 0, graph.stderr);

    const goal = await captureRunCli(["topic", "goal", payload.topicId, "--json"]);
    assert.equal(goal.exitCode, 0, goal.stderr);
    const goalPayload = JSON.parse(goal.stdout);
    assert.equal(goalPayload.execution_start_wave_id, "wave-runtime-contract-hardcut");
    assert.match(goalPayload.goal_command, /Execute topic 2026-05-07-sweep-fix-topic-test to completion/);
    assert.match(goalPayload.goal_command, /do not mark complete after a single wave closeout/);
  });
});

test("sweep design synthetic trial results cannot masquerade as true LLM closeout", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-design-synthetic-test",
      actionability: "auto-fix",
      severity: "high",
      findingTitle: "Synthetic fixture finding",
    });
    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "intake",
      "--sweep-id",
      "audit-sweep-design-synthetic-test",
      "--run-id",
      "design-synthetic-test",
      "--json",
    ])).exitCode, 0);
    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "packet-build",
      "--run-id",
      "design-synthetic-test",
      "--packet-id",
      "synthetic-packet",
      "--finding-id",
      "finding-0001",
      "--json",
    ])).exitCode, 0);

    const resultInputRef = ".nimi/local/sweep-design/design-synthetic-test/design-auditor-results/synthetic-result-input.yaml";
    await mkdir(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-synthetic-test", "design-auditor-results"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ...resultInputRef.split("/")),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-design-auditor-result",
        run_id: "design-synthetic-test",
        packet_id: "synthetic-packet",
        result_id: "synthetic-result",
        auditor: "fixture-script",
        auditor_family: "other",
        auditor_mode: "all",
        auditor_result_origin: "synthetic_trial",
        methodology_ref: ".nimi/contracts/sweep-design-result.yaml",
        packet_ref: ".nimi/local/sweep-design/design-synthetic-test/design-auditor-packets/synthetic-packet.yaml",
        session_ref: "synthetic-load-test",
        transcript_ref: "synthetic-load-test",
        result_schema_version: 2,
        provenance: { fixture: true, synthetic_load_trial: true },
        evidence_read: [".nimi/local/audit/evidence/audit-sweep-design-synthetic-test/findings.yaml#finding-0001"],
        finding_outcomes: [
          {
            finding_id: "finding-0001",
            final_outcome: "ready_for_implementation_wave",
            design_auditor_packet_ref: ".nimi/local/sweep-design/design-synthetic-test/design-auditor-packets/synthetic-packet.yaml",
            design_auditor_result_ref: ".nimi/local/sweep-design/design-synthetic-test/design-auditor-results/synthetic-result.yaml",
            revision_ledger_entry_refs: [".nimi/local/sweep-design/design-synthetic-test/revision-ledger.yaml#synthetic-result-revision"],
            related_finding_ids_considered: [],
            code_refs_considered: ["src/fixture.ts"],
            authority_refs_considered: [],
            wave_id_ref: "wave-synthetic-ready",
            preflight_ref: ".nimi/local/sweep-design/design-synthetic-test/preflight/wave-synthetic-ready.yaml",
            validation_command_refs: ["node --test nimi-coding/test/nimicoding-audit-sweep.test.mjs"],
            closeout_criteria_ref: ".nimi/local/sweep-design/design-synthetic-test/closeout/wave-synthetic-ready.yaml",
          },
        ],
        cluster_changes: [],
        wave_changes: [
          {
            wave_id: "wave-synthetic-ready",
            state: "ready_for_implementation",
            scope: "synthetic load-test wave",
            owner_domain: "runtime",
            authority_owner: "runtime",
            dependencies: [],
            preflight_ref: ".nimi/local/sweep-design/design-synthetic-test/preflight/wave-synthetic-ready.yaml",
            non_goals: ["true LLM closeout"],
            validation_commands: ["node --test nimi-coding/test/nimicoding-audit-sweep.test.mjs"],
            negative_checks: ["synthetic result cannot satisfy closeout"],
            drift_resistance_checks: ["requires explicit synthetic flag"],
            closeout_criteria: ["synthetic trial only"],
            source_design_packet_refs: [".nimi/local/sweep-design/design-synthetic-test/design-auditor-packets/synthetic-packet.yaml"],
            design_auditor_result_refs: [".nimi/local/sweep-design/design-synthetic-test/design-auditor-results/synthetic-result.yaml"],
            revision_ledger_entry_refs: [".nimi/local/sweep-design/design-synthetic-test/revision-ledger.yaml#synthetic-result-revision"],
            blocked_gate_refs: [],
            merged_cluster_ids: ["cluster-synthetic"],
            merged_root_cause_keys: ["synthetic"],
            finding_ids: ["finding-0001"],
            isolation_justification: "single synthetic fixture finding",
          },
        ],
        revision_entries: [
          {
            revision_entry_id: "synthetic-result-revision",
            revision_type: "final_state_projection_update",
            previous_artifact_refs: [],
            replacement_artifact_refs: [],
            affected_finding_ids: ["finding-0001"],
            affected_cluster_ids: ["cluster-synthetic"],
            affected_wave_ids: ["wave-synthetic-ready"],
            reason_code: "synthetic_fixture_ready",
            evidence_refs: [".nimi/local/audit/evidence/audit-sweep-design-synthetic-test/findings.yaml#finding-0001"],
            human_gate_status: "not_required",
            projection_refs_changed: [".nimi/local/sweep-design/design-synthetic-test/final-state-report.yaml"],
          },
        ],
        human_decision_requests: [],
        extra_audit_requests: [],
        validation_recommendations: [],
        closeout_recommendations: [],
        rejection_status: "accepted",
      }),
      "utf8",
    );

    const refused = await captureRunCli([
      "sweep",
      "design",
      "result-ingest",
      "--run-id",
      "design-synthetic-test",
      "--from",
      resultInputRef,
      "--mode",
      "all",
      "--json",
    ]);
    assert.equal(refused.exitCode, 2);
    assert.match(refused.stderr, /synthetic_trial results require --allow-synthetic-trial/);

    const ingested = await captureRunCli([
      "sweep",
      "design",
      "result-ingest",
      "--run-id",
      "design-synthetic-test",
      "--from",
      resultInputRef,
      "--mode",
      "all",
      "--allow-synthetic-trial",
      "--json",
    ]);
    assert.equal(ingested.exitCode, 0, ingested.stderr);
    assert.equal(JSON.parse(ingested.stdout).closeoutEligible, false);

    const finalize = await captureRunCli(["sweep", "design", "finalize", "--run-id", "design-synthetic-test", "--json"]);
    assert.equal(finalize.exitCode, 2, finalize.stderr);
    const finalizePayload = JSON.parse(finalize.stdout);
    assert.equal(finalizePayload.finalOutcomeComplete, true);
    assert.equal(finalizePayload.llmCloseoutEligible, false);
    assert.equal(finalizePayload.stopClass, "non_llm_result_provenance");

    const wavePlanRefused = await captureRunCli([
      "sweep",
      "design",
      "wave-plan",
      "--run-id",
      "design-synthetic-test",
      "--topic-id",
      "2026-05-06-design-test",
      "--json",
    ]);
    assert.equal(wavePlanRefused.exitCode, 2);
    assert.match(wavePlanRefused.stderr, /not closeout-eligible LLM provenance/);
  });
});
