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

test("version rejects unexpected trailing arguments", async () => {
  const result = await captureRunCli(["--version", "extra"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /version refused: unexpected arguments/);
});

test("help rejects unexpected trailing arguments", async () => {
  const result = await captureRunCli(["--help", "extra"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /help refused: unexpected arguments/);
});

test("start rejects non-directory .nimi path", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(path.join(projectRoot, ".nimi"), "not-a-directory", "utf8");

    const result = await captureRunCli(["start"]);

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /exists and is not a directory/);
    await assert.rejects(readFile(path.join(projectRoot, "AGENTS.md"), "utf8"));
  });
});

test("start restores missing bootstrap seed files without overwriting existing host truth", async () => {
  await withTempProject(async (projectRoot) => {
    await mkdir(path.join(projectRoot, ".nimi", "spec"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"),
      "sentinel: preserved\n",
      "utf8",
    );

    const result = await captureRunCli(["start"]);

    assert.equal(result.exitCode, 0);
    const bootstrapState = await readFile(
      path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"),
      "utf8",
    );
    const manifest = await readFile(
      path.join(projectRoot, ".nimi", "config", "skill-manifest.yaml"),
      "utf8",
    );
    const acceptanceSchema = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "acceptance.schema.yaml"),
      "utf8",
    );
    const agents = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");

    assert.equal(bootstrapState, "sentinel: preserved\n");
    assert.match(manifest, /result_contract_ref: \.nimi\/contracts\/spec-reconstruction-result\.yaml/);
    assert.match(manifest, /- \.nimi\/contracts/);
    assert.match(acceptanceSchema, /kind: acceptance/);
    assert.match(agents, /nimicoding:managed:agents:start/);
    assert.doesNotMatch(result.stdout, /nimicoding start paused/);
  });
});

test("doctor validates a freshly started bootstrap", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const doctorResult = await captureRunCli(["doctor"]);

    assert.equal(doctorResult.exitCode, 0);
    assert.match(doctorResult.stdout, /status: ok/);
    assert.match(doctorResult.stdout, /project rules: invalid/);
    assert.match(doctorResult.stdout, /AI entry files: connected/);
  });
});

test("doctor emits machine-readable JSON", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 0);

    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.bootstrapPresent, true);
    assert.equal(payload.reconstructionRequired, false);
    assert.equal(payload.runtimeInstalled, false);
    assert.equal(payload.handoffReadiness.ok, true);
    assert.equal(payload.specGenerationInputs.mode, "class_filtered");
    assert.equal(payload.specGenerationInputs.benchmarkMode, "none");
    assert.equal(payload.benchmarkAuditReadiness.available, false);
    assert.equal(payload.benchmarkAuditReadiness.ready, false);
    assert.equal(payload.bootstrapContract.status, "supported");
    assert.equal(payload.completionProfile, null);
    assert.equal(payload.completionStatus, "complete");
    assert.equal(payload.hostCompatibility.contractRef, ".nimi/contracts/external-host-compatibility.yaml");
    assert.deepEqual(payload.hostCompatibility.supportedHostPosture, ["host_agnostic_external_host"]);
    assert.deepEqual(payload.hostCompatibility.supportedHostExamples, ["oh_my_codex", "codex", "claude", "gemini"]);
    assert.ok(payload.hostCompatibility.requiredBehavior.includes("consume_handoff_json_as_authoritative_contract"));
    assert.ok(payload.hostCompatibility.forbiddenBehavior.includes("assume_packaged_run_kernel"));
    assert.equal(payload.hostCompatibility.genericExternalHostCompatible, true);
    assert.equal(payload.hostCompatibility.namedOverlaySupport.mode, "named_admitted_overlay_available");
    assert.deepEqual(payload.hostCompatibility.namedOverlaySupport.admittedOverlayIds, ["codex", "oh_my_codex", "claude"]);
    assert.equal(payload.hostCompatibility.namedOverlaySupport.selectedOverlayId, null);
    assert.deepEqual(payload.hostCompatibility.futureOnlyHostSurfaces, [
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
    assert.deepEqual(payload.completedSurfaces, []);
    assert.deepEqual(payload.deferredExecutionSurfaces, []);
    assert.deepEqual(payload.promotedParityGapSummary, []);
    assert.match(JSON.stringify(payload.checks), /Packaged external host compatibility contract is present and aligned/);
    assert.equal(payload.delegatedContracts.runtimeOwner, "external_ai_host");
    assert.equal(payload.delegatedContracts.executionMode, "delegated");
    assert.equal(payload.delegatedContracts.selectedAdapterId, "none");
    assert.deepEqual(payload.delegatedContracts.admittedAdapterIds, ["codex", "oh_my_codex", "claude"]);
    assert.equal(payload.delegatedContracts.adapterHandoffMode, "prompt_output_evidence_handoff");
    assert.equal(payload.delegatedContracts.semanticReviewOwner, "nimicoding_manager");
    assert.equal(payload.adapterProfiles.admitted.length, 3);
    assert.equal(payload.adapterProfiles.invalid.length, 0);
    assert.deepEqual(payload.adapterProfiles.admitted.map((entry) => entry.id), ["codex", "oh_my_codex", "claude"]);
    assert.equal(payload.adapterProfiles.admitted[0].profileRef, "adapters/codex/profile.yaml");
    assert.equal(payload.adapterProfiles.admitted[0].hostClass, "native_codex_sdk_host");
    assert.equal(payload.adapterProfiles.admitted[0].promptHandoff.futureSurfaceStatus, "active_via_codex_sdk");
    assert.deepEqual(payload.adapterProfiles.admitted[0].promptHandoff.futureSurface, [
      "Codex.startThread().run",
      "Codex.resumeThread().run",
    ]);
    assert.equal(payload.adapterProfiles.selected, null);
    assert.equal(payload.auditArtifact.present, false);
    assert.equal(payload.executionContracts.total, 5);
    assert.equal(payload.executionContracts.valid, 5);
    assert.equal(payload.executionContracts.invalid.length, 0);
  });
});

