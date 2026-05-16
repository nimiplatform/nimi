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

test("doctor warns but does not fail when local runtime directories are absent", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await rm(path.join(projectRoot, ".nimi", "local"), { recursive: true, force: true });
    await rm(path.join(projectRoot, ".nimi", "cache"), { recursive: true, force: true });

    const doctorResult = await captureRunCli(["doctor"]);

    assert.equal(doctorResult.exitCode, 0);
    assert.match(doctorResult.stdout, /Local state directories are absent and can be recreated on demand/);
  });
});

test("doctor text output stays user-facing by default", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const doctorResult = await captureRunCli(["doctor"]);

    assert.equal(doctorResult.exitCode, 0);
    assert.match(doctorResult.stdout, /Summary:/);
    assert.match(doctorResult.stdout, /bootstrap: ready/);
    assert.match(doctorResult.stdout, /handoff: ready/);
    assert.match(doctorResult.stdout, /Next:/);
    assert.doesNotMatch(doctorResult.stdout, /Supported Host Posture:/);
    assert.doesNotMatch(doctorResult.stdout, /runtime_installed:/);
    assert.doesNotMatch(doctorResult.stdout, /Delegated Contracts:/);
  });
});

test("doctor --verbose exposes internal contract detail when requested", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const doctorResult = await captureRunCli(["doctor", "--verbose"]);

    assert.equal(doctorResult.exitCode, 0);
    assert.match(doctorResult.stdout, /Supported Host Posture:/);
    assert.match(doctorResult.stdout, /Delegated Contracts:/);
    assert.match(doctorResult.stdout, /runtime_installed: false/);
  });
});

test("doctor fails closed when bootstrap truth is missing", async () => {
  await withTempProject(async () => {
    const doctorResult = await captureRunCli(["doctor"]);

    assert.equal(doctorResult.exitCode, 1);
    assert.match(doctorResult.stdout, /\.nimi directory is missing/);
    assert.match(doctorResult.stdout, /Run `nimicoding start`/);
  });
});

test("doctor fails closed when delegated contract posture drifts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const handoffPath = path.join(projectRoot, ".nimi", "methodology", "skill-handoff.yaml");
    const handoffText = await readFile(handoffPath, "utf8");
    await writeFile(
      handoffPath,
      handoffText.replace("runtime_owner: external_ai_host", "runtime_owner: local_runtime"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.handoffReadiness.ok, false);
    assert.match(
      JSON.stringify(payload.checks),
      /Delegated runtime ownership, execution mode, or self-hosted posture drifted across contracts/,
    );
  });
});

test("doctor fails closed when host adapter selection is not admitted", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const adapterPath = path.join(projectRoot, ".nimi", "config", "host-adapter.yaml");
    const adapterText = await readFile(adapterPath, "utf8");
    await writeFile(
      adapterPath,
      adapterText.replace("selected_adapter_id: none", "selected_adapter_id: unknown_adapter"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(
      JSON.stringify(payload.checks),
      /selected_adapter_id must be none or one of admitted_adapter_ids/,
    );
  });
});

test("doctor fails closed when an admitted adapter overlay is not packaged", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const adapterPath = path.join(projectRoot, ".nimi", "config", "host-adapter.yaml");
    const adapterText = await readFile(adapterPath, "utf8");
    await writeFile(
      adapterPath,
      adapterText.replace("- oh_my_codex", "- missing_adapter"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(
      JSON.stringify(payload.checks),
      /Package-owned adapter profile overlays are missing or malformed/,
    );
    assert.equal(payload.adapterProfiles.invalid[0].id, "missing_adapter");
  });
});

test("doctor fails closed when result contract refs drift", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const manifestPath = path.join(projectRoot, ".nimi", "config", "skill-manifest.yaml");
    const manifestText = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifestText.replace(
        ".nimi/contracts/spec-reconstruction-result.yaml",
        ".nimi/contracts/wrong-contract.yaml",
      ),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(
      JSON.stringify(payload.checks),
      /Skill manifest result contract refs drifted away from the declared machine contracts/,
    );
  });
});

