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

test("handoff prompt for high risk execution includes execution schema refs", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const handoffResult = await captureRunCli(["handoff", "--skill", "high_risk_execution", "--prompt"]);

    assert.equal(handoffResult.exitCode, 0);
    assert.match(handoffResult.stdout, /\.nimi\/local\/handoff\/high_risk_execution\.prompt\.md/);

    const promptText = await readFile(
      path.join(projectRoot, ".nimi", "local", "handoff", "high_risk_execution.prompt.md"),
      "utf8",
    );
    assert.match(promptText, /Execution schema refs:/);
    assert.match(promptText, /\.nimi\/contracts\/execution-packet\.schema\.yaml/);
    assert.match(promptText, /Expected closeout summary status:/);
    assert.match(promptText, /candidate_ready, blocked, failed/);
    assert.match(promptText, /Expected local artifact roots:/);
    assert.match(promptText, /packet_ref=\.nimi\/local\/packets/);
    assert.match(promptText, /Expected artifact kinds:/);
  });
});

test("handoff exposes selected host adapter when one is admitted", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const adapterPath = path.join(projectRoot, ".nimi", "config", "host-adapter.yaml");
    const adapterText = await readFile(adapterPath, "utf8");
    await writeFile(
      adapterPath,
      adapterText.replace("selected_adapter_id: none", "selected_adapter_id: oh_my_codex"),
      "utf8",
    );

    const handoffResult = await captureRunCli(["handoff", "--skill", "high_risk_execution", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.adapter.selectedId, "oh_my_codex");
    assert.equal(payload.adapter.handoffMode, "prompt_output_evidence_handoff");
    assert.equal(payload.adapter.semanticReviewOwner, "nimicoding_manager");
    assert.equal(payload.adapter.profileRef, "adapters/oh-my-codex/profile.yaml");
    assert.equal(payload.adapter.hostClass, "external_execution_host");
    assert.equal(payload.adapter.upstreamSeedProfile, "external_ai_host");
    assert.ok(payload.adapter.purpose.includes("external execution host"));
    assert.deepEqual(payload.adapter.operationalOwner, [".omx", ".nimi/local", ".nimi/cache"]);
    assert.equal(payload.adapter.futureSurfaceStatus, "future_only_not_packaged");
    assert.deepEqual(payload.adapter.futureSurface, ["nimicoding run-next-prompt"]);
    assert.equal(payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.mode, "named_admitted_overlay_selected");
    assert.equal(payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.selectedOverlayId, "oh_my_codex");
    assert.equal(payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.selectedOverlayProfileRef, "adapters/oh-my-codex/profile.yaml");
    assert.deepEqual(payload.adapter.currentGaps, [
      "automatic_semantic_admission_automation_not_packaged_in_standalone",
      "host_specific_runtime_execution_not_packaged_in_standalone",
    ]);
  });
});

test("handoff exposes Codex native review boundary as lower-layer evidence only", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const adapterPath = path.join(projectRoot, ".nimi", "config", "host-adapter.yaml");
    const adapterText = await readFile(adapterPath, "utf8");
    await writeFile(
      adapterPath,
      adapterText.replace("selected_adapter_id: none", "selected_adapter_id: codex"),
      "utf8",
    );

    const handoffResult = await captureRunCli(["handoff", "--skill", "high_risk_execution", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.adapter.selectedId, "codex");
    assert.equal(payload.adapter.profileRef, "adapters/codex/profile.yaml");
    assert.equal(payload.adapter.hostClass, "native_codex_sdk_host");
    assert.equal(payload.adapter.futureSurfaceStatus, "active_via_codex_sdk");
    assert.deepEqual(payload.adapter.futureSurface, [
      "Codex.startThread().run",
      "Codex.resumeThread().run",
    ]);
    assert.equal(payload.adapter.nativeReviewBoundary.approvalReview.scope, "lower_layer_permission_review");
    assert.equal(payload.adapter.nativeReviewBoundary.approvalReview.semanticEffect, "none");
    assert.equal(payload.adapter.nativeReviewBoundary.githubAutoReview.scope, "lower_layer_pr_review_findings");
    assert.equal(payload.adapter.nativeReviewBoundary.githubAutoReview.semanticEffect, "evidence_only");
    assert.ok(payload.adapter.nativeReviewBoundary.forbiddenSemanticSubstitutions.includes("wave_closeout"));
    assert.ok(payload.adapter.nativeReviewBoundary.forbiddenSemanticSubstitutions.includes("true_close"));
  });
});