test("doctor and handoff tolerate a legacy host that still keeps the support profile locally", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "methodology"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "methodology", "spec-target-truth-profile.yaml"),
      await readFile(path.join(repoRoot, "methodology", "spec-target-truth-profile.yaml"), "utf8"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 0);
    const doctorPayload = JSON.parse(doctorResult.stdout);
    assert.equal(doctorPayload.ok, true);

    const handoffResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--json"]);
    assert.equal(handoffResult.exitCode, 0);
    const handoffPayload = JSON.parse(handoffResult.stdout);
    assert.equal(handoffPayload.ok, true);
    assert.ok(!handoffPayload.context.orderedPaths.includes(".nimi/methodology/spec-target-truth-profile.yaml"));
  });
});

test("blueprint-audit refuses to run without a declared or explicit blueprint root", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const auditResult = await captureRunCli(["blueprint-audit"]);

    assert.equal(auditResult.exitCode, 2);
    assert.match(auditResult.stderr, /no blueprint root is declared|没有声明 blueprint root/);
  });
});

test("blueprint-audit reports missing canonical coverage when a blueprint root is provided", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, "spec", "runtime", "kernel", "tables"), { recursive: true });
    await writeFile(path.join(projectRoot, "spec", "INDEX.md"), "# Blueprint Spec\n", "utf8");
    await writeFile(path.join(projectRoot, "spec", "runtime", "kernel", "index.md"), "# Runtime Kernel\n", "utf8");
    await writeFile(path.join(projectRoot, "spec", "runtime", "kernel", "tables", "rules.yaml"), "rules: []\n", "utf8");

    const auditResult = await captureRunCli(["blueprint-audit", "--blueprint-root", "spec", "--json"]);

    assert.equal(auditResult.exitCode, 1);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.blueprintRoot, "spec");
    assert.equal(payload.canonicalRoot, ".nimi/spec");
    assert.equal(payload.specGenerationInputs.acceptanceMode, "placement_validity_before_generation");
    assert.ok(payload.inventory.missingDomains.includes("runtime"));
    assert.equal(payload.comparison.kernelMarkdown.missing, 1);
    assert.equal(payload.comparison.kernelTables.missing, 1);
    assert.equal(payload.comparison.kernelGenerated.missing, 0);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.length, 0);
    assert.equal(payload.inventory.indexPresent, false);
  });
});