test("doctor does not require standalone completion truth under host spec in v2", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const productScopePath = path.join(projectRoot, ".nimi", "spec", "product-scope.yaml");
    await assert.rejects(readFile(productScopePath, "utf8"));

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 0);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, true);
    assert.match(JSON.stringify(payload.checks), /v2 host-local surface model does not require \.nimi\/spec\/product-scope\.yaml/);
  });
});

test("doctor fails closed when canonical-tree-ready state loses the generation audit artifact", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await rm(path.join(projectRoot, ".nimi", "local", "state", "spec-generation", "spec-generation-audit.yaml"), { force: true });

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.specGenerationAudit.present, false);
    assert.equal(payload.handoffReadiness.ok, false);
    assert.match(JSON.stringify(payload.checks), /spec generation audit/i);
  });
});

test("doctor fails closed when canonical admissions truth drifts from the packaged schema contract", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "high-risk-admissions.yaml"),
      [
        "admissions:",
        "  - topic_id: topic-1",
        "    packet_id: pkt-1",
        "    disposition: complete",
        "    admitted_at: not-a-timestamp",
        "    manager_review_owner: nimicoding_manager",
        "    summary: bad canonical record",
        "    source_decision_contract: nimicoding.high-risk-decision.v1",
        "admission_rules: []",
        "semantic_constraints: []",
        "",
      ].join("\n"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.handoffReadiness.ok, false);
    assert.match(
      JSON.stringify(payload.checks),
      /Canonical high-risk admissions truth drifted: high-risk admission record admitted_at must be an ISO-8601 UTC timestamp/,
    );
  });
});

test("doctor fails closed when a high-risk execution schema seed drifts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const schemaPath = path.join(projectRoot, ".nimi", "contracts", "execution-packet.schema.yaml");
    const schemaText = await readFile(schemaPath, "utf8");
    await writeFile(
      schemaPath,
      schemaText.replace("kind: execution-packet", "kind: packet"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.match(
      JSON.stringify(payload.checks),
      /High-risk execution schema seeds are missing or malformed/,
    );
  });
});

test("doctor fails closed when external execution artifact roots drift", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const artifactsPath = path.join(projectRoot, ".nimi", "config", "external-execution-artifacts.yaml");
    const artifactsText = await readFile(artifactsPath, "utf8");
    await writeFile(
      artifactsPath,
      artifactsText.replace(".nimi/local/outputs", ".nimi/local/runtime-outputs"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.match(
      JSON.stringify(payload.checks),
      /external execution artifact landing-path contract is missing or malformed/,
    );
  });
});

test("doctor fails closed when external host compatibility contract drifts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const contractPath = path.join(projectRoot, ".nimi", "contracts", "external-host-compatibility.yaml");
    const contractText = await readFile(contractPath, "utf8");
    await writeFile(
      contractPath,
      contractText.replace("host_agnostic_external_host", "named_runtime_owner"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(
      JSON.stringify(payload.checks),
      /Packaged external host compatibility contract is present and aligned|\.nimi\/contracts\/external-host-compatibility\.yaml is missing or malformed/,
    );
  });
});

