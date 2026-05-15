import { createHash } from "node:crypto";

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

function sha256Text(text) {
  return createHash("sha256").update(text).digest("hex");
}

test("sweep audit and sweep design are canonical CLI entries and top-level audit-sweep is removed", async () => {
  await withTempProject(async () => {
    const oldCommand = await captureRunCli(["audit-sweep", "status", "--sweep-id", "missing", "--json"]);
    assert.equal(oldCommand.exitCode, 2);
    assert.match(oldCommand.stderr, /Unknown command: audit-sweep/);
    assert.doesNotMatch(oldCommand.stderr, /nimicoding audit-sweep refused/);

    const helpResult = await captureRunCli(["--help"]);
    assert.equal(helpResult.exitCode, 0);
    assert.match(helpResult.stdout, /nimicoding sweep audit plan/);
    assert.doesNotMatch(helpResult.stdout, /nimicoding audit-sweep/);

    const designCommand = await captureRunCli(["sweep", "design"]);
    assert.equal(designCommand.exitCode, 2);
    assert.match(designCommand.stderr, /nimicoding sweep design refused: expected intake, packet-build/);
  });
});

test("sweep design ingests LLM auditor results into append-only design artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-design-test",
      actionability: "auto-fix",
      severity: "high",
      findingTitle: "Design fixture finding",
    });
    const sourceFindingsPath = path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-design-test", "findings.yaml");
    const originalFindingsSha = sha256Text(await readFile(sourceFindingsPath, "utf8"));

    const intake = await captureRunCli([
      "sweep",
      "design",
      "intake",
      "--sweep-id",
      "audit-sweep-design-test",
      "--run-id",
      "design-test",
      "--json",
    ]);
    assert.equal(intake.exitCode, 0, intake.stderr);
    assert.equal(JSON.parse(intake.stdout).findingCount, 1);
    const inventory = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-test", "inventory.yaml"), "utf8"));
    assert.equal(inventory.artifact_role, "forked_design_workset");
    assert.equal(inventory.source_findings_mutation_policy, "read_only_never_update_from_sweep_design");
    assert.equal(inventory.design_judgement_policy, "llm_auditor_result_required_for_final_outcomes");
    assert.equal(inventory.source_findings_sha256, originalFindingsSha);

    const retiredPhase = await captureRunCli([
      "sweep",
      "design",
      "confirm",
      "--run-id",
      "design-test",
      "--json",
    ]);
    assert.equal(retiredPhase.exitCode, 2);
    assert.match(retiredPhase.stderr, /expected intake, packet-build/);

    const markerWithoutRefs = await captureRunCli([
      "sweep",
      "design",
      "packet-build",
      "--run-id",
      "design-test",
      "--packet-id",
      "packet-missing-prior",
      "--finding-id",
      "finding-0001",
      "--prior-design-state-marker",
      "present",
      "--json",
    ]);
    assert.equal(markerWithoutRefs.exitCode, 2);
    assert.match(markerWithoutRefs.stderr, /non-empty prior_design_state_marker requires prior_design_state_refs/);

    const packetBuild = await captureRunCli([
      "sweep",
      "design",
      "packet-build",
      "--run-id",
      "design-test",
      "--packet-id",
      "packet-finding-0001",
      "--finding-id",
      "finding-0001",
      "--explicit-question",
      "Decide final implementation wave for fixture finding",
      "--prior-design-state-refs",
      ".nimi/local/sweep-design/previous-run/decision-packets/prior.yaml",
      "--current-cluster-refs",
      ".nimi/local/sweep-design/previous-run/clusters.yaml#cluster-fixture",
      "--current-wave-refs",
      ".nimi/local/sweep-design/previous-run/wave-plan.yaml#wave-fixture",
      "--json",
    ]);
    assert.equal(packetBuild.exitCode, 0, packetBuild.stderr);
    const packet = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-test", "design-auditor-packets", "packet-finding-0001.yaml"), "utf8"));
    assert.equal(packet.kind, "sweep-design-design-auditor-packet");
    assert.deepEqual(packet.included_finding_ids, ["finding-0001"]);
    assert.equal(packet.prior_design_state_marker, "present");
    assert.deepEqual(packet.prior_design_state_refs, [".nimi/local/sweep-design/previous-run/decision-packets/prior.yaml"]);
    assert.deepEqual(packet.current_cluster_refs, [".nimi/local/sweep-design/previous-run/clusters.yaml#cluster-fixture"]);
    assert.deepEqual(packet.current_wave_refs, [".nimi/local/sweep-design/previous-run/wave-plan.yaml#wave-fixture"]);

    const auditorPrompt = await captureRunCli([
      "sweep",
      "design",
      "auditor-prompt",
      "--run-id",
      "design-test",
      "--packet-id",
      "packet-finding-0001",
      "--json",
    ]);
    assert.equal(auditorPrompt.exitCode, 0, auditorPrompt.stderr);
    const promptPayload = JSON.parse(auditorPrompt.stdout);
    assert.equal(promptPayload.promptRef, ".nimi/local/sweep-design/design-test/auditor-prompts/packet-finding-0001.yaml");
    const prompt = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-test", "auditor-prompts", "packet-finding-0001.yaml"), "utf8"));
    assert.equal(prompt.required_result_origin, "external_llm_session");
    assert.equal(prompt.synthetic_result_policy, "synthetic_trial_results_are_load_tests_only_and_do_not_satisfy_true_llm_closeout");

    const resultInputRef = ".nimi/local/sweep-design/design-test/design-auditor-results/result-ready-input.yaml";
    await mkdir(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-test", "design-auditor-results"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ...resultInputRef.split("/")),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-design-auditor-result",
        run_id: "design-test",
        packet_id: "packet-finding-0001",
        result_id: "result-ready",
        auditor: "fixture-auditor",
        auditor_family: "openai_codex",
        auditor_mode: "all",
        auditor_result_origin: "external_llm_session",
        methodology_ref: ".nimi/contracts/sweep-design-result.yaml",
        packet_ref: ".nimi/local/sweep-design/design-test/design-auditor-packets/packet-finding-0001.yaml",
        session_ref: "codex-session-design-test",
        transcript_ref: "codex-transcript-design-test",
        llm_session_ref: "codex-session-design-test",
        llm_transcript_ref: "codex-transcript-design-test",
        llm_prompt_ref: ".nimi/local/sweep-design/design-test/auditor-prompts/packet-finding-0001.yaml",
        result_schema_version: 2,
        provenance: { fixture: true },
        evidence_read: packet.source_finding_refs,
        finding_outcomes: [
          {
            finding_id: "finding-0001",
            final_outcome: "ready_for_implementation_wave",
            design_auditor_packet_ref: ".nimi/local/sweep-design/design-test/design-auditor-packets/packet-finding-0001.yaml",
            design_auditor_result_ref: ".nimi/local/sweep-design/design-test/design-auditor-results/result-ready.yaml",
            revision_ledger_entry_refs: [".nimi/local/sweep-design/design-test/revision-ledger.yaml#result-ready-revision"],
            related_finding_ids_considered: [],
            code_refs_considered: ["src/fixture.ts"],
            authority_refs_considered: [],
            wave_id_ref: "wave-fixture-ready",
            preflight_ref: ".nimi/local/sweep-design/design-test/preflight/wave-fixture-ready.yaml",
            validation_command_refs: ["node --test nimi-coding/test/nimicoding-audit-sweep.test.mjs"],
            closeout_criteria_ref: ".nimi/local/sweep-design/design-test/closeout/wave-fixture-ready.yaml",
          },
        ],
        cluster_changes: [],
        wave_changes: [
          {
            wave_id: "wave-fixture-ready",
            state: "ready_for_implementation",
            scope: "fixture finding implementation",
            owner_domain: "runtime",
            authority_owner: "runtime",
            dependencies: [],
            preflight_ref: ".nimi/local/sweep-design/design-test/preflight/wave-fixture-ready.yaml",
            non_goals: ["source findings mutation"],
            validation_commands: ["node --test nimi-coding/test/nimicoding-audit-sweep.test.mjs"],
            negative_checks: ["source findings sha unchanged"],
            drift_resistance_checks: ["contract refs remain active"],
            closeout_criteria: ["tests pass"],
            source_design_packet_refs: [".nimi/local/sweep-design/design-test/design-auditor-packets/packet-finding-0001.yaml"],
            design_auditor_result_refs: [".nimi/local/sweep-design/design-test/design-auditor-results/result-ready.yaml"],
            revision_ledger_entry_refs: [".nimi/local/sweep-design/design-test/revision-ledger.yaml#result-ready-revision"],
            blocked_gate_refs: [],
            merged_cluster_ids: ["cluster-fixture"],
            merged_root_cause_keys: ["fixture-root-cause"],
            finding_ids: ["finding-0001"],
            isolation_justification: "single fixture finding is isolated for test coverage",
          },
        ],
        revision_entries: [
          {
            revision_entry_id: "result-ready-revision",
            revision_type: "final_state_projection_update",
            previous_artifact_refs: [],
            replacement_artifact_refs: [],
            affected_finding_ids: ["finding-0001"],
            affected_cluster_ids: ["cluster-fixture"],
            affected_wave_ids: ["wave-fixture-ready"],
            reason_code: "fixture_ready_for_implementation_wave",
            evidence_refs: packet.source_finding_refs,
            human_gate_status: "not_required",
            projection_refs_changed: [".nimi/local/sweep-design/design-test/final-state-report.yaml"],
          },
        ],
        human_decision_requests: [],
        extra_audit_requests: [],
        validation_recommendations: ["node --test nimi-coding/test/nimicoding-audit-sweep.test.mjs"],
        closeout_recommendations: ["close after tests pass"],
        rejection_status: "accepted",
      }),
      "utf8",
    );
    const ingest = await captureRunCli([
      "sweep",
      "design",
      "result-ingest",
      "--run-id",
      "design-test",
      "--from",
      resultInputRef,
      "--mode",
      "all",
      "--json",
    ]);
    assert.equal(ingest.exitCode, 0, ingest.stderr);
    const ledger = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-test", "revision-ledger.yaml"), "utf8"));
    assert.equal(ledger.kind, "sweep-design-revision-ledger");
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].entry_index, 1);
    assert.match(ledger.entries[0].entry_hash, /^[a-f0-9]{64}$/);

    assert.equal((await captureRunCli(["sweep", "design", "ledger-validate", "--run-id", "design-test", "--json"])).exitCode, 0);
    const finalize = await captureRunCli(["sweep", "design", "finalize", "--run-id", "design-test", "--json"]);
    assert.equal(finalize.exitCode, 0, finalize.stderr);
    assert.equal(JSON.parse(finalize.stdout).finalComplete, true);
    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "wave-plan",
      "--run-id",
      "design-test",
      "--topic-id",
      "2026-05-06-design-test",
      "--json",
    ])).exitCode, 0);

    const wavePlan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-test", "wave-plan.yaml"), "utf8"));
    assert.equal(wavePlan.kind, "sweep-design-wave-plan");
    assert.equal(wavePlan.mutates_topic_state, false);
    assert.equal(wavePlan.worker_dispatch_allowed, false);
    assert.equal(wavePlan.waves[0].wave_id, "wave-fixture-ready");
    assert.deepEqual(wavePlan.waves[0].validation_commands, ["node --test nimi-coding/test/nimicoding-audit-sweep.test.mjs"]);
    assert.equal(sha256Text(await readFile(sourceFindingsPath, "utf8")), originalFindingsSha);
  });
});