test("blueprint-audit uses repo-local blueprint reference and can write a local report", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "local", "state", "spec-generation"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "local", "state", "spec-generation", "blueprint-reference.yaml"),
      YAML.stringify({
        version: 1,
        blueprint_reference: {
          mode: "repo_spec_blueprint",
          root: "spec",
          canonical_target_root: ".nimi/spec",
          equivalence_contract_ref:
            ".nimi/topics/closed/2026-04-11-nimicoding-canonical-spec-model-redesign/design.md",
        },
      }),
      "utf8",
    );

    await mkdir(path.join(projectRoot, "spec", "project", "kernel", "tables"), { recursive: true });
    await mkdir(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "tables"), { recursive: true });
    await writeFile(path.join(projectRoot, "spec", "INDEX.md"), "# Blueprint Spec\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "INDEX.md"), "# Blueprint Spec\n", "utf8");
    await writeFile(path.join(projectRoot, "spec", "project", "kernel", "index.md"), "# Project Kernel\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "index.md"), "# Project Kernel\n", "utf8");
    await writeFile(path.join(projectRoot, "spec", "project", "kernel", "tables", "rule-catalog.yaml"), "table_family: product_catalog\nowner: project\ncatalog_id: project_rule_catalog\nentries: []\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "tables", "rule-catalog.yaml"), "table_family: product_catalog\nowner: project\ncatalog_id: project_rule_catalog\nentries: []\n", "utf8");

    const auditResult = await captureRunCli(["blueprint-audit", "--json", "--write-local"]);

    assert.equal(auditResult.exitCode, 0);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.blueprintRoot, "spec");
    assert.equal(payload.specGenerationInputs.acceptanceMode, "placement_validity_before_generation");
    assert.equal(payload.comparison.kernelMarkdown.missing, 0);
    assert.equal(payload.comparison.kernelTables.missing, 0);
    assert.equal(payload.inventory.indexPresent, true);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.length, 0);

    const reportText = await readFile(path.join(projectRoot, ".nimi", "local", "report", "blueprint-equivalence-audit.json"), "utf8");
    const reportPayload = JSON.parse(reportText);
    assert.equal(reportPayload.ok, true);
    assert.equal(reportPayload.blueprintRoot, "spec");
  });
});

test("doctor rejects slug-date local report markdown paths in spec generation inputs", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await updateSpecGenerationInputs(projectRoot, (inputs) => {
      inputs.human_note_paths = [
        ".nimi/topics/nimicoding-canonical-spec-model-redesign-2026-04-11.md",
      ];
    });

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.specGenerationInputs.ok, false);
  });
});

test("doctor rejects slug-date equivalence report refs in blueprint reference metadata", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "local", "state", "spec-generation"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "local", "state", "spec-generation", "blueprint-reference.yaml"),
      YAML.stringify({
        version: 1,
        blueprint_reference: {
          mode: "repo_spec_blueprint",
          root: "spec",
          canonical_target_root: ".nimi/spec",
          equivalence_contract_ref: ".nimi/topics/nimicoding-canonical-spec-model-redesign-2026-04-11.md",
        },
      }),
      "utf8",
    );
    await updateSpecGenerationInputs(projectRoot, (inputs) => {
      inputs.benchmark_mode = "repo_spec_blueprint";
      inputs.benchmark_blueprint_root = "spec";
      inputs.acceptance_mode = "semantic_and_structural_parity_when_blueprint_exists";
    });

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    const blueprintCheck = payload.checks.find((entry) => entry.id === "blueprint_reference_contract");
    assert.equal(blueprintCheck.ok, false);
  });
});

test("doctor accepts topic lifecycle equivalence report refs in blueprint reference metadata", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, ".nimi", "local", "state", "spec-generation"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "local", "state", "spec-generation", "blueprint-reference.yaml"),
      YAML.stringify({
        version: 1,
        blueprint_reference: {
          mode: "repo_spec_blueprint",
          root: "spec",
          canonical_target_root: ".nimi/spec",
          equivalence_contract_ref:
            ".nimi/topics/closed/2026-04-11-nimicoding-canonical-spec-model-redesign/design.md",
        },
      }),
      "utf8",
    );
    await updateSpecGenerationInputs(projectRoot, (inputs) => {
      inputs.benchmark_mode = "repo_spec_blueprint";
      inputs.benchmark_blueprint_root = "spec";
      inputs.acceptance_mode = "semantic_and_structural_parity_when_blueprint_exists";
    });

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 0);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, true);
  });
});

test("doctor accepts topic lifecycle report paths in spec generation inputs", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await updateSpecGenerationInputs(projectRoot, (inputs) => {
      inputs.human_note_paths = [
        ".nimi/topics/proposal/2026-04-14-runtime-speech/design.md",
      ];
    });

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 0);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, true);
  });
});