test("handoff exports spec reconstruction payload during bootstrap-only mode", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const handoffResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.contractVersion, "nimicoding.handoff.v1");
    assert.equal(payload.skill.id, "spec_reconstruction");
    assert.equal(payload.skill.resultContractRef, ".nimi/contracts/spec-reconstruction-result.yaml");
    assert.equal(payload.skill.readiness.ok, true);
    assert.deepEqual(payload.skill.compareTargets, [".nimi/spec"]);
    assert.equal(payload.generationContext.canonicalTargetRoot, ".nimi/spec");
    assert.equal(payload.generationContext.mode, "class_filtered");
    assert.deepEqual(payload.generationContext.requiredFileClasses, [
      "INDEX.md",
      "domain kernel/*.md",
      "domain kernel/tables/**",
    ]);
    assert.equal(payload.generationContext.benchmarkBlueprintRoot, null);
    assert.equal(payload.generationContext.acceptanceMode, "placement_validity_before_generation");
    assert.equal(payload.generationContext.auditRef, ".nimi/local/state/spec-generation/spec-generation-audit.yaml");
    assert.equal(payload.generationContext.auditContractRef, ".nimi/contracts/spec-generation-audit.schema.yaml");
    assert.ok(payload.context.orderedPaths.includes(".nimi/config/spec-generation-inputs.yaml"));
    assert.equal(payload.runtimeOwner, "external_ai_host");
    assert.equal(payload.handoffSurface.authoritativeMode, "json");
    assert.equal(payload.handoffSurface.promptMode, "human_projection_only");
    assert.equal(payload.handoffSurface.hostStrategy, "host_agnostic_external_host");
    assert.equal(payload.handoffSurface.hostCompatibilityRef, ".nimi/contracts/external-host-compatibility.yaml");
    assert.deepEqual(payload.handoffSurface.supportedHostPosture, ["host_agnostic_external_host"]);
    assert.deepEqual(payload.handoffSurface.supportedHostExamples, ["oh_my_codex", "codex", "claude", "gemini"]);
    assert.ok(payload.handoffSurface.requiredHostBehavior.includes("consume_handoff_json_as_authoritative_contract"));
    assert.ok(payload.handoffSurface.forbiddenHostBehavior.includes("assume_packaged_run_kernel"));
    assert.equal(payload.handoffSurface.hostCompatibilitySummary.genericExternalHostCompatible, true);
    assert.equal(payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.mode, "named_admitted_overlay_available");
    assert.deepEqual(payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.admittedOverlayIds, ["codex", "oh_my_codex", "claude"]);
    assert.deepEqual(payload.handoffSurface.hostCompatibilitySummary.futureOnlyHostSurfaces, [
      {
        adapterId: "codex",
        status: "active_via_codex_sdk",
        command: "Codex.startThread().run",
      },
      {
        adapterId: "codex",
        status: "active_via_codex_sdk",
        command: "Codex.resumeThread().run",
      },
      {
        adapterId: "oh_my_codex",
        status: "future_only_not_packaged",
        command: "nimicoding run-next-prompt",
      },
    ]);
    assert.deepEqual(payload.handoffSurface.hostCompatibilitySummary.nativeReviewSurfaces, [
      {
        adapterId: "codex",
        approvalReviewScope: "lower_layer_permission_review",
        approvalReviewSemanticEffect: "none",
        githubAutoReviewScope: "lower_layer_pr_review_findings",
        githubAutoReviewSemanticEffect: "evidence_only",
        forbiddenSemanticSubstitutions: [
          "wave_admission",
          "packet_freeze",
          "result_verdict",
          "wave_closeout",
          "topic_closeout",
          "true_close",
        ],
      },
    ]);
    const codexProfile = payload.adapter.admittedProfiles.find((profile) => profile.id === "codex");
    assert.equal(codexProfile.nativeReviewBoundary.approvalReview.scope, "lower_layer_permission_review");
    assert.equal(codexProfile.nativeReviewBoundary.githubAutoReview.semanticEffect, "evidence_only");
    assert.ok(codexProfile.admittedSkillSurfaces.includes("authority_convergence_audit"));
    const claudeProfile = payload.adapter.admittedProfiles.find((profile) => profile.id === "claude");
    assert.ok(claudeProfile.admittedSkillSurfaces.includes("authority_convergence_audit"));
    assert.equal(payload.adapter.selectedId, "none");
    assert.deepEqual(payload.adapter.admittedIds, ["codex", "oh_my_codex", "claude"]);
    assert.equal(payload.adapter.semanticReviewOwner, "nimicoding_manager");
    assert.equal(payload.contracts.hostAdapterRef, ".nimi/config/host-adapter.yaml");
    assert.equal(
      payload.contracts.exchangeProjectionContractRef,
      ".nimi/methodology/skill-exchange-projection.yaml",
    );
    assert.match(payload.nextAction, /Delegate explicit skill execution/);
  });
});

test("v2 spec reconstruction handoff does not require command gating matrix projection", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const gatingPath = path.join(projectRoot, ".nimi", "spec", "_meta", "command-gating-matrix.yaml");
    await assert.rejects(readFile(gatingPath, "utf8"));

    const handoffResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.skill.id, "spec_reconstruction");
    assert.equal(payload.skill.readiness.ok, true);
  });
});

