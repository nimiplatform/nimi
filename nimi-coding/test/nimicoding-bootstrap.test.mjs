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

test("start rejects unknown options without creating bootstrap files", async () => {
  await withTempProject(async (projectRoot) => {
    const result = await captureRunCli(["start", "--unknown"]);

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /unknown option --unknown/);
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"), "utf8"));
  });
});

test("start bootstraps the project, integrates entrypoints, and prepares spec reconstruction refs", async () => {
  await withTempProject(async (projectRoot) => {
    const result = await captureRunCli(["start"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /nimicoding start wizard:/);

    const bootstrapConfig = await readFile(
      path.join(projectRoot, ".nimi", "config", "bootstrap.yaml"),
      "utf8",
    );
    const specGenerationInputs = await readFile(
      path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml"),
      "utf8",
    );
    const coreYaml = await readFile(
      path.join(projectRoot, ".nimi", "methodology", "core.yaml"),
      "utf8",
    );
    const topicLifecycleReport = await readFile(
      path.join(projectRoot, ".nimi", "methodology", "topic-lifecycle-report.yaml"),
      "utf8",
    );
    const topicOntology = await readFile(
      path.join(projectRoot, ".nimi", "methodology", "topic-ontology.yaml"),
      "utf8",
    );
    const topicLifecycle = await readFile(
      path.join(projectRoot, ".nimi", "methodology", "topic-lifecycle.yaml"),
      "utf8",
    );
    const fourClosurePolicy = await readFile(
      path.join(projectRoot, ".nimi", "methodology", "four-closure-policy.yaml"),
      "utf8",
    );
    const hostAdapter = await readFile(
      path.join(projectRoot, ".nimi", "config", "host-adapter.yaml"),
      "utf8",
    );
    const externalExecutionArtifacts = await readFile(
      path.join(projectRoot, ".nimi", "config", "external-execution-artifacts.yaml"),
      "utf8",
    );
    const auditExecutionArtifacts = await readFile(
      path.join(projectRoot, ".nimi", "config", "audit-execution-artifacts.yaml"),
      "utf8",
    );
    const exchangeProjection = await readFile(
      path.join(projectRoot, ".nimi", "methodology", "skill-exchange-projection.yaml"),
      "utf8",
    );
    const specReconstructionContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "spec-reconstruction-result.yaml"),
      "utf8",
    );
    const highRiskExecutionContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "high-risk-execution-result.yaml"),
      "utf8",
    );
    const auditSweepContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "audit-sweep-result.yaml"),
      "utf8",
    );
    const highRiskAdmissionContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "high-risk-admission.schema.yaml"),
      "utf8",
    );
    const specGenerationInputsContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "spec-generation-inputs.schema.yaml"),
      "utf8",
    );
    const specGenerationAuditContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "spec-generation-audit.schema.yaml"),
      "utf8",
    );
    const surfaceTaxonomyContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "surface-taxonomy.schema.yaml"),
      "utf8",
    );
    const placementContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "placement-contract.schema.yaml"),
      "utf8",
    );
    const tableFamilyContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "table-family.schema.yaml"),
      "utf8",
    );
    const domainAdmissionContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "domain-admission.schema.yaml"),
      "utf8",
    );
    const hostCompatibilityContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "external-host-compatibility.yaml"),
      "utf8",
    );
    const executionPacketSchema = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "execution-packet.schema.yaml"),
      "utf8",
    );
    const topicSchema = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "topic.schema.yaml"),
      "utf8",
    );
    const waveSchema = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "wave.schema.yaml"),
      "utf8",
    );
    const closeoutSchema = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "closeout.schema.yaml"),
      "utf8",
    );
    const pendingNoteSchema = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "pending-note.schema.yaml"),
      "utf8",
    );
    const forbiddenShortcutsCatalog = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "forbidden-shortcuts.catalog.yaml"),
      "utf8",
    );
    const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
    const agents = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "methodology", "spec-target-truth-profile.yaml"), "utf8"));
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"), "utf8"));
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "product-scope.yaml"), "utf8"));
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-tree-model.yaml"), "utf8"));
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "_meta", "command-gating-matrix.yaml"), "utf8"));
    assert.match(bootstrapConfig, /initialized_by: "@nimiplatform\/nimi-coding"/);
    assert.match(bootstrapConfig, /bootstrap_contract: "nimicoding.bootstrap"/);
    assert.match(bootstrapConfig, /bootstrap_contract_version: 1/);
    assert.match(specGenerationInputs, /mode: class_filtered/);
    assert.match(specGenerationInputs, /canonical_target_root: \.nimi\/spec/);
    assert.match(specGenerationInputs, /acceptance_mode: placement_validity_before_generation/);
    assert.doesNotMatch(coreYaml, /cli_runtime/);
    assert.match(topicLifecycleReport, /applicability_boundary:/);
    assert.match(topicLifecycleReport, /small_low_risk_changes_need_topic: false/);
    assert.match(topicOntology, /topic_ontology:/);
    assert.match(topicOntology, /\.nimi\/contracts\/topic\.schema\.yaml/);
    assert.match(topicLifecycle, /fine_grained_states:/);
    assert.match(topicLifecycle, /true_closed/);
    assert.match(fourClosurePolicy, /all_four_must_be_explicit_for_wave_closeout: true/);
    assert.match(hostAdapter, /selected_adapter_id: none/);
    assert.match(hostAdapter, /- codex/);
    assert.match(hostAdapter, /- oh_my_codex/);
    assert.match(hostAdapter, /artifact_contract_ref: \.nimi\/config\/external-execution-artifacts\.yaml/);
    assert.match(externalExecutionArtifacts, /packet_ref: \.nimi\/local\/packets/);
    assert.match(externalExecutionArtifacts, /worker_output_ref: \.nimi\/local\/outputs/);
    assert.match(auditExecutionArtifacts, /skill_id: audit_sweep/);
    assert.match(auditExecutionArtifacts, /plan_ref: \.nimi\/local\/audit\/plans/);
    assert.match(auditExecutionArtifacts, /remediation_map_ref: \.nimi\/local\/audit\/remediation-maps/);
    assert.match(auditExecutionArtifacts, /audit_closeout_ref: \.nimi\/local\/audit\/closeouts/);
    assert.match(auditExecutionArtifacts, /packet_ref: \.nimi\/local\/audit\/packets/);
    assert.match(auditExecutionArtifacts, /run_ledger_ref: \.nimi\/local\/audit\/runs/);
    assert.match(agents, /nimicoding:managed:agents:start/);
    assert.match(claude, /nimicoding:managed:claude:start/);
    assert.match(agents, /AI-context-efficient/);
    assert.match(claude, /AI-context-efficient/);
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.prompt.md"), "utf8"));
    assert.match(exchangeProjection, /exchange_surfaces:/);
    assert.match(exchangeProjection, /contractVersion/);
    assert.match(exchangeProjection, /- handoff/);
    assert.match(exchangeProjection, /- closeout/);
    assert.match(specReconstructionContract, /canonical_tree_completion:/);
    assert.match(specReconstructionContract, /required_tree_state: canonical_tree_ready/);
    assert.match(auditSweepContract, /delegated_audit_sweep_result/);
    assert.match(auditSweepContract, /candidate_ready/);
    assert.match(highRiskExecutionContract, /delegated_high_risk_execution_result/);
    assert.match(highRiskExecutionContract, /candidate_ready/);
    assert.match(highRiskAdmissionContract, /canonical_high_risk_admissions_truth/);
    assert.match(highRiskAdmissionContract, /source_decision_contract/);
    assert.match(specGenerationInputsContract, /canonical_spec_generation_inputs/);
    assert.match(specGenerationInputsContract, /acceptance_mode_enum:/);
    assert.match(specGenerationAuditContract, /canonical_spec_generation_audit/);
    assert.match(specGenerationAuditContract, /required_file_entry_fields:/);
    assert.match(surfaceTaxonomyContract, /taxonomy:/);
    assert.match(placementContract, /nimicoding\.placement-contract\.v1/);
    assert.match(tableFamilyContract, /nimicoding\.table-family\.v1/);
    assert.match(domainAdmissionContract, /nimicoding\.domain-admission\.v1/);
    assert.match(hostCompatibilityContract, /external_host_boundary_compatibility/);
    assert.match(hostCompatibilityContract, /supported_host_posture:/);
    assert.match(hostCompatibilityContract, /host_agnostic_external_host/);
    assert.match(hostCompatibilityContract, /consume_handoff_json_as_authoritative_contract/);
    assert.match(executionPacketSchema, /kind: execution-packet/);
    assert.match(executionPacketSchema, /phase_required:/);
    assert.match(topicSchema, /nimicoding\.topic\.v1/);
    assert.match(topicSchema, /entry_justification/);
    assert.match(waveSchema, /overflowed/);
    assert.match(closeoutSchema, /drift_resistance_closure/);
    assert.match(pendingNoteSchema, /nimicoding\.pending-note\.v1/);
    assert.match(forbiddenShortcutsCatalog, /placeholder_success/);
    assert.match(gitignore, /\.nimi\/local\//);
    assert.match(gitignore, /\.nimi\/cache\//);
    assert.match(gitignore, /\.nimi\/topics\//);
  });
});