test("doctor accepts pending topic lifecycle report paths in spec generation inputs", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await updateSpecGenerationInputs(projectRoot, (inputs) => {
      inputs.human_note_paths = [
        ".nimi/topics/pending/2026-04-14-runtime-speech/design.md",
      ];
    });

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 0);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, true);
  });
});

test("doctor rejects .local report roots for human-authored topic reports", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await updateSpecGenerationInputs(projectRoot, (inputs) => {
      inputs.human_note_paths = [
        ".local/report/proposal/2026-04-14-runtime-speech/design.md",
      ];
    });

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.specGenerationInputs.ok, false);
  });
});

test("doctor rejects flat local report paths in spec generation inputs", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await updateSpecGenerationInputs(projectRoot, (inputs) => {
      inputs.human_note_paths = [
        ".nimi/topics/2026-04-14-runtime-speech-design.md",
      ];
    });

    const doctorResult = await captureRunCli(["doctor", "--json"]);
    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.specGenerationInputs.ok, false);
  });
});

test("blueprint-audit accepts absolute blueprint and canonical roots", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, "spec", "project", "kernel", "tables"), { recursive: true });
    await mkdir(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "tables"), { recursive: true });
    await writeFile(path.join(projectRoot, "spec", "INDEX.md"), "# Blueprint Spec\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "INDEX.md"), "# Blueprint Spec\n", "utf8");
    await writeFile(path.join(projectRoot, "spec", "project", "kernel", "index.md"), "# Project Kernel\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "index.md"), "# Project Kernel\n", "utf8");
    await writeFile(path.join(projectRoot, "spec", "project", "kernel", "tables", "rule-catalog.yaml"), "rules:\n  - id: alpha\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "tables", "rule-catalog.yaml"), "rules:\n  - id: alpha\n", "utf8");

    const auditResult = await captureRunCli([
      "blueprint-audit",
      "--blueprint-root",
      path.join(projectRoot, "spec"),
      "--canonical-root",
      path.join(projectRoot, ".nimi", "spec"),
      "--json",
    ]);

    assert.equal(auditResult.exitCode, 0);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.length, 0);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.extraRuleIds.length, 0);
  });
});

test("blueprint-audit reports rule-id preservation gaps when table ids drift", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, "spec", "project", "kernel", "tables"), { recursive: true });
    await mkdir(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "tables"), { recursive: true });
    await writeFile(path.join(projectRoot, "spec", "INDEX.md"), "# Blueprint Spec\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "INDEX.md"), "# Blueprint Spec\n", "utf8");
    await writeFile(path.join(projectRoot, "spec", "project", "kernel", "index.md"), "# Project Kernel\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "index.md"), "# Project Kernel\n", "utf8");
    await writeFile(
      path.join(projectRoot, "spec", "project", "kernel", "tables", "rule-catalog.yaml"),
      "rules:\n  - id: alpha\n",
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "project", "kernel", "tables", "rule-catalog.yaml"),
      "rules:\n  - id: beta\n",
      "utf8",
    );

    const auditResult = await captureRunCli(["blueprint-audit", "--blueprint-root", "spec", "--json"]);

    assert.equal(auditResult.exitCode, 1);
    const payload = JSON.parse(auditResult.stdout);
    assert.deepEqual(payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds, ["alpha"]);
    assert.deepEqual(payload.semanticMappingGaps.ruleIdPreservation.extraRuleIds, ["beta"]);
  });
});

test("blueprint-audit accepts a mini benchmark fixture modeled on nimi/spec structure", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "mini-benchmark", "benchmark_success");

    const auditResult = await captureRunCli(["blueprint-audit", "--json"]);

    assert.equal(auditResult.exitCode, 0);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.blueprintRoot, "spec");
    assert.equal(payload.specGenerationInputs.mode, "class_filtered");
    assert.equal(payload.specGenerationInputs.acceptanceMode, "semantic_and_structural_parity_when_blueprint_exists");
    assert.equal(payload.comparison.kernelMarkdown.missing, 0);
    assert.equal(payload.comparison.kernelTables.missing, 0);
    assert.equal(payload.comparison.kernelGenerated.missing, 0);
    assert.equal(payload.comparison.domainGuides.missing, 0);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.length, 0);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.extraRuleIds.length, 0);
  });
});