test("handoff projects an external host prompt for spec reconstruction", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const handoffResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--prompt"]);

    assert.equal(handoffResult.exitCode, 0);
    assert.match(handoffResult.stdout, /Prepared local handoff refs for spec_reconstruction/);
    assert.match(handoffResult.stdout, /\.nimi\/local\/handoff\/spec_reconstruction\.json/);
    assert.match(handoffResult.stdout, /\.nimi\/local\/handoff\/spec_reconstruction\.prompt\.md/);

    const promptText = await readFile(
      path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.prompt.md"),
      "utf8",
    );
    const payloadText = await readFile(
      path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.json"),
      "utf8",
    );
    const payload = JSON.parse(payloadText);

    assert.equal(payload.skill.id, "spec_reconstruction");
    assert.ok(!payload.context.orderedPaths.includes(".nimi/methodology/spec-target-truth-profile.yaml"));
    assert.match(promptText, /Use the JSON handoff payload as the authoritative machine contract/);
    assert.match(promptText, /Treat this prompt as a human-readable projection/);
    assert.match(promptText, /This handoff surface is host-agnostic/);
    assert.match(promptText, /Host compatibility contract: \.nimi\/contracts\/external-host-compatibility\.yaml/);
    assert.match(promptText, /Supported host posture: host_agnostic_external_host/);
    assert.match(promptText, /Supported external host examples: oh_my_codex, codex, claude, gemini/);
    assert.match(promptText, /Required host behavior: consume_handoff_json_as_authoritative_contract/);
    assert.match(promptText, /Forbidden host behavior: assume_packaged_run_kernel/);
    assert.doesNotMatch(promptText, /spec-target-truth-profile/);
    assert.match(promptText, /Generic external host compatible: true/);
    assert.match(promptText, /Named overlay mode: named_admitted_overlay_available/);
    assert.match(promptText, /Admitted named overlays: codex, oh_my_codex, claude/);
    assert.match(promptText, /Future-only host surfaces: codex:Codex\.startThread\(\)\.run:active_via_codex_sdk, codex:Codex\.resumeThread\(\)\.run:active_via_codex_sdk, oh_my_codex:nimicoding run-next-prompt:future_only_not_packaged/);
    assert.match(promptText, /Native review surfaces: codex:approval=lower_layer_permission_review:none,pr=lower_layer_pr_review_findings:evidence_only/);
    assert.match(promptText, /You are the external AI host responsible/);
    assert.match(promptText, /Read this project-local truth first, in order:/);
    assert.match(promptText, /Do not assume local skill installation or self-hosting/);
    assert.match(promptText, /Canonical target root: \.nimi\/spec/);
    assert.match(promptText, /Audit output: \.nimi\/local\/state\/spec-generation\/spec-generation-audit\.yaml/);
    assert.match(promptText, /Write `\.nimi\/local\/state\/spec-generation\/spec-generation-audit\.yaml` as local generation state/);
    assert.match(promptText, /Required file classes: INDEX\.md, domain kernel\/\*\.md, domain kernel\/tables\/\*\*/);
    assert.match(promptText, /Minimum generation sequence: classify_inputs, validate_placement, write_product_authority/);
    assert.match(promptText, /Code roots: none/);
    assert.match(promptText, /Docs roots: \.nimi\/spec/);
    assert.match(promptText, /For ordinary projects without a benchmark blueprint/);
  });
});

test("handoff fails closed for doc spec audit before the canonical tree exists", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const handoffResult = await captureRunCli(["handoff", "--skill", "doc_spec_audit", "--json"]);

    assert.equal(handoffResult.exitCode, 1);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.skill.id, "doc_spec_audit");
    assert.equal(payload.skill.readiness.ok, false);
    assert.match(payload.skill.readiness.reason, /current lifecycle state/i);
  });
});

test("handoff allows doc spec audit after the canonical tree is ready", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const handoffResult = await captureRunCli(["handoff", "--skill", "doc_spec_audit", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.skill.id, "doc_spec_audit");
    assert.equal(payload.skill.resultContractRef, ".nimi/contracts/doc-spec-audit-result.yaml");
    assert.deepEqual(payload.skill.compareTargets, ["README.md", ".nimi/spec"]);
    assert.deepEqual(payload.skill.expectedCloseoutSummaryFields, [
      "compared_paths",
      "finding_count",
      "status",
      "summary",
      "verified_at",
    ]);
    assert.equal(payload.skill.readiness.ok, true);
  });
});