test("sweep design focused mode stops on user decision auditor results while all mode queues them", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-design-decision-test",
      actionability: "needs-decision",
      severity: "critical",
      findingTitle: "Decision fixture finding",
    });

    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "intake",
      "--sweep-id",
      "audit-sweep-design-decision-test",
      "--run-id",
      "design-decision-test",
      "--json",
    ])).exitCode, 0);
    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "packet-build",
      "--run-id",
      "design-decision-test",
      "--packet-id",
      "decision-packet",
      "--finding-id",
      "finding-0001",
      "--json",
    ])).exitCode, 0);

    const resultInputRef = ".nimi/local/sweep-design/design-decision-test/design-auditor-results/decision-result-input.yaml";
    await mkdir(path.join(projectRoot, ".nimi", "local", "sweep-design", "design-decision-test", "design-auditor-results"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ...resultInputRef.split("/")),
      YAML.stringify({
        version: 2,
        kind: "sweep-design-design-auditor-result",
        run_id: "design-decision-test",
        packet_id: "decision-packet",
        result_id: "decision-result",
        auditor: "fixture-auditor",
        auditor_family: "openai_codex",
        auditor_mode: "focused",
        auditor_result_origin: "external_llm_session",
        methodology_ref: ".nimi/contracts/sweep-design-result.yaml",
        packet_ref: ".nimi/local/sweep-design/design-decision-test/design-auditor-packets/decision-packet.yaml",
        session_ref: "codex-session-design-decision-test",
        transcript_ref: "codex-transcript-design-decision-test",
        llm_session_ref: "codex-session-design-decision-test",
        llm_transcript_ref: "codex-transcript-design-decision-test",
        llm_prompt_ref: ".nimi/local/sweep-design/design-decision-test/auditor-prompts/decision-packet.yaml",
        result_schema_version: 2,
        provenance: { fixture: true },
        evidence_read: [".nimi/local/audit/evidence/audit-sweep-design-decision-test/findings.yaml#finding-0001"],
        finding_outcomes: [
          {
            finding_id: "finding-0001",
            final_outcome: "needs_user_decision",
            design_auditor_packet_ref: ".nimi/local/sweep-design/design-decision-test/design-auditor-packets/decision-packet.yaml",
            design_auditor_result_ref: ".nimi/local/sweep-design/design-decision-test/design-auditor-results/decision-result.yaml",
            revision_ledger_entry_refs: [".nimi/local/sweep-design/design-decision-test/revision-ledger.yaml#decision-result-revision"],
            related_finding_ids_considered: [],
            code_refs_considered: ["src/fixture.ts"],
            authority_refs_considered: [],
            decision_queue_item_ref: ".nimi/local/sweep-design/design-decision-test/decision-queue.yaml#decision-finding-0001",
            decision_packet_ref: ".nimi/local/sweep-design/design-decision-test/decision-packets/decision-finding-0001.yaml",
            recommended_decision: "confirm product behavior before implementation",
            queue_status: "pending_user_confirmation",
            blocked_downstream_wave_refs: ["wave-decision-blocked"],
          },
        ],
        cluster_changes: [],
        wave_changes: [],
        revision_entries: [
          {
            revision_entry_id: "decision-result-revision",
            revision_type: "user_decision_queue_rewrite",
            previous_artifact_refs: [],
            replacement_artifact_refs: [],
            affected_finding_ids: ["finding-0001"],
            affected_cluster_ids: [],
            affected_wave_ids: ["wave-decision-blocked"],
            reason_code: "fixture_requires_user_decision",
            evidence_refs: [".nimi/local/audit/evidence/audit-sweep-design-decision-test/findings.yaml#finding-0001"],
            human_gate_status: "pending",
            projection_refs_changed: [".nimi/local/sweep-design/design-decision-test/decision-queue.yaml"],
          },
        ],
        human_decision_requests: [{ decision_id: "decision-finding-0001", question: "Confirm fixture product behavior" }],
        extra_audit_requests: [],
        validation_recommendations: [],
        closeout_recommendations: [],
        rejection_status: "accepted",
      }),
      "utf8",
    );
    const focusedPlan = await captureRunCli([
      "sweep",
      "design",
      "result-ingest",
      "--run-id",
      "design-decision-test",
      "--from",
      resultInputRef,
      "--mode",
      "focused",
      "--json",
    ]);
    assert.equal(focusedPlan.exitCode, 2, focusedPlan.stderr);
    const focusedPayload = JSON.parse(focusedPlan.stdout);
    assert.equal(focusedPayload.stopClass, "require_human_confirmation");
    assert.equal(focusedPayload.stopReason, "focused_mode_requires_manager_or_human_resolution");

    const queuePath = path.join(projectRoot, ".nimi", "local", "sweep-design", "design-decision-test", "decision-queue.yaml");
    const queue = YAML.parse(await readFile(queuePath, "utf8"));
    assert.equal(queue.kind, "sweep-design-decision-queue");
    assert.equal(queue.queue_policy, "focused_mode_stops_immediately_all_mode_batches_until_audit_complete");
    assert.equal(queue.pending_decision_count, 2);

    const allPlan = await captureRunCli([
      "sweep",
      "design",
      "result-ingest",
      "--run-id",
      "design-decision-test",
      "--from",
      resultInputRef,
      "--mode",
      "all",
      "--json",
    ]);
    assert.equal(allPlan.exitCode, 0, allPlan.stderr);
    assert.equal(JSON.parse(allPlan.stdout).findingOutcomeCount, 1);
  });
});