test("blueprint-audit accepts a dual-domain benchmark fixture modeled on nimi/spec structure", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "dual-domain-benchmark", "benchmark_success");

    const auditResult = await captureRunCli(["blueprint-audit", "--json"]);

    assert.equal(auditResult.exitCode, 0);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.inventory.blueprintDomains, ["desktop", "runtime"]);
    assert.deepEqual(payload.inventory.canonicalDomains, ["desktop", "runtime"]);
    assert.equal(payload.inventory.missingDomains.length, 0);
    assert.equal(payload.comparison.kernelMarkdown.missing, 0);
    assert.equal(payload.comparison.kernelTables.missing, 0);
    assert.equal(payload.comparison.kernelGenerated.missing, 0);
    assert.equal(payload.comparison.domainGuides.missing, 0);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.length, 0);
    assert.equal(payload.semanticMappingGaps.ruleIdPreservation.extraRuleIds.length, 0);
  });
});

test("blueprint-audit ignores removed generated view surfaces", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "dual-domain-benchmark", "missing_generated_view");

    const auditResult = await captureRunCli(["blueprint-audit", "--json"]);

    assert.equal(auditResult.exitCode, 0);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.derivedViewGaps.missingKernelGenerated, []);
  });
});

test("spec reconstruction handoff uses the mini benchmark fixture as a mixed-input acceptance target", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await applyFixtureScenario({
      repoRoot,
      projectRoot,
      fixtureId: "mini-benchmark",
      scenarioId: "benchmark_inputs_only",
      updateSpecGenerationInputs,
      writeBlueprintReference,
    });
    const handoffResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--json"]);

    assert.equal(handoffResult.exitCode, 0);
    const payload = JSON.parse(handoffResult.stdout);
    assert.equal(payload.skill.id, "spec_reconstruction");
    assert.equal(payload.generationContext.canonicalTargetRoot, ".nimi/spec");
    assert.deepEqual(payload.generationContext.codeRoots, ["src"]);
    assert.deepEqual(payload.generationContext.docsRoots, [".nimi/spec"]);
    assert.deepEqual(payload.generationContext.structureRoots, ["src", "docs"]);
    assert.deepEqual(payload.generationContext.humanNotePaths, [".nimi/local/notes/reconstruction-note.md"]);
    assert.equal(payload.generationContext.benchmarkBlueprintRoot, "spec");
    assert.equal(payload.generationContext.benchmarkMode, "repo_spec_blueprint");
    assert.equal(payload.generationContext.acceptanceMode, "semantic_and_structural_parity_when_blueprint_exists");
    assert.deepEqual(payload.generationContext.minimumGenerationSequence, [
      "classify_inputs",
      "validate_placement",
      "write_product_authority",
      "write_product_authority_tables",
      "write_thin_guidance",
      "write_local_generation_audit",
    ]);
    assert.ok(payload.generationContext.skeletonRules.includes("generate_minimal_kernel_before_optional_guides"));

    const promptResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--prompt"]);
    assert.equal(promptResult.exitCode, 0);
    const promptText = await readFile(
      path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.prompt.md"),
      "utf8",
    );
    assert.match(promptText, /Benchmark blueprint root: spec/);
    assert.match(promptText, /Code roots: src/);
    assert.match(promptText, /Docs roots: \.nimi\/spec/);
    assert.match(promptText, /Human note paths: \.nimi\/local\/notes\/reconstruction-note\.md/);
    assert.match(promptText, /aim for semantic and structural parity/i);
    assert.match(promptText, /minimum generation sequence/i);
    assert.match(promptText, /write_product_authority_tables/);
  });
});

test("fixture loop completes single-domain benchmark reconstruction through closeout and blueprint audit", async () => {
  const result = await runSpecReconstructionFixtureLoop("mini-benchmark", "benchmark_success");

  assert.equal(result.handoffPayload.ok, true);
  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.treeValidationPayload.ok, true);
  assert.equal(result.specAuditResult.exitCode, 0);
  assert.equal(result.specAuditPayload.ok, true);
  assert.equal(result.closeoutResult.exitCode, 0);
  assert.equal(result.closeoutPayload.ok, true);
  assert.equal(result.closeoutPayload.outcome, "completed");
  assert.equal(result.closeoutPayload.summary.status, "reconstructed");
  assert.equal(result.closeoutPayload.summary.audit_ref, ".nimi/local/state/spec-generation/spec-generation-audit.yaml");
  assert.equal(result.blueprintAuditResult.exitCode, 0);
  assert.equal(result.blueprintAuditPayload.ok, true);
});