test("start refreshes managed entrypoints idempotently", async () => {
  await withTempProject(async (projectRoot) => {
    const first = await captureRunCli(["start"]);
    assert.equal(first.exitCode, 0);

    const agentsBefore = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claudeBefore = await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
    const second = await captureRunCli(["start"]);
    assert.equal(second.exitCode, 0);

    const agents = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");

    assert.match(agents, /nimicoding:managed:agents:start/);
    assert.match(claude, /nimicoding:managed:claude:start/);
    assert.equal(agents, agentsBefore);
    assert.equal(claude, claudeBefore);
  });
});

test("start projects host-local surface contracts as valid yaml", async () => {
  await withTempProject(async (projectRoot) => {
    const result = await captureRunCli(["start"]);
    assert.equal(result.exitCode, 0);

    const specGenerationInputs = await readYamlFile(path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml"));
    const surfaceTaxonomy = await readYamlFile(path.join(projectRoot, ".nimi", "contracts", "surface-taxonomy.schema.yaml"));
    const placementContract = await readYamlFile(path.join(projectRoot, ".nimi", "contracts", "placement-contract.schema.yaml"));
    const domainAdmission = await readYamlFile(path.join(projectRoot, ".nimi", "contracts", "domain-admission.schema.yaml"));
    const tableFamily = await readYamlFile(path.join(projectRoot, ".nimi", "contracts", "table-family.schema.yaml"));

    assert.equal(specGenerationInputs.spec_generation_inputs.mode, "class_filtered");
    assert.equal(specGenerationInputs.contract_ref, ".nimi/contracts/spec-generation-inputs.schema.yaml");
    assert.equal(specGenerationInputs.spec_generation_inputs.acceptance_mode, "placement_validity_before_generation");
    assert.ok(Array.isArray(surfaceTaxonomy.taxonomy));
    assert.equal(placementContract.contract.id, "nimicoding.placement-contract.v1");
    assert.equal(domainAdmission.contract.id, "nimicoding.domain-admission.v1");
    assert.equal(tableFamily.contract.id, "nimicoding.table-family.v1");
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"), "utf8"));
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "product-scope.yaml"), "utf8"));
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-tree-model.yaml"), "utf8"));
  });
});