test("handoff allows high risk execution after the canonical tree is ready and includes contracts context", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const handoffResult = await captureRunCli(["handoff", "--skill", "high_risk_execution", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.skill.id, "high_risk_execution");
    assert.equal(payload.skill.resultContractRef, ".nimi/contracts/high-risk-execution-result.yaml");
    assert.deepEqual(payload.skill.compareTargets, [".nimi/spec", ".nimi/contracts"]);
    assert.deepEqual(payload.skill.expectedCloseoutSummaryFields, [
      "packet_ref",
      "orchestration_state_ref",
      "prompt_ref",
      "worker_output_ref",
      "evidence_refs",
      "status",
      "summary",
      "verified_at",
    ]);
    assert.deepEqual(payload.skill.expectedCloseoutSummaryStatus, [
      "candidate_ready",
      "blocked",
      "failed",
    ]);
    assert.deepEqual(payload.skill.expectedArtifactKinds, [
      "execution-packet",
      "orchestration-state",
      "prompt",
      "worker-output",
      "acceptance",
    ]);
    assert.deepEqual(payload.skill.expectedArtifactRoots, {
      packet_ref: ".nimi/local/packets",
      orchestration_state_ref: ".nimi/local/orchestration",
      prompt_ref: ".nimi/local/prompts",
      worker_output_ref: ".nimi/local/outputs",
      evidence_refs: ".nimi/local/evidence",
    });
    assert.equal(payload.skill.executionSchemaRefs.length, 5);
    assert.ok(payload.skill.executionSchemaRefs.includes(".nimi/contracts/execution-packet.schema.yaml"));
    assert.ok(payload.context.orderedPaths.includes(".nimi/contracts"));
    assert.ok(payload.context.skillInputs.includes(".nimi/contracts"));
    assert.ok(payload.context.orderedPaths.includes(".nimi/config/external-execution-artifacts.yaml"));
  });
});

test("handoff allows audit sweep after the canonical tree is ready and includes audit artifact roots", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);

    const handoffResult = await captureRunCli(["handoff", "--skill", "audit_sweep", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.skill.id, "audit_sweep");
    assert.equal(payload.skill.resultContractRef, ".nimi/contracts/audit-sweep-result.yaml");
    assert.deepEqual(payload.skill.compareTargets, [".nimi/spec", ".nimi/contracts", ".nimi/methodology"]);
    assert.deepEqual(payload.skill.expectedCloseoutSummaryFields, [
      "plan_ref",
      "chunk_refs",
      "ledger_ref",
      "report_ref",
      "remediation_map_ref",
      "audit_closeout_ref",
      "evidence_refs",
      "finding_count",
      "unresolved_finding_count",
      "status",
      "coverage_scope",
      "coverage_quality",
      "audit_validity",
      "summary",
      "verified_at",
    ]);
    assert.deepEqual(payload.skill.expectedCloseoutSummaryStatus, [
      "candidate_ready",
      "partial",
      "partial_authority_only",
      "blocked_evidence_incomplete",
      "blocked",
    ]);
    assert.deepEqual(payload.skill.expectedArtifactKinds, [
      "audit-plan",
      "audit-chunk",
      "audit-ledger",
      "audit-report",
      "audit-remediation-map",
      "audit-packet",
      "audit-run-ledger",
      "audit-closeout",
    ]);
    assert.deepEqual(payload.skill.expectedArtifactRoots, {
      plan_ref: ".nimi/local/audit/plans",
      chunk_refs: ".nimi/local/audit/chunks",
      ledger_ref: ".nimi/local/audit/ledgers",
      report_ref: ".nimi/local/audit/reports",
      remediation_map_ref: ".nimi/local/audit/remediation-maps",
      audit_closeout_ref: ".nimi/local/audit/closeouts",
      packet_ref: ".nimi/local/audit/packets",
      evidence_refs: ".nimi/local/audit/evidence",
      run_ledger_ref: ".nimi/local/audit/runs",
    });
    assert.ok(payload.context.skillInputs.includes(".nimi/config/audit-execution-artifacts.yaml"));
    assert.ok(payload.context.orderedPaths.includes(".nimi/config/audit-execution-artifacts.yaml"));
    assert.equal(payload.skill.readiness.ok, true);
  });
});