test("fixture loop completes dual-domain benchmark reconstruction through closeout and blueprint audit", async () => {
  const result = await runSpecReconstructionFixtureLoop("dual-domain-benchmark", "benchmark_success");

  assert.equal(result.handoffPayload.ok, true);
  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 0);
  assert.equal(result.closeoutResult.exitCode, 0);
  assert.equal(result.closeoutPayload.ok, true);
  assert.equal(result.blueprintAuditResult.exitCode, 0);
  assert.equal(result.blueprintAuditPayload.ok, true);
  assert.deepEqual(result.blueprintAuditPayload.inventory.blueprintDomains, ["desktop", "runtime"]);
});

test("fixture loop ignores removed generated view surfaces", async () => {
  const result = await runSpecReconstructionFixtureLoop("dual-domain-benchmark", "missing_generated_view");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 0);
  assert.equal(result.closeoutResult.exitCode, 0);
  assert.equal(result.closeoutPayload.ok, true);
  assert.equal(result.blueprintAuditResult.exitCode, 0);
  assert.equal(result.blueprintAuditPayload.ok, true);
  assert.deepEqual(result.blueprintAuditPayload.derivedViewGaps.missingKernelGenerated, []);
});

test("fixture loop fails completed reconstruction closeout when a domain kernel file is missing", async () => {
  const result = await runSpecReconstructionFixtureLoop("mini-benchmark", "missing_domain_file");

  assert.equal(result.treeValidationResult.exitCode, 1);
  assert.equal(result.specAuditResult.exitCode, 1);
  assert.equal(result.closeoutResult.exitCode, 1);
  assert.equal(result.closeoutPayload.ok, false);
  assert.match(result.closeoutPayload.readiness.reason, /declared canonical tree files/i);
  assert.equal(result.blueprintAuditResult, null);
  assert.equal(result.blueprintAuditPayload, null);
});

test("fixture loop fails benchmark acceptance when kernel table rule ids drift", async () => {
  const result = await runSpecReconstructionFixtureLoop("dual-domain-benchmark", "rule_id_drift");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 0);
  assert.equal(result.closeoutResult.exitCode, 0);
  assert.equal(result.closeoutPayload.ok, true);
  assert.equal(result.blueprintAuditResult.exitCode, 1);
  assert.equal(result.blueprintAuditPayload.ok, false);
  assert.deepEqual(result.blueprintAuditPayload.semanticMappingGaps.ruleIdPreservation.missingRuleIds, ["rt-001"]);
  assert.deepEqual(result.blueprintAuditPayload.semanticMappingGaps.ruleIdPreservation.extraRuleIds, ["rt-999"]);
});

test("fixture loop allows ordinary-project reconstruction without a benchmark blueprint", async () => {
  const result = await runSpecReconstructionFixtureLoop("mini-benchmark", "ordinary_project_success");

  assert.equal(result.scenario.materialization_mode, "host_output_plan");
  assert.equal(result.handoffPayload.ok, true);
  assert.equal(result.handoffPayload.generationContext.benchmarkBlueprintRoot, null);
  assert.equal(result.handoffPayload.generationContext.acceptanceMode, "canonical_tree_validity_without_blueprint");
  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 0);
  assert.equal(result.closeoutResult.exitCode, 0);
  assert.equal(result.closeoutPayload.ok, true);
  assert.equal(result.blueprintAuditResult, null);
  assert.equal(result.blueprintAuditPayload, null);
  assert.match(
    await readFile(path.join(result.projectRoot, ".nimi", "spec", "runtime", "kernel", "core-rules.md"), "utf8"),
    /Rule|Rules|runtime/i,
  );
});

test("fixture loop completes a minimal ordinary-project reconstruction without any benchmark blueprint", async () => {
  const result = await runSpecReconstructionFixtureLoop("minimal-ordinary-project", "minimal_success");

  assert.equal(result.handoffPayload.ok, true);
  assert.equal(result.handoffPayload.generationContext.benchmarkBlueprintRoot, null);
  assert.equal(result.handoffPayload.generationContext.acceptanceMode, "canonical_tree_validity_without_blueprint");
  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 0);
  assert.equal(result.closeoutResult.exitCode, 0);
  assert.equal(result.closeoutPayload.ok, true);
  assert.equal(result.closeoutPayload.summary.status, "reconstructed");
  assert.equal(result.blueprintAuditResult, null);
  assert.match(
    await readFile(path.join(result.projectRoot, ".nimi", "spec", "project", "kernel", "core-rules.md"), "utf8"),
    /PR-001|project rules/i,
  );
});