test("handoff prompt includes selected adapter overlay metadata", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const adapterPath = path.join(projectRoot, ".nimi", "config", "host-adapter.yaml");
    const adapterText = await readFile(adapterPath, "utf8");
    await writeFile(
      adapterPath,
      adapterText.replace("selected_adapter_id: none", "selected_adapter_id: oh_my_codex"),
      "utf8",
    );

    const handoffResult = await captureRunCli(["handoff", "--skill", "high_risk_execution", "--prompt"]);

    assert.equal(handoffResult.exitCode, 0);
    const promptText = await readFile(
      path.join(projectRoot, ".nimi", "local", "handoff", "high_risk_execution.prompt.md"),
      "utf8",
    );
    assert.match(promptText, /Adapter profile ref: adapters\/oh-my-codex\/profile\.yaml/);
    assert.match(promptText, /Adapter host class: external_execution_host/);
    assert.match(promptText, /Adapter operational owner roots: \.omx, \.nimi\/local, \.nimi\/cache/);
    assert.match(promptText, /Named overlay mode: named_admitted_overlay_selected/);
    assert.match(promptText, /Adapter future-only surfaces: nimicoding run-next-prompt/);
    assert.match(promptText, /Adapter future-only surface status: future_only_not_packaged/);
    assert.match(promptText, /Adapter current gaps: automatic_semantic_admission_automation_not_packaged_in_standalone, host_specific_runtime_execution_not_packaged_in_standalone/);
  });
});

test("handoff requires an explicit declared skill id", async () => {
  const result = await captureRunCli(["handoff"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /explicit --skill is required/);
});

test("handoff rejects conflicting output modes", async () => {
  const result = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--json", "--prompt"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /mutually exclusive/);
});

test("closeout writes a local-only result artifact after completed reconstruction", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const closeoutResult = await captureRunCli([
      "closeout",
      "--skill",
      "spec_reconstruction",
      "--outcome",
      "completed",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--write-local",
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 0);
    const payload = JSON.parse(closeoutResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.contractVersion, "nimicoding.closeout.v1");
    assert.equal(payload.localOnly, true);
    assert.equal(payload.summary.audit_ref, ".nimi/spec/_meta/spec-generation-audit.yaml");
    assert.equal(payload.summary.status, "reconstructed");
    assert.equal(payload.skill.resultContractRef, ".nimi/contracts/spec-reconstruction-result.yaml");
    assert.equal(
      payload.contracts.exchangeProjectionContractRef,
      ".nimi/methodology/skill-exchange-projection.yaml",
    );

    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.skill.id, "spec_reconstruction");
    assert.equal(stored.outcome, "completed");
  });
});

test("closeout fails closed when completed reconstruction lacks the canonical tree", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const closeoutResult = await captureRunCli([
      "closeout",
      "--skill",
      "spec_reconstruction",
      "--outcome",
      "completed",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 1);
    const payload = JSON.parse(closeoutResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.readiness.reason, /current lifecycle state|declared canonical tree files/i);
  });
});

test("closeout fails completed reconstruction when spec generation audit is missing", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await rm(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml"), { force: true });

    const closeoutResult = await captureRunCli([
      "closeout",
      "--skill",
      "spec_reconstruction",
      "--outcome",
      "completed",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 1);
    const payload = JSON.parse(closeoutResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(payload.readiness.reason, /spec-generation-audit/i);
  });
});

