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

test("package files publish canonical source dirs and start output matches source projection", { concurrency: false }, async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("adapters"));
  assert.ok(packageJson.files.includes("config"));
  assert.ok(packageJson.files.includes("contracts"));
  assert.ok(packageJson.files.includes("methodology"));
  assert.ok(packageJson.files.includes("spec"));
  assert.ok(!packageJson.files.includes("templates"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "methodology", "spec-target-truth-profile.yaml"), "utf8"));

  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const seedMap = await createBootstrapSeedFileMap();
    assert.ok(!seedMap.has(".nimi/methodology/spec-target-truth-profile.yaml"));
    assert.ok(seedMap.has(".nimi/config/spec-generation-inputs.yaml"));
    assert.ok(seedMap.has(".nimi/contracts/spec-generation-inputs.schema.yaml"));
    assert.ok(seedMap.has(".nimi/contracts/spec-generation-audit.schema.yaml"));
    assert.ok(seedMap.has(".nimi/contracts/topic.schema.yaml"));
    assert.ok(seedMap.has(".nimi/contracts/wave.schema.yaml"));
    assert.ok(seedMap.has(".nimi/contracts/closeout.schema.yaml"));
    assert.ok(seedMap.has(".nimi/contracts/pending-note.schema.yaml"));
    assert.ok(seedMap.has(".nimi/contracts/forbidden-shortcuts.catalog.yaml"));
    assert.ok(seedMap.has(".nimi/methodology/topic-ontology.yaml"));
    assert.ok(seedMap.has(".nimi/methodology/topic-lifecycle.yaml"));
    assert.ok(seedMap.has(".nimi/methodology/four-closure-policy.yaml"));
    assert.ok(seedMap.has(".nimi/spec/_meta/spec-tree-model.yaml"));
    assert.ok(seedMap.has(".nimi/spec/_meta/command-gating-matrix.yaml"));
    assert.ok(seedMap.has(".nimi/spec/_meta/spec-authority-cutover-readiness.yaml"));
    assert.ok(seedMap.has(".nimi/spec/_meta/generate-drift-migration-checklist.yaml"));
    assert.ok(seedMap.has(".nimi/spec/_meta/governance-routing-cutover-checklist.yaml"));
    assert.ok(seedMap.has(".nimi/spec/_meta/phase2-impacted-surface-matrix.yaml"));
    for (const [relativePath, expected] of seedMap.entries()) {
      const actual = await readFile(path.join(projectRoot, relativePath), "utf8");
      assert.equal(actual, expected, `source projection mismatch for ${relativePath}`);
    }
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "methodology", "spec-target-truth-profile.yaml"), "utf8"));
  });
});

test("package repo exposes package source dirs and is not treated as a host project unless initialized", async () => {
  await assert.doesNotReject(readFile(path.join(repoRoot, "methodology", "core.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "methodology", "topic-ontology.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "config", "spec-generation-inputs.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "contracts", "spec-generation-inputs.schema.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "contracts", "topic.schema.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "contracts", "spec-generation-audit.schema.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "spec", "product-scope.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "spec", "_meta", "spec-tree-model.yaml"), "utf8"));
  await assert.rejects(readFile(path.join(repoRoot, ".nimicoding-dev", "spec", "authority-map.yaml"), "utf8"));
  await assert.rejects(readFile(path.join(repoRoot, "templates", "bootstrap", ".nimi", "config", "bootstrap.yaml"), "utf8"));
  await assert.rejects(readFile(path.join(repoRoot, ".nimi", "config", "bootstrap.yaml"), "utf8"));

  const doctorResult = await runCliSubprocess(["doctor", "--json"]);
  assert.equal(doctorResult.exitCode, 1);

  const payload = JSON.parse(doctorResult.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.checks.some((check) => check.id === "nimi_root" && check.ok === false));
});

test("doctor fails closed when canonical tree files are present but bootstrap state stays bootstrap_only", { concurrency: false }, async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
    const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
    bootstrapState.state.mode = "bootstrap_only";
    bootstrapState.state.tree_state = "bootstrap_only";
    bootstrapState.state.reconstruction_required = true;
    bootstrapState.status.ready_for_ai_reconstruction = true;
    await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 1);

    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.match(
      JSON.stringify(payload.checks),
      /canonical_tree_ready but required canonical files are still missing|lifecycle drifted away from the current canonical tree readiness/i,
    );
  });
});