test("sweep design finalize refuses missing LLM final outcomes", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-design-synthesis-test",
      actionability: "needs-decision",
      severity: "high",
      findingTitle: "Synthesis fixture finding",
    });

    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "intake",
      "--sweep-id",
      "audit-sweep-design-synthesis-test",
      "--run-id",
      "design-synthesis-test",
      "--json",
    ])).exitCode, 0);
    assert.equal((await captureRunCli([
      "sweep",
      "design",
      "packet-build",
      "--run-id",
      "design-synthesis-test",
      "--finding-id",
      "finding-0001",
      "--packet-id",
      "missing-outcome-packet",
      "--json",
    ])).exitCode, 0);
    const finalize = await captureRunCli(["sweep", "design", "finalize", "--run-id", "design-synthesis-test", "--json"]);
    assert.equal(finalize.exitCode, 2, finalize.stderr);
    const finalReport = JSON.parse(finalize.stdout);
    assert.equal(finalReport.finalComplete, false);
    assert.equal(finalReport.finalFindingCount, 0);
    assert.equal(finalReport.transientFindingCount, 1);
  });
});

test("audit-sweep plan creates deterministic local chunk artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await writeFile(
      path.join(projectRoot, ".nimi", "config", "audit-sweep.yaml"),
      YAML.stringify({
        version: 1,
        audit_sweep: {
          exclude_patterns: [
            "src/domain/gen/**",
            "src/domain/generated/**",
          ],
        },
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "src", "domain"), { recursive: true });
    await mkdir(path.join(projectRoot, "src", "domain", "gen"), { recursive: true });
    await mkdir(path.join(projectRoot, "src", "domain", "generated"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "domain", "alpha.ts"), "export const alpha = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "domain", "beta.ts"), "export const beta = 2;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "domain", "gen", "ignored.ts"), "export const ignored = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "domain", "generated", "ignored.ts"), "export const ignored = 2;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--criteria",
      "quality,security",
      "--max-files",
      "1",
      "--sweep-id",
      "audit-sweep-test-plan",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0);
    const payload = JSON.parse(planResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.sweepId, "audit-sweep-test-plan");
    assert.equal(payload.totalFiles, 2);
    assert.equal(payload.includedFiles, 2);
    assert.equal(payload.chunkCount, 2);
    assert.equal(payload.planRef, ".nimi/local/audit/plans/audit-sweep-test-plan.yaml");
    assert.deepEqual(payload.chunkIds, ["chunk-001", "chunk-002"]);
    assert.deepEqual(payload.criteria, ["quality", "security"]);
    assert.match(payload.inventoryHash, /^[a-f0-9]{64}$/);

    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-plan.yaml"), "utf8"));
    assert.equal(plan.kind, "audit-plan");
    assert.equal(plan.audit_sweep_config_ref, ".nimi/config/audit-sweep.yaml");
    assert.deepEqual(plan.inventory.map((entry) => entry.file_ref), [
      "src/domain/alpha.ts",
      "src/domain/beta.ts",
    ]);
    assert.equal(plan.inventory[0].included, true);
    assert.equal(plan.chunks[0].state, "planned");

    const chunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", "audit-sweep-test-plan", "chunk-001.yaml"), "utf8"));
    assert.equal(chunk.kind, "audit-chunk");
    assert.equal(chunk.file_count, 1);
    assert.equal(chunk.state, "planned");
    assert.ok(chunk.file_hashes["src/domain/alpha.ts"] || chunk.file_hashes["src/domain/beta.ts"]);
    const runLedger = await readFile(path.join(projectRoot, ".nimi", "local", "audit", "runs", "audit-sweep-test-plan.jsonl"), "utf8");
    assert.match(runLedger, /"event_type":"plan_created"/);
  });
});