test("closeout allows blocked outcomes without a reconstructed canonical tree", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const closeoutResult = await captureRunCli([
      "closeout",
      "--skill",
      "doc_spec_audit",
      "--outcome",
      "blocked",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 0);
    const payload = JSON.parse(closeoutResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.outcome, "blocked");
  });
});

test("closeout rejects failed spec reconstruction payloads that still carry a summary", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const importPath = path.join(projectRoot, "bad-failed-reconstruction-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "spec_reconstruction" },
        outcome: "failed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          generated_paths: [".nimi/spec/INDEX.md"],
          audit_ref: ".nimi/spec/_meta/spec-generation-audit.yaml",
          coverage_summary: {
            complete_files: 1,
            partial_files: 0,
            placeholder_files: 0,
          },
          unresolved_file_count: 0,
          inferred_file_count: 0,
          status: "blocked",
          summary: "This should not be accepted for a failed outcome.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 2);
    assert.match(closeoutResult.stderr, /does not accept summary when outcome is failed/i);
  });
});

test("closeout rejects blocked doc spec audit payloads with a completed-only summary status", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "bad-blocked-doc-audit-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "doc_spec_audit" },
        outcome: "blocked",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          compared_paths: ["README.md", ".nimi/spec"],
          finding_count: 0,
          status: "aligned",
          summary: "Blocked outcomes must not claim aligned.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 2);
    assert.match(closeoutResult.stderr, /doc_spec_audit summary.status must be blocked/i);
  });
});

test("closeout requires ISO-8601 UTC verified timestamps", async () => {
  const result = await captureRunCli([
    "closeout",
    "--skill",
    "spec_reconstruction",
    "--outcome",
    "completed",
    "--verified-at",
    "2026-04-10",
  ]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /ISO-8601 UTC timestamp/);
});

test("closeout imports an external JSON summary before writing local artifact", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "external-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "spec_reconstruction" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          generated_paths: [
            ".nimi/spec/INDEX.md",
            ".nimi/spec/project/kernel/index.md",
            ".nimi/spec/project/kernel/core-rules.md",
            ".nimi/spec/project/kernel/tables/rule-catalog.yaml",
            ".nimi/spec/_meta/spec-generation-audit.yaml",
          ],
          audit_ref: ".nimi/spec/_meta/spec-generation-audit.yaml",
          coverage_summary: {
            complete_files: 4,
            partial_files: 0,
            placeholder_files: 0,
          },
          unresolved_file_count: 0,
          inferred_file_count: 0,
          status: "reconstructed",
          summary: "Canonical tree generation completed with file-level audit coverage.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--write-local",
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 0);
    const payload = JSON.parse(closeoutResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.skill.id, "spec_reconstruction");
    assert.equal(payload.outcome, "completed");
    assert.equal(payload.summary.status, "reconstructed");
    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.verifiedAt, "2026-04-10T00:00:00.000Z");
    assert.equal(stored.summary.status, "reconstructed");
  });
});

test("closeout rejects invalid imported doc spec audit summaries", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "bad-audit-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "doc_spec_audit" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          compared_paths: ["README.md", ".nimi/spec"],
          finding_count: -1,
          status: "aligned",
          summary: "Invalid because finding_count is negative.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 2);
    assert.match(closeoutResult.stderr, /finding_count must be a non-negative integer/);
  });
});

test("doctor reports local doc spec audit artifact status", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "doc-audit-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "doc_spec_audit" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          compared_paths: ["README.md", ".nimi/spec"],
          finding_count: 0,
          status: "aligned",
          summary: "README and .nimi/spec are aligned.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--write-local",
      "--json",
    ]);
    assert.equal(closeoutResult.exitCode, 0);

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 0);

    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.auditArtifact.present, true);
    assert.equal(payload.auditArtifact.ok, true);
    assert.equal(payload.auditArtifact.outcome, "completed");
    assert.equal(payload.auditArtifact.summaryStatus, "aligned");
  });
});