test("doctor fails closed when blueprint mode requires a missing blueprint reference", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
    const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
    bootstrapState.state.blueprint_mode = "repo_spec_blueprint";
    await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    const blueprintCheck = payload.checks.find((check) => check.id === "blueprint_reference_contract");
    assert.equal(blueprintCheck.ok, false);
    assert.equal(blueprintCheck.severity, "error");
  });
});

test("repo docs keep cutover readiness separate from authority flip", async () => {
  const agents = await readFile(path.join(repoRoot, "..", "AGENTS.md"), "utf8");
  const claude = await readFile(path.join(repoRoot, "..", "CLAUDE.md"), "utf8");
  const packageReadme = await readFile(path.join(repoRoot, "README.md"), "utf8");
  const adapterReadme = await readFile(path.join(repoRoot, "adapters", "oh-my-codex", "README.md"), "utf8");

  assert.match(agents, /\.nimi\/spec\/\*\*.*current repo-wide (product )?authority/i);
  assert.match(agents, /Git history.*pre-cutover authority history|pre-cutover authority history.*Git/i);
  assert.match(claude, /\.nimi\/spec\/\*\*.*today's repo-wide authority/i);
  assert.match(claude, /Git-only|Git history/i);
  assert.match(packageReadme, /`\/\.nimi\/spec\/\*\*` is now the repo-wide product authority/i);
  assert.match(packageReadme, /authority history now lives in Git/i);
  assert.match(packageReadme, /Pre-cutover readiness work was[\s\S]*evidence only/i);
  assert.match(adapterReadme, /must not:?\s*[\s\S]*treat cutover readiness as an authority flip/i);
  assert.doesNotMatch(agents, /archive\/spec-authority-legacy-20260413/);
  assert.doesNotMatch(claude, /archive\/spec-authority-legacy-20260413/);
});

test("cutover readiness check fails when the readiness artifact drops a required gate family", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const readinessPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-authority-cutover-readiness.yaml");
    const readiness = await readYamlFile(readinessPath);
    readiness.spec_authority_cutover_readiness.gate_families = readiness.spec_authority_cutover_readiness.gate_families.filter(
      (entry) => entry.id !== "benchmark_parity_gate",
    );
    await writeFile(readinessPath, YAML.stringify(readiness), "utf8");

    const result = await runCutoverReadinessCheck(projectRoot);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /gate families without implementation|gate family order/i);
  });
});

test("cutover readiness check fails when reconstruction is only partial", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");
    await writeLocalCloseoutArtifact(projectRoot, "spec_reconstruction", "completed", "partial");
    await writeLocalCloseoutArtifact(projectRoot, "doc_spec_audit", "completed", "aligned");

    const result = await runCutoverReadinessCheck(projectRoot);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /spec-authority-cutover-readiness: NO-GO/);
    assert.match(result.stdout, /canonical_generation_gate/);
    assert.match(result.stdout, /summary\.status is not reconstructed/);
  });
});

test("cutover readiness check fails when blueprint parity fails", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "dual-domain-benchmark", "rule_id_drift");
    await writeLocalCloseoutArtifact(projectRoot, "spec_reconstruction", "completed", "reconstructed");
    await writeLocalCloseoutArtifact(projectRoot, "doc_spec_audit", "completed", "aligned");

    const result = await runCutoverReadinessCheck(projectRoot);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /benchmark_parity_gate/);
    assert.match(result.stdout, /blueprint-audit does not pass/);
  });
});

test("cutover readiness check reports already_cut_over after the authority flip has executed", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");
    await writeLocalCloseoutArtifact(projectRoot, "spec_reconstruction", "completed", "reconstructed");
    await writeLocalCloseoutArtifact(projectRoot, "doc_spec_audit", "completed", "aligned");
    const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
    const bootstrapState = await readYamlFile(bootstrapStatePath);
    bootstrapState.state.mode = "reconstruction_seeded";
    bootstrapState.state.tree_state = "canonical_tree_ready";
    bootstrapState.state.authority_mode = "canonical_active";
    bootstrapState.state.blueprint_mode = "none";
    bootstrapState.state.reconstruction_required = false;
    bootstrapState.status.ready_for_ai_reconstruction = false;
    bootstrapState.status.active_authority_root = ".nimi/spec";
    await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");

    const result = await runCutoverReadinessCheck(projectRoot);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "spec-authority-cutover-readiness: already_cut_over");
  });
});

test("validate-spec-tree accepts a canonical benchmark tree after direct materialization", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");

    const result = await runCliSubprocess(["validate-spec-tree"], { cwd: projectRoot });
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-spec-tree");
    assert.equal(payload.ok, true);
    assert.equal(payload.summary.profile, "minimal");
    assert.equal(payload.summary.missingRequired.length, 0);
  });
});