test("fixture loop allows a minimal ordinary-project reconstruction to close out as partial when unresolved gaps stay explicit", async () => {
  const result = await runSpecReconstructionFixtureLoop("minimal-ordinary-project", "minimal_partial_success");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 0);
  assert.equal(result.closeoutResult.exitCode, 0);
  assert.equal(result.closeoutPayload.ok, true);
  assert.equal(result.closeoutPayload.summary.status, "partial");
  assert.equal(result.closeoutPayload.summary.unresolved_file_count, 1);
  assert.equal(result.closeoutPayload.summary.inferred_file_count, 1);
  assert.equal(result.blueprintAuditResult, null);
});

test("fixture loop fails a minimal ordinary-project reconstruction when the core rules file is missing", async () => {
  const result = await runSpecReconstructionFixtureLoop("minimal-ordinary-project", "missing_core_rules");

  assert.equal(result.treeValidationResult.exitCode, 1);
  assert.equal(result.specAuditResult.exitCode, 1);
  assert.equal(result.closeoutResult.exitCode, 1);
  assert.equal(result.closeoutPayload.ok, false);
  assert.equal(result.blueprintAuditResult, null);
});

test("fixture loop fails completed reconstruction closeout when a required audit entry is missing", async () => {
  const result = await runSpecReconstructionFixtureLoop("mini-benchmark", "missing_audit_entry");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 1);
  assert.equal(result.closeoutResult.exitCode, 1);
  assert.equal(result.closeoutPayload.ok, false);
  assert.match(result.closeoutPayload.readiness.reason, /spec-generation-audit/i);
});

test("fixture loop fails audit validation when a source ref escapes declared inputs", async () => {
  const result = await runSpecReconstructionFixtureLoop("mini-benchmark", "audit_source_escape");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 1);
  assert.equal(result.specAuditPayload.ok, false);
  assert.match(JSON.stringify(result.specAuditPayload.errors), /escape declared inputs/i);
  assert.equal(result.closeoutResult.exitCode, 1);
});

test("fixture loop fails audit validation when inferred files hide unresolved gaps", async () => {
  const result = await runSpecReconstructionFixtureLoop("mini-benchmark", "inferred_without_unresolved");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 1);
  assert.match(JSON.stringify(result.specAuditPayload.errors), /unresolved_items/i);
  assert.equal(result.closeoutResult.exitCode, 1);
});

test("fixture loop fails audit validation when a required file is marked as placeholder", async () => {
  const result = await runSpecReconstructionFixtureLoop("mini-benchmark", "placeholder_required_file");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 1);
  assert.match(JSON.stringify(result.specAuditPayload.errors), /placeholder_not_allowed/i);
  assert.equal(result.closeoutResult.exitCode, 1);
});

test("start continues from bootstrap into spec reconstruction handoff prep", async () => {
  await withTempProject(async (projectRoot) => {
    const result = await captureRunCli(["start"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Step 3\. Rebuild project rules/);
    const handoffJson = await readFile(path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.json"), "utf8");
    assert.match(handoffJson, /"skill":\s*\{\s*"id":\s*"spec_reconstruction"/);
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.prompt.md"), "utf8"));
  });
});

test("start continues into doc spec audit handoff once the canonical tree is ready", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);

    const result = await captureRunCli(["start"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Step 4\. Run a doc\/spec audit/);
    const handoffJson = await readFile(path.join(projectRoot, ".nimi", "local", "handoff", "doc_spec_audit.json"), "utf8");
    assert.match(handoffJson, /"skill":\s*\{\s*"id":\s*"doc_spec_audit"/);
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "local", "handoff", "doc_spec_audit.prompt.md"), "utf8"));
  });
});

test("start accepts --host and prints a short host-specific paste prompt", async () => {
  await withTempProject(async () => {
    const result = await captureRunCli(["start", "--host", "claude"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /selected host: Claude/i);
    assert.match(result.stdout, /Task package for Claude:/i);
    assert.match(result.stdout, /Read `\.nimi\/local\/handoff\/spec_reconstruction\.json` first/i);
  });
});