test("closeout imports a valid high risk execution summary before writing local artifact", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--write-local",
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 0);
    const payload = JSON.parse(closeoutResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.skill.id, "high_risk_execution");
    assert.equal(payload.skill.resultContractRef, ".nimi/contracts/high-risk-execution-result.yaml");
    assert.equal(payload.localOnly, true);
    assert.equal(payload.summary.status, "candidate_ready");
    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.summary.packet_ref, ".nimi/local/packets/topic-1.yaml");
    assert.equal(stored.summary.status, "candidate_ready");
  });
});

test("closeout rejects invalid high risk execution summaries", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "bad-high-risk-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [],
          status: "completed",
          summary: "Invalid summary.",
          verified_at: "2026-04-10T00:00:00.000Z",
          extra_ref: ".nimi/local/extra.txt",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 2);
    assert.match(
      closeoutResult.stderr,
      /contains unexpected fields|must be a non-empty array of non-empty strings|must be one of/,
    );
  });
});

test("closeout rejects high risk execution refs outside declared local roots", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "bad-high-risk-roots-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".omx/runtime/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "Invalid because orchestration state escaped the declared local root.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 2);
    assert.match(closeoutResult.stderr, /must stay under \.nimi\/local\/orchestration/);
  });
});

test("closeout rejects high risk execution summary timestamp drift", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const importPath = path.join(projectRoot, "bad-high-risk-timestamp-closeout.json");
    await writeFile(
      importPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "blocked",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "blocked",
          summary: "Blocked waiting for authority clarification.",
          verified_at: "2026-04-11T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 2);
    assert.match(closeoutResult.stderr, /must match the top-level verifiedAt/);
  });
});

test("closeout rejects malformed imported JSON summaries", async () => {
  await withTempProject(async (projectRoot) => {
    const importPath = path.join(projectRoot, "bad-closeout.json");
    await writeFile(importPath, "{\"skill\":{}}\n", "utf8");

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--json",
    ]);

    assert.equal(closeoutResult.exitCode, 2);
    assert.match(closeoutResult.stderr, /must declare `skill.id`/);
  });
});

test("closeout rejects conflicting imported and explicit fields", async () => {
  const closeoutResult = await captureRunCli([
    "closeout",
    "--from",
    "/tmp/example.json",
    "--skill",
    "spec_reconstruction",
  ]);

  assert.equal(closeoutResult.exitCode, 2);
  assert.match(closeoutResult.stderr, /cannot be combined/);
});

test("ingest-high-risk-execution validates referenced candidate artifacts and writes a local payload", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 0);
    const payload = JSON.parse(ingestResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-ingest.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.validations.executionPacket.ok, true);
    assert.equal(payload.validations.workerOutput.ok, true);
    assert.equal(payload.validations.workerOutput.signal.status, "complete");
    assert.equal(payload.validations.evidence[0].ok, true);

    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.skill.id, "high_risk_execution");
    assert.equal(stored.validations.prompt.ok, true);
  });
});

test("ingest-high-risk-execution refuses non-completed high risk closeout artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-blocked-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "blocked",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "blocked",
          summary: "Blocked waiting for review.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 2);
    assert.match(ingestResult.stderr, /requires a completed high_risk_execution closeout artifact/);
  });
});

test("ingest-high-risk-execution fails closed when referenced artifacts are mechanically invalid", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot, {
      workerOutputFixture: "worker-output.invalid.md",
    });

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 1);
    const payload = JSON.parse(ingestResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.validations.workerOutput.ok, false);
    assert.equal(payload.validations.workerOutput.refusal.code, "RUNNER_SIGNAL_MISSING");
  });
});