test("validate-spec-tree fails when a required canonical file is missing after direct materialization", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "missing_domain_file");

    const result = await runCliSubprocess(["validate-spec-tree"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-spec-tree");
    assert.equal(payload.ok, false);
    assert.equal(payload.refusal.code, "SPEC_TREE_INVALID");
    assert.match(JSON.stringify(payload.errors), /missing required canonical files/i);
  });
});

test("validate-spec-tree fails when generated output roots overlap normative roots", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");

    const modelPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-tree-model.yaml");
    const model = await readYamlFile(modelPath);
    model.spec_tree_model.generated_pipelines[0].output_roots = [".nimi/spec/runtime/kernel/generated"];
    await writeFile(modelPath, YAML.stringify(model), "utf8");

    const result = await runCliSubprocess(["validate-spec-tree"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-spec-tree");
    assert.equal(payload.ok, false);
    assert.equal(payload.refusal.code, "SPEC_TREE_INVALID");
    assert.match(JSON.stringify(payload.errors), /generated output roots overlap normative roots/i);
  });
});

test("validate-spec-audit accepts an auditable canonical benchmark tree after direct materialization", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");

    const result = await runCliSubprocess(["validate-spec-audit"], { cwd: projectRoot });
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-spec-audit");
    assert.equal(payload.ok, true);
    assert.equal(payload.summary.requiredAuditedFiles, 4);
  });
});

test("validate-spec-audit accepts file entries from canonical audit shards", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");

    const auditPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml");
    const auditPayload = YAML.parse(await readFile(auditPath, "utf8"));
    const files = auditPayload.spec_generation_audit.files;
    auditPayload.spec_generation_audit.files = [];
    auditPayload.spec_generation_audit.file_entry_refs = [
      ".nimi/spec/_meta/spec-generation-audit/files-0001.yaml",
    ];

    const shardPath = path.join(
      projectRoot,
      ".nimi",
      "spec",
      "_meta",
      "spec-generation-audit",
      "files-0001.yaml",
    );
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(
      shardPath,
      YAML.stringify({
        version: 1,
        contract_ref: ".nimi/contracts/spec-generation-audit.schema.yaml",
        spec_generation_audit_file_entries: {
          parent_ref: ".nimi/spec/_meta/spec-generation-audit.yaml",
          files,
        },
      }),
      "utf8",
    );
    await writeFile(auditPath, YAML.stringify(auditPayload), "utf8");

    const result = await runCliSubprocess(["validate-spec-audit"], { cwd: projectRoot });
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-spec-audit");
    assert.equal(payload.ok, true);
    assert.equal(payload.summary.auditedFiles, files.length);
    assert.deepEqual(payload.summary.missingAuditEntries, []);
  });
});

test("validate-spec-audit rejects invalid file entry shards", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");

    const auditPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml");
    const auditPayload = YAML.parse(await readFile(auditPath, "utf8"));
    const files = auditPayload.spec_generation_audit.files;
    auditPayload.spec_generation_audit.files = [];
    auditPayload.spec_generation_audit.file_entry_refs = [
      ".nimi/spec/_meta/spec-generation-audit/files-0001.yaml",
    ];

    const shardPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit", "files-0001.yaml");
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(
      shardPath,
      YAML.stringify({
        version: 1,
        contract_ref: ".nimi/contracts/spec-generation-audit.schema.yaml",
        spec_generation_audit_file_entries: {
          parent_ref: ".nimi/spec/_meta/other-audit.yaml",
          files,
        },
      }),
      "utf8",
    );
    await writeFile(auditPath, YAML.stringify(auditPayload), "utf8");

    const parentResult = await runCliSubprocess(["validate-spec-audit"], { cwd: projectRoot });
    assert.equal(parentResult.exitCode, 1);
    assert.match(JSON.stringify(JSON.parse(parentResult.stdout).errors), /parent_ref must point to \.nimi\/spec\/_meta\/spec-generation-audit\.yaml/);

    auditPayload.spec_generation_audit.file_entry_refs = [".nimi/local/spec-generation-audit/files-0001.yaml"];
    await writeFile(auditPath, YAML.stringify(auditPayload), "utf8");

    const pathResult = await runCliSubprocess(["validate-spec-audit"], { cwd: projectRoot });
    assert.equal(pathResult.exitCode, 1);
    assert.match(JSON.stringify(JSON.parse(pathResult.stdout).errors), /file_entry_ref must stay under \.nimi\/spec\/_meta\/spec-generation-audit\//);
  });
});