test("audit-sweep plan supports explicit per-run ignore policy without claiming ignored chunks as audited", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "included.ts"), "export const included = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "ignored.ts"), "export const ignored = 1;\n", "utf8");

    const missingReason = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--ignore",
      "src/ignored.ts",
      "--sweep-id",
      "audit-sweep-test-ignore-missing-reason",
      "--json",
    ]);
    assert.equal(missingReason.exitCode, 2);
    assert.match(missingReason.stderr, /requires --ignore-reason/);

    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src",
      "--max-files",
      "1",
      "--ignore",
      "src/ignored.ts",
      "--ignore-reason",
      "out-of-scope generated fixture for this sweep",
      "--sweep-id",
      "audit-sweep-test-ignore-policy",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const payload = JSON.parse(planResult.stdout);
    assert.equal(payload.auditIgnorePolicy.ignored_chunk_count, 1);

    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-ignore-policy.yaml"), "utf8"));
    assert.equal(plan.audit_ignore_policy.reason, "out-of-scope generated fixture for this sweep");
    assert.equal(plan.audit_ignore_policy.ignored_chunk_count, 1);
    const ignoredChunkSummary = plan.chunks.find((chunk) => chunk.files.includes("src/ignored.ts"));
    assert.equal(ignoredChunkSummary.state, "skipped");
    assert.equal(plan.coverage.ignored_chunks, 1);

    const ignoredChunk = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "chunks", "audit-sweep-test-ignore-policy", ignoredChunkSummary.chunk_id + ".yaml"), "utf8"));
    assert.equal(ignoredChunk.state, "skipped");
    assert.equal(ignoredChunk.skip.ignored_by_policy, true);

    const dispatchIgnored = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-ignore-policy",
      "--chunk-id",
      ignoredChunkSummary.chunk_id,
      "--dispatched-at",
      "2026-04-10T00:00:00Z",
      "--json",
    ]);
    assert.equal(dispatchIgnored.exitCode, 2);
    assert.match(dispatchIgnored.stderr, /requires planned state/);

    const validateChunks = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      "audit-sweep-test-ignore-policy",
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(validateChunks.exitCode, 0, validateChunks.stderr);
  });
});