test("review-high-risk-execution projects a manager-ready local payload from valid ingest", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ]);
    assert.equal(ingestResult.exitCode, 0);
    const ingestPayload = JSON.parse(ingestResult.stdout);

    const reviewResult = await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPayload.artifactPath,
      "--write-local",
      "--json",
    ]);

    assert.equal(reviewResult.exitCode, 0);
    const payload = JSON.parse(reviewResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-review.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.reviewStatus, "ready_for_manager_review");
    assert.equal(payload.managerReviewOwner, "nimicoding_manager");
    assert.equal(payload.attachmentRefs.worker_output_ref, ".nimi/local/outputs/topic-1.worker-output.md");

    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.skill.id, "high_risk_execution");
    assert.equal(stored.reviewStatus, "ready_for_manager_review");
  });
});

test("review-high-risk-execution rejects non-ready ingest payloads", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const ingestPath = path.join(projectRoot, "bad-ingest.json");
    await writeFile(
      ingestPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-ingest.v1",
        ok: false,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        validations: {
          executionPacket: { ok: false },
          orchestrationState: { ok: true },
          prompt: { ok: true },
          workerOutput: { ok: true },
          evidence: [{ ok: true }],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const reviewResult = await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPath,
      "--json",
    ]);

    assert.equal(reviewResult.exitCode, 2);
    assert.match(reviewResult.stderr, /requires an ingest payload with ok true/);
  });
});

test("decide-high-risk-execution records a manager-owned local decision from review-ready payload", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ]);
    assert.equal(ingestResult.exitCode, 0);
    const ingestPayload = JSON.parse(ingestResult.stdout);

    const reviewResult = await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPayload.artifactPath,
      "--write-local",
      "--json",
    ]);
    assert.equal(reviewResult.exitCode, 0);
    const reviewPayload = JSON.parse(reviewResult.stdout);

    const acceptancePath = path.join(projectRoot, ".nimi", "local", "reviews", "topic-1.acceptance.md");
    await mkdir(path.dirname(acceptancePath), { recursive: true });
    await writeFile(
      acceptancePath,
      await readFile(path.join(repoRoot, "test", "fixtures", "validators", "acceptance.valid.md"), "utf8"),
      "utf8",
    );

    const decisionResult = await captureRunCli([
      "decide-high-risk-execution",
      "--from",
      reviewPayload.artifactPath,
      "--acceptance",
      acceptancePath,
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--write-local",
      "--json",
    ]);

    assert.equal(decisionResult.exitCode, 0);
    const payload = JSON.parse(decisionResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-decision.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.decisionStatus, "manager_decision_recorded");
    assert.equal(payload.acceptanceDisposition, "complete");
    assert.equal(payload.acceptanceValidation.ok, true);
    assert.equal(payload.managerReviewOwner, "nimicoding_manager");

    const stored = JSON.parse(await readFile(payload.artifactPath, "utf8"));
    assert.equal(stored.skill.id, "high_risk_execution");
    assert.equal(stored.decisionStatus, "manager_decision_recorded");
  });
});

test("decide-high-risk-execution rejects invalid manager acceptance artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const reviewPath = path.join(projectRoot, "review.json");
    await writeFile(
      reviewPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-review.v1",
        ok: true,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        reviewStatus: "ready_for_manager_review",
        managerReviewOwner: "nimicoding_manager",
        attachmentRefs: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const acceptancePath = path.join(projectRoot, "bad.acceptance.md");
    await writeFile(
      acceptancePath,
      await readFile(path.join(repoRoot, "test", "fixtures", "validators", "acceptance.invalid.md"), "utf8"),
      "utf8",
    );

    const decisionResult = await captureRunCli([
      "decide-high-risk-execution",
      "--from",
      reviewPath,
      "--acceptance",
      acceptancePath,
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(decisionResult.exitCode, 1);
    const payload = JSON.parse(decisionResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.acceptanceValidation.ok, false);
    assert.equal(payload.acceptanceValidation.refusal.code, "ACCEPTANCE_INVALID");
  });
});