test("clear rejects unknown options", async () => {
  const result = await captureRunCli(["clear", "--unknown"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unknown option --unknown/);
});

test("clear removes managed entrypoints and package-owned bootstrap files but keeps project-owned truth", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const clearResult = await captureRunCli(["clear", "--yes"]);
    assert.equal(clearResult.exitCode, 0);
    assert.match(clearResult.stdout, /nimicoding clear/);

    await assert.rejects(readFile(path.join(projectRoot, "AGENTS.md"), "utf8"));
    await assert.rejects(readFile(path.join(projectRoot, "CLAUDE.md"), "utf8"));

    const seedMap = await createBootstrapSeedFileMap();
    for (const [relativePath] of seedMap.entries()) {
      const absolutePath = path.join(projectRoot, relativePath);

      if (
        relativePath.startsWith(".nimi/config/")
        || relativePath.startsWith(".nimi/contracts/")
        || relativePath.startsWith(".nimi/methodology/")
      ) {
        await assert.rejects(readFile(absolutePath, "utf8"), `expected clear to remove ${relativePath}`);
        continue;
      }

      const actual = await readFile(absolutePath, "utf8");
      assert.ok(actual.length > 0, `expected clear to preserve ${relativePath}`);
    }

    await assert.doesNotReject(readFile(path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.json"), "utf8"));
    await assert.doesNotReject(readFile(path.join(projectRoot, ".nimi", "cache"), "utf8").catch((error) => {
      if (error.code === "EISDIR") {
        return "";
      }
      throw error;
    }));
  });
});

test("clear preserves locally modified managed files and bootstrap truth", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      `# AGENTS.md

Custom guidance above.

<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block
managed content
<!-- nimicoding:managed:agents:end -->

Custom guidance below.
`,
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "config", "bootstrap.yaml"),
      "initialized_by: custom-user\n",
      "utf8",
    );

    const clearResult = await captureRunCli(["clear", "--yes"]);
    assert.equal(clearResult.exitCode, 0);
    assert.match(clearResult.stdout, /kept because it was modified|已保留，因为它已被修改/);

    const agents = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    const bootstrapConfig = await readFile(path.join(projectRoot, ".nimi", "config", "bootstrap.yaml"), "utf8");

    assert.doesNotMatch(agents, /nimicoding:managed:agents:start/);
    assert.match(agents, /Custom guidance above\./);
    assert.match(agents, /Custom guidance below\./);
    assert.equal(bootstrapConfig, "initialized_by: custom-user\n");
  });
});