test("validate-spec-audit fails when a required canonical file is missing from the audit contract", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "missing_audit_entry");

    const result = await runCliSubprocess(["validate-spec-audit"], { cwd: projectRoot });
    assert.equal(result.exitCode, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.validator, "validate-spec-audit");
    assert.equal(payload.ok, false);
    assert.equal(payload.refusal.code, "SPEC_AUDIT_INVALID");
    assert.match(JSON.stringify(payload.errors), /missing an audit entry|non-existent canonical file/i);
  });
});

const validatorCases = [
  {
    command: "validate-spec-audit",
    valid: null,
    invalid: null,
    refusalCode: "SPEC_AUDIT_INVALID",
  },
  {
    command: "validate-spec-tree",
    valid: null,
    invalid: null,
    refusalCode: "SPEC_TREE_INVALID",
  },
  {
    command: "validate-execution-packet",
    valid: "execution-packet.valid.yaml",
    invalid: "execution-packet.invalid.yaml",
    refusalCode: "EXECUTION_PACKET_INVALID",
  },
  {
    command: "validate-orchestration-state",
    valid: "orchestration-state.valid.yaml",
    invalid: "orchestration-state.invalid.yaml",
    refusalCode: "ORCHESTRATION_STATE_INVALID",
  },
  {
    command: "validate-prompt",
    valid: "prompt.valid.md",
    invalid: "prompt.invalid.md",
    refusalCode: "PROMPT_INVALID",
  },
  {
    command: "validate-worker-output",
    valid: "worker-output.valid.md",
    invalid: "worker-output.invalid.md",
    refusalCode: "RUNNER_SIGNAL_MISSING",
  },
  {
    command: "validate-acceptance",
    valid: "acceptance.valid.md",
    invalid: "acceptance.invalid.md",
    refusalCode: "ACCEPTANCE_INVALID",
  },
];

for (const validatorCase of validatorCases) {
  test(`${validatorCase.command} returns machine-readable success and refusal payloads`, { concurrency: false }, async () => {
    if (validatorCase.command === "validate-spec-tree" || validatorCase.command === "validate-spec-audit") {
      await withTempProject(async (projectRoot) => {
        const startResult = await captureRunCli(["start"]);
        assert.equal(startResult.exitCode, 0);

        await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");

        const success = await runCliSubprocess([validatorCase.command], { cwd: projectRoot });
        assert.equal(success.exitCode, 0);
        const successPayload = JSON.parse(success.stdout);
        assert.equal(successPayload.contract, "validator-cli-result.v1");
        assert.equal(successPayload.validator, validatorCase.command);
        assert.equal(successPayload.ok, true);

        await materializeFixtureScenario(
          projectRoot,
          "mini-benchmark",
          validatorCase.command === "validate-spec-tree" ? "missing_domain_file" : "missing_audit_entry",
        );

        const failure = await runCliSubprocess([validatorCase.command], { cwd: projectRoot });
        assert.equal(failure.exitCode, 1);
        const failurePayload = JSON.parse(failure.stdout);
        assert.equal(failurePayload.contract, "validator-cli-result.v1");
        assert.equal(failurePayload.validator, validatorCase.command);
        assert.equal(failurePayload.ok, false);
        assert.equal(failurePayload.refusal.code, validatorCase.refusalCode);
        assert.ok(Array.isArray(failurePayload.errors));
        assert.ok(failurePayload.errors.length > 0);
      });
      return;
    }

    const validPath = path.join(repoRoot, "test", "fixtures", "validators", validatorCase.valid);
    const invalidPath = path.join(repoRoot, "test", "fixtures", "validators", validatorCase.invalid);

    const success = await runCliSubprocess([validatorCase.command, validPath]);
    assert.equal(success.exitCode, 0);
    const successPayload = JSON.parse(success.stdout);
    assert.equal(successPayload.contract, "validator-cli-result.v1");
    assert.equal(successPayload.validator, validatorCase.command);
    assert.equal(successPayload.ok, true);

    const failure = await runCliSubprocess([validatorCase.command, invalidPath]);
    assert.equal(failure.exitCode, 1);
    const failurePayload = JSON.parse(failure.stdout);
    assert.equal(failurePayload.contract, "validator-cli-result.v1");
    assert.equal(failurePayload.validator, validatorCase.command);
    assert.equal(failurePayload.ok, false);
    assert.equal(failurePayload.refusal.code, validatorCase.refusalCode);
    assert.ok(Array.isArray(failurePayload.errors));
    assert.ok(failurePayload.errors.length > 0);
  });
}