test("admit-high-risk-decision updates canonical high-risk admissions truth when explicitly requested", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await seedHighRiskCandidateArtifacts(projectRoot);

    const closeoutPath = path.join(projectRoot, "high-risk-closeout.json");
    await writeFile(
      closeoutPath,
      `${JSON.stringify({
        projectRoot,
        skill: { id: "high_risk_execution" },
        outcome: "completed",
        verifiedAt: "2026-04-10T00:00:00.000Z",
        localOnly: true,
        summary: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
          orchestration_state_ref: ".nimi/local/orchestration/topic-1.yaml",
          prompt_ref: ".nimi/local/prompts/topic-1.md",
          worker_output_ref: ".nimi/local/outputs/topic-1.worker-output.md",
          evidence_refs: [
            ".nimi/local/evidence/topic-1.patch",
          ],
          status: "candidate_ready",
          summary: "External execution produced a candidate packet/output/evidence bundle.",
          verified_at: "2026-04-10T00:00:00.000Z",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestPayload = JSON.parse((await captureRunCli([
      "ingest-high-risk-execution",
      "--from",
      closeoutPath,
      "--write-local",
      "--json",
    ])).stdout);

    const reviewPayload = JSON.parse((await captureRunCli([
      "review-high-risk-execution",
      "--from",
      ingestPayload.artifactPath,
      "--write-local",
      "--json",
    ])).stdout);

    const acceptancePath = path.join(projectRoot, ".nimi", "local", "reviews", "topic-1.acceptance.md");
    await mkdir(path.dirname(acceptancePath), { recursive: true });
    await writeFile(
      acceptancePath,
      await readFile(path.join(repoRoot, "test", "fixtures", "validators", "acceptance.valid.md"), "utf8"),
      "utf8",
    );

    const decisionPayload = JSON.parse((await captureRunCli([
      "decide-high-risk-execution",
      "--from",
      reviewPayload.artifactPath,
      "--acceptance",
      acceptancePath,
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--write-local",
      "--json",
    ])).stdout);

    const admitResult = await captureRunCli([
      "admit-high-risk-decision",
      "--from",
      decisionPayload.artifactPath,
      "--admitted-at",
      "2026-04-11T00:00:00.000Z",
      "--write-spec",
      "--json",
    ]);

    assert.equal(admitResult.exitCode, 0);
    const payload = JSON.parse(admitResult.stdout);
    assert.equal(payload.contractVersion, "nimicoding.high-risk-admission.v1");
    assert.equal(payload.ok, true);
    assert.equal(payload.admissionAction, "created");
    assert.equal(payload.admissionRecord.topic_id, "topic-1");
    assert.equal(payload.admissionRecord.packet_id, "pkt-1");
    assert.equal(payload.admissionRecord.disposition, "complete");

    const admissionsText = await readFile(
      path.join(projectRoot, ".nimi", "spec", "high-risk-admissions.yaml"),
      "utf8",
    );
    assert.match(admissionsText, /topic_id: topic-1/);
    assert.match(admissionsText, /packet_id: pkt-1/);
    assert.match(admissionsText, /disposition: complete/);
  });
});

test("admit-high-risk-decision rejects non-recorded decision payloads", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const decisionPath = path.join(projectRoot, "bad-decision.json");
    await writeFile(
      decisionPath,
      `${JSON.stringify({
        contractVersion: "nimicoding.high-risk-decision.v1",
        ok: false,
        projectRoot,
        localOnly: true,
        skill: { id: "high_risk_execution" },
        decisionStatus: "blocked",
        acceptanceValidation: { ok: false },
        attachmentRefs: {
          packet_ref: ".nimi/local/packets/topic-1.yaml",
        },
      }, null, 2)}\n`,
      "utf8",
    );

    const admitResult = await captureRunCli([
      "admit-high-risk-decision",
      "--from",
      decisionPath,
      "--admitted-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(admitResult.exitCode, 2);
    assert.match(admitResult.stderr, /requires a decision payload with ok true/);
  });
});