test("audit-sweep dispatch adds opt-in P0/P1 recall strategy without changing ordinary packets", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await mkdir(path.join(projectRoot, "src", "p0p1"), { recursive: true });
    await mkdir(path.join(projectRoot, "src", "ordinary"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "p0p1", "security.ts"), "export const allow = true;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "ordinary", "ordinary.ts"), "export const value = 1;\n", "utf8");

    const p0p1PlanResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src/p0p1",
      "--criteria",
      "quality,p0p1",
      "--max-files",
      "1",
      "--sweep-id",
      "audit-sweep-test-p0p1-profile",
      "--json",
    ]);
    assert.equal(p0p1PlanResult.exitCode, 0, p0p1PlanResult.stderr);
    const p0p1Plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-p0p1-profile.yaml"), "utf8"));
    const p0p1Chunk = p0p1Plan.chunks[0];

    const p0p1DispatchResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-p0p1-profile",
      "--chunk-id",
      p0p1Chunk.chunk_id,
      "--dispatched-at",
      "2026-05-04T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(p0p1DispatchResult.exitCode, 0, p0p1DispatchResult.stderr);
    const p0p1Packet = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "packets", "audit-sweep-test-p0p1-profile", `${p0p1Chunk.chunk_id}.auditor-packet.yaml`), "utf8"));
    assert.equal(p0p1Packet.audit_strategy.mode, "p0_p1_triage_then_deep");
    assert.equal(p0p1Packet.audit_strategy.profile.profile_id, "p0_p1_recall");
    assert.equal(p0p1Packet.audit_strategy.profile.severity_mapping.p0, "critical");
    assert.equal(p0p1Packet.audit_strategy.profile.severity_mapping.p1, "high");
    assert.ok(p0p1Packet.audit_strategy.profile.priority_defect_classes.some((defectClass) => defectClass.id === "fail_open_or_pseudo_success"));
    assert.ok(p0p1Packet.audit_strategy.profile.priority_defect_classes.some((defectClass) => defectClass.id === "partial_coverage_misrepresented_as_complete"));
    assert.deepEqual(
      p0p1Packet.audit_strategy.profile.priority_defect_classes.map((defectClass) => defectClass.id).sort(),
      [...p0p1Packet.output_contract.p0p1_rule_check_required_ids].sort(),
    );
    assert.equal(p0p1Packet.output_contract.p0p1_rule_check_id_policy.aliases_rejected_fail_closed, true);
    assert.equal(p0p1Packet.audit_strategy.profile.token_budget_policy.triage_first, true);
    assert.equal(p0p1Packet.audit_strategy.profile.token_budget_policy.deep_audit_only_on_trigger, true);
    assert.equal(p0p1Packet.audit_strategy.profile.token_budget_policy.cluster_duplicate_symptoms, true);
    assert.equal(p0p1Packet.audit_strategy.profile.no_p0p1_finding_requirement.required, true);
    assert.equal(p0p1Packet.audit_strategy.profile.no_p0p1_finding_requirement.evidence_refs_must_include_implementation, true);

    await writeFile(
      path.join(projectRoot, "p0p1-out-of-scope-evidence.json"),
      `${JSON.stringify({
        chunk_id: p0p1Chunk.chunk_id,
        auditor: { id: "p0p1-regression-auditor" },
        coverage: {
          files: p0p1Chunk.files,
          p0p1_negative_reasoning: "Reviewed P0/P1 defect classes against the implementation file.",
          p0p1_evidence_refs: [p0p1Chunk.files[0], "src/outside.ts"],
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const outOfScopeIngestResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-p0p1-profile",
      "--chunk-id",
      p0p1Chunk.chunk_id,
      "--from",
      "p0p1-out-of-scope-evidence.json",
      "--verified-at",
      "2026-05-04T00:00:30.000Z",
      "--json",
    ]);
    assert.equal(outOfScopeIngestResult.exitCode, 2);
    assert.match(outOfScopeIngestResult.stderr, /coverage\.p0p1_evidence_refs\[1\] must belong to the chunk implementation surface/);

    const ordinaryPlanResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "src/ordinary",
      "--criteria",
      "quality",
      "--max-files",
      "1",
      "--sweep-id",
      "audit-sweep-test-ordinary-profile",
      "--json",
    ]);
    assert.equal(ordinaryPlanResult.exitCode, 0, ordinaryPlanResult.stderr);
    const ordinaryPlan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-ordinary-profile.yaml"), "utf8"));
    const ordinaryChunk = ordinaryPlan.chunks[0];

    const ordinaryDispatchResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-ordinary-profile",
      "--chunk-id",
      ordinaryChunk.chunk_id,
      "--dispatched-at",
      "2026-05-04T00:01:00.000Z",
      "--json",
    ]);
    assert.equal(ordinaryDispatchResult.exitCode, 0, ordinaryDispatchResult.stderr);
    const ordinaryPacket = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "packets", "audit-sweep-test-ordinary-profile", `${ordinaryChunk.chunk_id}.auditor-packet.yaml`), "utf8"));
    assert.equal(ordinaryPacket.audit_strategy.mode, "file_inventory_audit");
    assert.equal(ordinaryPacket.audit_strategy.profile, undefined);
  });
});

test("audit-sweep plan uses spec authority chunks for whole-project sweeps", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "runtime", "kernel"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "runtime-audit-surface.md"),
      "# Runtime Audit Surface\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "runtime-secondary-surface.md"),
      "# Runtime Secondary Surface\n",
      "utf8",
    );
    await mkdir(path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "generated"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "generated", "runtime-audit-surface.md"),
      "# Generated Runtime Audit Surface\n",
      "utf8",
    );
    await mkdir(path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "tables"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "kernel", "tables", "runtime-audit-surface.yaml"),
      "surfaces:\n  - runtime-audit-surface\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "runtime", "index.md"),
      "# Runtime Domain\n\n## Module Map\n\n- `internal/` 鈥?runtime service implementation\n",
      "utf8",
    );
    await mkdir(path.join(projectRoot, "runtime", "internal"), { recursive: true });
    await writeFile(path.join(projectRoot, "runtime", "README.md"), "# Runtime\n", "utf8");
    await writeFile(path.join(projectRoot, "runtime", "internal", "service.go"), "package internal\n", "utf8");
    await writeFile(path.join(projectRoot, "runtime", "internal", "service_test.go"), "package internal\n", "utf8");

    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      ".",
      "--criteria",
      "quality,boundary",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0);
    const payload = JSON.parse(planResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.chunkBasis, "spec_authority");

    const planText = await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-spec-basis.yaml"), "utf8");
    assert.doesNotMatch(planText, /^\s+\w+: &a\d+/m);
    const plan = YAML.parse(planText);
    assert.equal(plan.planning_basis.mode, "spec_authority");
    assert.equal(plan.planning_basis.authority_root, ".nimi/spec");
    assert.equal(plan.planning_basis.files_are_evidence_only, true);
    assert.ok(plan.inventory.every((entry) => entry.file_ref.startsWith(".nimi/spec/")));
    assert.equal(plan.inventory.find((entry) => entry.file_ref.includes("/kernel/generated/")).included, false);
    assert.equal(
      plan.inventory.find((entry) => entry.file_ref.includes("/kernel/generated/")).exclusion_reason,
      "non_product_surface:derived_view",
    );
    assert.equal(plan.surface_classification.contract, "nimicoding.surface-validator-result.v1");
    assert.ok(!plan.inventory.some((entry) => entry.file_ref === "runtime/internal/service.go"));
    assert.ok(plan.evidence_inventory.some((entry) => entry.file_ref === "runtime/internal/service.go"));
    assert.equal(plan.coverage.authority_files, plan.coverage.included_files);
    assert.ok(plan.coverage.evidence_files > 0);
    assert.ok(plan.coverage.unmapped_evidence_files >= 0);
    assert.equal(plan.unmapped_evidence_files.length, plan.coverage.unmapped_evidence_files);

    const runtimeChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "kernel-contracts");
    assert.ok(runtimeChunk);
    assert.ok(runtimeChunk.authority_refs.includes(".nimi/spec/runtime/kernel/runtime-audit-surface.md"));
    assert.ok(runtimeChunk.evidence_roots.includes("runtime"));
    assert.ok(runtimeChunk.evidence_roots.includes("config"));
    assert.equal(runtimeChunk.coverage_contract.evidence_files_must_cover_inventory, true);
    assert.ok(runtimeChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const runtimeSecondaryChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/runtime/kernel/runtime-secondary-surface.md"));
    assert.ok(runtimeSecondaryChunk);
    assert.ok(runtimeSecondaryChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeSecondaryChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const runtimeGeneratedChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "kernel-generated");
    assert.equal(runtimeGeneratedChunk, undefined);
    const runtimeTablesChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "kernel-tables");
    assert.ok(runtimeTablesChunk);
    assert.ok(runtimeTablesChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeTablesChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const runtimeDomainChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "domain-guides");
    assert.ok(runtimeDomainChunk);
    assert.ok(runtimeDomainChunk.evidence_inventory.includes("runtime/README.md"));
    assert.ok(runtimeDomainChunk.evidence_inventory.includes("runtime/internal/service.go"));
    assert.ok(runtimeDomainChunk.evidence_inventory.includes("runtime/internal/service_test.go"));
    const serviceEvidenceChunk = runtimeChunk;
    assert.ok(serviceEvidenceChunk);
    const specRootChunk = plan.chunks.find((chunk) => chunk.owner_domain === "spec-root");
    assert.equal(specRootChunk, undefined);

    const dispatchResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--dispatched-at",
      "2026-04-24T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);

    const incompleteEvidencePath = path.join(projectRoot, "runtime-audit-evidence-incomplete.json");
    await writeFile(
      incompleteEvidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          authority_refs: serviceEvidenceChunk.authority_refs,
          files: serviceEvidenceChunk.authority_refs,
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const incompleteIngestResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence-incomplete.json",
      "--verified-at",
      "2026-04-24T00:00:30.000Z",
      "--json",
    ]);
    assert.equal(incompleteIngestResult.exitCode, 2);
    assert.match(incompleteIngestResult.stderr, /coverage\.evidence_files is required/);

    const missingAuthorityRefsEvidencePath = path.join(projectRoot, "runtime-audit-evidence-missing-authority-refs.json");
    await writeFile(
      missingAuthorityRefsEvidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          files: serviceEvidenceChunk.authority_refs,
          evidence_files: serviceEvidenceChunk.evidence_inventory,
          authority_outcomes: serviceEvidenceChunk.authority_refs.map((authorityRef) => ({
            authority_ref: authorityRef,
            status: "not_applicable",
            evidence_refs: [],
            reason: "No implementation surface examined in this negative fixture.",
          })),
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const missingAuthorityRefsIngestResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence-missing-authority-refs.json",
      "--verified-at",
      "2026-04-24T00:00:45.000Z",
      "--json",
    ]);
    assert.equal(missingAuthorityRefsIngestResult.exitCode, 2);
    assert.match(missingAuthorityRefsIngestResult.stderr, /coverage\.authority_refs is required/);

    const partialEvidencePath = path.join(projectRoot, "runtime-audit-evidence-partial.json");
    await writeFile(
      partialEvidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          authority_refs: serviceEvidenceChunk.authority_refs,
          files: serviceEvidenceChunk.authority_refs,
          evidence_files: [],
          authority_outcomes: serviceEvidenceChunk.authority_refs.map((authorityRef) => ({
            authority_ref: authorityRef,
            status: "not_applicable",
            evidence_refs: [],
            reason: "Negative fixture intentionally omits implementation evidence inventory coverage.",
          })),
        },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const partialIngestResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence-partial.json",
      "--verified-at",
      "2026-04-24T00:00:50.000Z",
      "--json",
    ]);
    assert.equal(partialIngestResult.exitCode, 2);
    assert.match(partialIngestResult.stderr, /coverage\.evidence_files must exactly match chunk evidence inventory/);

    const evidencePath = path.join(projectRoot, "runtime-audit-evidence.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify({
        chunk_id: serviceEvidenceChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          authority_refs: serviceEvidenceChunk.authority_refs,
          files: serviceEvidenceChunk.authority_refs,
          evidence_files: serviceEvidenceChunk.evidence_inventory,
          authority_outcomes: serviceEvidenceChunk.authority_refs.map((authorityRef) => ({
            authority_ref: authorityRef,
            status: "audited",
            evidence_refs: ["runtime/internal/service.go"],
          })),
        },
        findings: [
          {
            severity: "medium",
            category: "boundary",
            actionability: "auto-fix",
            confidence: "high",
            impact: "Spec-owned runtime chunk can report implementation evidence without making file inventory the planning basis.",
            location: { file: "runtime/internal/service.go", line: 1 },
            title: "Runtime evidence allowed by spec chunk",
            description: "The finding location is under a declared evidence root for the runtime spec authority chunk.",
            evidence: {
              summary: "runtime/internal/service.go is evidence for the runtime authority chunk.",
              auditor_reasoning: "Spec authority selected the chunk; implementation files are evidence.",
            },
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "sweep",
      "audit",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      serviceEvidenceChunk.chunk_id,
      "--from",
      "runtime-audit-evidence.json",
      "--verified-at",
      "2026-04-24T00:01:00.000Z",
      "--json",
    ]);
    assert.equal(ingestResult.exitCode, 0, ingestResult.stderr);
    const ingestPayload = JSON.parse(ingestResult.stdout);
    assert.equal(ingestPayload.addedCount, 1);

    const tamperedEvidencePath = path.join(projectRoot, ...ingestPayload.evidenceRef.split("/"));
    const tamperedEvidence = JSON.parse(await readFile(tamperedEvidencePath, "utf8"));
    delete tamperedEvidence.coverage.authority_refs;
    await writeFile(tamperedEvidencePath, `${JSON.stringify(tamperedEvidence, null, 2)}\n`, "utf8");
    const tamperedValidateResult = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--scope",
      "chunks",
      "--json",
    ]);
    assert.equal(tamperedValidateResult.exitCode, 2);
    const tamperedValidatePayload = JSON.parse(tamperedValidateResult.stdout);
    assert.equal(tamperedValidatePayload.ok, false);
    assert.ok(tamperedValidatePayload.checks.some((check) => (
      check.id === `chunk_${serviceEvidenceChunk.chunk_id}_spec_authority_evidence_coverage`
      && check.ok === false
      && check.reason === "spec-authority evidence declares authority_refs"
    )));
  });
});

test("audit-sweep plan expands app-local specs only through app-slice admissions", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "app-slice-admissions.yaml"),
      YAML.stringify({
        version: 1,
        admissions: [
          {
            app_id: "demo",
            status: "active",
            owner_domain: "app-demo",
            authority_root: "apps/demo/spec",
            evidence_roots: ["apps/demo"],
            may_not_override: [".nimi/spec/runtime/**"],
            source_rule: "P-APP-001",
          },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "apps", "demo", "spec", "kernel"), { recursive: true });
    await mkdir(path.join(projectRoot, "apps", "demo", "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps", "demo", "spec", "kernel", "app-shell-contract.md"), "# Demo App Shell\n", "utf8");
    await writeFile(path.join(projectRoot, "apps", "demo", "src", "app.ts"), "export const demo = true;\n", "utf8");
    await writeFile(path.join(projectRoot, "apps", "demo", "package.json"), "{\"name\":\"demo\"}\n", "utf8");

    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      "apps/demo",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      "audit-sweep-test-app-slice-admission",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-app-slice-admission.yaml"), "utf8"));
    assert.equal(plan.app_slice_admission_ref, ".nimi/spec/platform/kernel/tables/app-slice-admissions.yaml");
    assert.deepEqual(plan.app_slice_admissions.map((entry) => entry.app_id), ["demo"]);
    const appChunk = plan.chunks.find((chunk) => chunk.app_id === "demo" && chunk.authority_refs.includes("apps/demo/spec/kernel/app-shell-contract.md"));
    assert.ok(appChunk);
    assert.equal(appChunk.authority_kind, "admitted_app_slice");
    assert.equal(appChunk.admission_ref, ".nimi/spec/platform/kernel/tables/app-slice-admissions.yaml#demo");
    assert.deepEqual(appChunk.evidence_roots, ["apps/demo"]);
    assert.ok(appChunk.evidence_inventory.includes("apps/demo/src/app.ts"));
    assert.ok(appChunk.evidence_inventory.includes("apps/demo/package.json"));
    assert.equal(plan.unmapped_evidence_files.length, 0);

    const validateResult = await captureRunCli([
      "sweep",
      "audit",
      "validate",
      "--sweep-id",
      "audit-sweep-test-app-slice-admission",
      "--scope",
      "plan",
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0, validateResult.stdout);
  });
});

test("audit-sweep plan maps authority-specific evidence roots from spec tables", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables"), { recursive: true });
    await writeFile(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "web-release-contract.md"), "# Web Release\n", "utf8");
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "audit-evidence-roots.yaml"),
      YAML.stringify({
        version: 1,
        roots: [
          {
            id: "platform-web-release",
            owner_domain: "platform",
            authority_refs: [".nimi/spec/platform/kernel/web-release-contract.md"],
            evidence_roots: ["apps/web"],
            source_rule: "P-WEB-005",
          },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "apps", "web", "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "apps", "web", "src", "app.ts"), "export const web = true;\n", "utf8");

    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      ".",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      "audit-sweep-test-evidence-root-admission",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-evidence-root-admission.yaml"), "utf8"));
    assert.deepEqual(plan.audit_evidence_root_refs, [".nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml"]);
    const webChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/platform/kernel/web-release-contract.md"));
    assert.ok(webChunk);
    assert.deepEqual(webChunk.evidence_root_admission_refs, [".nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml#platform-web-release"]);
    assert.ok(webChunk.evidence_roots.includes("apps/web"));
    assert.ok(webChunk.evidence_inventory.includes("apps/web/src/app.ts"));
  });
});

test("audit-sweep plan expands admitted package authority and host-local projection evidence", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "package-authority-admission-contract.md"),
      "# Package Authority Admission\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "package-authority-admissions.yaml"),
      YAML.stringify({
        version: 1,
        admissions: [
          {
            id: "tooling",
            status: "active",
            owner_domain: "tooling",
            authority_root: "tools/tooling/spec",
            evidence_roots: ["tools/tooling"],
            may_not_override: [".nimi/spec/platform/**"],
            projection_boundary: {
              host_project_admission_owner: ".nimi/spec/platform/kernel/package-authority-admission-contract.md",
              package_truth_root: "tools/tooling/spec",
              host_local_projection_roots: [".nimi/contracts", ".nimi/methodology"],
              host_authority_projection_refs: [
                {
                  host_ref: ".nimi/spec/product-scope.yaml",
                  package_ref: "tools/tooling/spec/product-scope.yaml",
                },
              ],
            },
            source_rule: "P-PKG-001",
          },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "platform", "kernel", "tables", "audit-evidence-roots.yaml"),
      YAML.stringify({
        version: 1,
        roots: [
          {
            id: "host-local-tooling-projection",
            owner_domain: "platform",
            authority_refs: [".nimi/spec/platform/kernel/package-authority-admission-contract.md"],
            evidence_roots: [".nimi/contracts", ".nimi/methodology"],
            source_rule: "P-PKG-006",
          },
          {
            id: "host-generated-audit-tooling-implementation",
            owner_domain: "spec-meta",
            authority_refs: [".nimi/spec/_meta/spec-generation-audit.yaml"],
            evidence_roots: ["tools/tooling/cli/index.mjs"],
            source_rule: "P-PKG-008",
          },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(projectRoot, "tools", "tooling", "spec"), { recursive: true });
    await mkdir(path.join(projectRoot, "tools", "tooling", "cli"), { recursive: true });
    await mkdir(path.join(projectRoot, "tools", "tooling", "contracts"), { recursive: true });
    await mkdir(path.join(projectRoot, ".nimi", "spec", "_meta"), { recursive: true });
    await writeFile(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml"), "version: 1\nspec_generation_audit:\n  files: []\n", "utf8");
    await writeFile(path.join(projectRoot, "tools", "tooling", "spec", "product-scope.yaml"), "version: 1\nproduct: tooling\n", "utf8");
    await writeFile(path.join(projectRoot, "tools", "tooling", "cli", "index.mjs"), "export const run = () => true;\n", "utf8");
    await writeFile(path.join(projectRoot, "tools", "tooling", "contracts", "tool.schema.yaml"), "version: 1\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "contracts", "host-local-tool.schema.yaml"), "version: 1\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "methodology", "host-local-tool.yaml"), "version: 1\n", "utf8");

    const planResult = await captureRunCli([
      "sweep",
      "audit",
      "plan",
      "--root",
      ".",
      "--chunk-basis",
      "spec",
      "--sweep-id",
      "audit-sweep-test-package-authority-admission",
      "--json",
    ]);

    assert.equal(planResult.exitCode, 0, planResult.stderr);
    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-package-authority-admission.yaml"), "utf8"));
    assert.deepEqual(plan.package_authority_admission_refs, [".nimi/spec/platform/kernel/tables/package-authority-admissions.yaml"]);
    assert.deepEqual(plan.package_authority_admissions.map((entry) => entry.id), ["tooling"]);

    const packageChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes("tools/tooling/spec/product-scope.yaml"));
    assert.ok(packageChunk);
    assert.equal(packageChunk.authority_kind, "admitted_package_authority");
    assert.equal(packageChunk.package_authority_id, "tooling");
    assert.equal(packageChunk.admission_ref, ".nimi/spec/platform/kernel/tables/package-authority-admissions.yaml#tooling");
    assert.deepEqual(packageChunk.authority_refs, ["tools/tooling/spec/product-scope.yaml", ".nimi/spec/product-scope.yaml"]);
    assert.deepEqual(packageChunk.files, ["tools/tooling/spec/product-scope.yaml", ".nimi/spec/product-scope.yaml"]);
    assert.deepEqual(packageChunk.host_authority_projection_refs, [
      {
        host_ref: ".nimi/spec/product-scope.yaml",
        package_ref: "tools/tooling/spec/product-scope.yaml",
        package_authority_id: "tooling",
        admission_ref: ".nimi/spec/platform/kernel/tables/package-authority-admissions.yaml#tooling",
      },
    ]);
    assert.deepEqual(packageChunk.evidence_roots, ["tools/tooling"]);
    assert.ok(packageChunk.evidence_inventory.includes("tools/tooling/contracts/tool.schema.yaml"));
    assert.ok(!packageChunk.evidence_inventory.includes("tools/tooling/spec/product-scope.yaml"));
    assert.equal(plan.chunks.filter((chunk) => chunk.authority_refs.includes(".nimi/spec/product-scope.yaml")).length, 1);

    const specAuditChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/_meta/spec-generation-audit.yaml"));
    assert.equal(specAuditChunk, undefined);
    const specAuditInventory = plan.inventory.find((entry) => entry.file_ref === ".nimi/spec/_meta/spec-generation-audit.yaml");
    assert.equal(specAuditInventory.included, false);
    assert.equal(specAuditInventory.exclusion_reason, "non_product_surface:spec_generation_state");
    assert.ok(packageChunk.evidence_inventory.includes("tools/tooling/cli/index.mjs"));

    const hostProjectionChunk = plan.chunks.find((chunk) => chunk.authority_refs.includes(".nimi/spec/platform/kernel/package-authority-admission-contract.md"));
    assert.ok(hostProjectionChunk);
    assert.ok(hostProjectionChunk.evidence_root_admission_refs.includes(".nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml#host-local-tooling-projection"));
    assert.ok(hostProjectionChunk.admitted_evidence_roots.includes(".nimi/contracts"));
    assert.ok(hostProjectionChunk.admitted_evidence_roots.includes(".nimi/methodology"));
    assert.ok(hostProjectionChunk.evidence_inventory.includes(".nimi/contracts/host-local-tool.schema.yaml"));
    assert.ok(hostProjectionChunk.evidence_inventory.includes(".nimi/methodology/host-local-tool.yaml"));
  });
});
