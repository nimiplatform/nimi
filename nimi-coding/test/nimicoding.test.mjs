import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";

import { runCli } from "../cli/nimicoding.mjs";
import { createBootstrapSeedFileMap } from "../cli/seeds/bootstrap.mjs";
import {
  applyFixtureScenario,
  applyScenarioMutations,
  buildSpecReconstructionCloseoutImport,
  loadFixtureManifest,
  materializeFixtureHostOutput,
} from "./spec-generation-scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFile = promisify(execFileCallback);

async function withTempProject(fn) {
  const previousCwd = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "nimicoding-test-"));

  process.chdir(tempRoot);

  try {
    return await fn(tempRoot);
  } finally {
    process.chdir(previousCwd);
  }
}

async function writeGovernanceConfig(projectRoot, governance) {
  const configPath = path.join(projectRoot, ".nimi", "config", "governance.yaml");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, YAML.stringify(governance), "utf8");
}

async function captureRunCli(args) {
  let stdout = "";
  let stderr = "";

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk, encoding, callback) => {
    stdout += String(chunk);
    if (typeof encoding === "function") {
      encoding();
      return true;
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  process.stderr.write = ((chunk, encoding, callback) => {
    stderr += String(chunk);
    if (typeof encoding === "function") {
      encoding();
      return true;
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  try {
    const exitCode = await runCli(args);
    return { exitCode, stdout, stderr };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

async function runCliSubprocess(args, options = {}) {
  try {
    const result = await execFile(
      process.execPath,
      [path.join(repoRoot, "bin", "nimicoding.mjs"), ...args],
      { cwd: options.cwd ?? repoRoot },
    );
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function runCutoverReadinessCheck(cwd) {
  try {
    const result = await execFile(
      process.execPath,
      [path.join(repoRoot, "..", "scripts", "check-spec-authority-cutover-readiness.mjs")],
      { cwd },
    );
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function updateSpecGenerationInputs(projectRoot, updater) {
  const configPath = path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml");
  const config = YAML.parse(await readFile(configPath, "utf8"));
  updater(config.spec_generation_inputs);
  await writeFile(configPath, YAML.stringify(config), "utf8");
}

async function writeBlueprintReference(projectRoot, root = "spec") {
  const blueprintReferencePath = path.join(projectRoot, ".nimi", "spec", "_meta", "blueprint-reference.yaml");
  const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
  await mkdir(path.dirname(blueprintReferencePath), { recursive: true });
  await writeFile(
    blueprintReferencePath,
    YAML.stringify({
      version: 1,
      blueprint_reference: {
        mode: "repo_spec_blueprint",
        root,
        canonical_target_root: ".nimi/spec",
        equivalence_contract_ref:
          ".nimi/local/report/closed/2026-04-11-nimicoding-canonical-spec-model-redesign/design.md",
      },
    }),
    "utf8",
  );

  const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
  bootstrapState.state.blueprint_mode = root === "spec" ? "repo_spec_blueprint" : "custom_blueprint";
  await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");
}

async function seedReconstructedTargetTruth(projectRoot) {
  const canonicalFiles = {
    "INDEX.md": "# Project Spec\n\n- Canonical root for project rules.\n",
    "project/kernel/index.md": "# Project Kernel\n\n- Canonical kernel index.\n",
    "project/kernel/core-rules.md": "# Core Rules\n\n- Rule 1: fail closed on authority ambiguity.\n",
    "project/kernel/tables/rule-catalog.yaml": "rules:\n  - id: rule-1\n    title: fail_closed_on_authority_ambiguity\n",
    "high-risk-admissions.yaml": "admissions: []\nadmission_rules: []\nsemantic_constraints: []\n",
  };

  for (const [relativePath, contents] of Object.entries(canonicalFiles)) {
    const absolutePath = path.join(projectRoot, ".nimi", "spec", relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }

  await mkdir(path.join(projectRoot, ".nimi", "spec", "_meta"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml"),
    YAML.stringify({
      version: 1,
      contract_ref: ".nimi/contracts/spec-generation-audit.schema.yaml",
      spec_generation_audit: {
        generation_mode: "mixed",
        canonical_target_root: ".nimi/spec",
        declared_profile: "minimal",
        input_roots: {
          code_roots: [],
          docs_roots: ["README.md"],
          structure_roots: ["."],
          human_note_paths: [],
          benchmark_blueprint_root: null,
        },
        files: [
          {
            canonical_path: ".nimi/spec/INDEX.md",
            file_class: "index",
            source_refs: ["README.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
          {
            canonical_path: ".nimi/spec/project/kernel/index.md",
            file_class: "kernel_markdown",
            source_refs: ["README.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
          {
            canonical_path: ".nimi/spec/project/kernel/core-rules.md",
            file_class: "kernel_markdown",
            source_refs: ["README.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
          {
            canonical_path: ".nimi/spec/project/kernel/tables/rule-catalog.yaml",
            file_class: "kernel_tables",
            source_refs: ["README.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
        ],
      },
    }),
    "utf8",
  );

  const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
  const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
  bootstrapState.state.mode = "reconstruction_seeded";
  bootstrapState.state.tree_state = "canonical_tree_ready";
  bootstrapState.state.reconstruction_required = false;
  bootstrapState.status.ready_for_ai_reconstruction = false;
  bootstrapState.cutover_readiness.gate_status.canonical_generation_gate = "ready";
  await writeFile(
    bootstrapStatePath,
    YAML.stringify(bootstrapState),
    "utf8",
  );
}

async function seedTargetTruthFilesOnly(projectRoot) {
  const targetFiles = {
    "high-risk-admissions.yaml": "admissions: []\nadmission_rules: []\nsemantic_constraints: []\n",
  };

  for (const [fileName, contents] of Object.entries(targetFiles)) {
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", fileName),
      contents,
      "utf8",
    );
  }
}

async function seedHighRiskCandidateArtifacts(projectRoot, options = {}) {
  const artifacts = [
    {
      target: ".nimi/local/packets/topic-1.yaml",
      fixture: options.packetFixture ?? "execution-packet.valid.yaml",
    },
    {
      target: ".nimi/local/orchestration/topic-1.yaml",
      fixture: options.orchestrationFixture ?? "orchestration-state.valid.yaml",
    },
    {
      target: ".nimi/local/prompts/topic-1.md",
      fixture: options.promptFixture ?? "prompt.valid.md",
    },
    {
      target: ".nimi/local/outputs/topic-1.worker-output.md",
      fixture: options.workerOutputFixture ?? "worker-output.valid.md",
    },
  ];

  for (const artifact of artifacts) {
    const targetPath = path.join(projectRoot, artifact.target);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(
      targetPath,
      await readFile(path.join(repoRoot, "test", "fixtures", "validators", artifact.fixture), "utf8"),
      "utf8",
    );
  }

  const evidencePath = path.join(projectRoot, ".nimi", "local", "evidence", "topic-1.patch");
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, "diff --git a/src/example.mjs b/src/example.mjs\n", "utf8");
}

async function readYamlFile(filePath) {
  return YAML.parse(await readFile(filePath, "utf8"));
}

async function markCanonicalTreeReady(projectRoot) {
  const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
  const bootstrapState = await readYamlFile(bootstrapStatePath);
  bootstrapState.state.mode = "reconstruction_seeded";
  bootstrapState.state.tree_state = "canonical_tree_ready";
  bootstrapState.state.reconstruction_required = false;
  bootstrapState.status.ready_for_ai_reconstruction = false;
  bootstrapState.cutover_readiness.gate_status.canonical_generation_gate = "ready";
  await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");
}

async function writeLocalCloseoutArtifact(projectRoot, skillId, outcome, status) {
  const artifactPath = path.join(projectRoot, ".nimi", "local", "handoff-results", `${skillId}.json`);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify({
      contractVersion: "nimicoding.closeout.v1",
      ok: true,
      projectRoot,
      localOnly: true,
      artifactPath: `.nimi/local/handoff-results/${skillId}.json`,
      skill: { id: skillId },
      outcome,
      verifiedAt: "2026-04-12T00:00:00.000Z",
      summary: status ? { status } : undefined,
    }, null, 2)}\n`,
    "utf8",
  );
}

async function materializeFixtureScenario(projectRoot, fixtureId, scenarioId) {
  const fixture = await loadFixtureManifest(repoRoot, fixtureId);
  const scenario = fixture.scenarios.find((entry) => entry.id === scenarioId);
  assert.ok(scenario, `Unknown fixture scenario '${scenarioId}'`);

  if (scenario.materialization_mode === "host_output_plan") {
    await applyFixtureScenario({
      repoRoot,
      projectRoot,
      fixtureId,
      scenarioId,
      updateSpecGenerationInputs,
      writeBlueprintReference,
      scenarioOverrides: {
        apply_canonical: false,
        mutations: [],
      },
    });
    await materializeFixtureHostOutput({
      repoRoot,
      projectRoot,
      fixtureId,
    });
    await applyScenarioMutations(projectRoot, scenario.mutations ?? []);
  } else {
    await applyFixtureScenario({
      repoRoot,
      projectRoot,
      fixtureId,
      scenarioId,
      updateSpecGenerationInputs,
      writeBlueprintReference,
    });
  }

  if ((scenario.apply_canonical ?? fixture.canonical.include_by_default) || scenario.materialization_mode === "host_output_plan") {
    await markCanonicalTreeReady(projectRoot);
  }

  return { fixture, scenario };
}

async function runSpecReconstructionFixtureLoop(fixtureId, scenarioId) {
  return withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const fixture = await loadFixtureManifest(repoRoot, fixtureId);
    const scenario = fixture.scenarios.find((entry) => entry.id === scenarioId);
    assert.ok(scenario, `Unknown fixture scenario '${scenarioId}'`);

    if (scenario.pre_handoff_scenario) {
      await applyFixtureScenario({
        repoRoot,
        projectRoot,
        fixtureId,
        scenarioId: scenario.pre_handoff_scenario,
        updateSpecGenerationInputs,
        writeBlueprintReference,
      });
    } else {
      await applyFixtureScenario({
        repoRoot,
        projectRoot,
        fixtureId,
        scenarioId,
        updateSpecGenerationInputs,
        writeBlueprintReference,
        scenarioOverrides: {
          apply_canonical: false,
          mutations: [],
        },
      });
    }

    const handoffResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--json"]);
    assert.equal(handoffResult.exitCode, 0);
    const handoffPayload = JSON.parse(handoffResult.stdout);

    await materializeFixtureScenario(projectRoot, fixtureId, scenarioId);

    const importPayload = await buildSpecReconstructionCloseoutImport(projectRoot);
    const importPath = path.join(projectRoot, `${fixture.id}-${scenario.id}.closeout.json`);
    await writeFile(importPath, `${JSON.stringify(importPayload, null, 2)}\n`, "utf8");

    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      importPath,
      "--write-local",
      "--json",
    ]);
    const closeoutPayload = JSON.parse(closeoutResult.stdout);

    const treeValidationResult = await runCliSubprocess(["validate-spec-tree"], { cwd: projectRoot });
    const treeValidationPayload = JSON.parse(treeValidationResult.stdout);
    const specAuditResult = await runCliSubprocess(["validate-spec-audit"], { cwd: projectRoot });
    const specAuditPayload = JSON.parse(specAuditResult.stdout);

    let blueprintAuditResult = null;
    let blueprintAuditPayload = null;
    if (scenario.expected.blueprint_audit !== "skip") {
      blueprintAuditResult = await captureRunCli(["blueprint-audit", "--json"]);
      blueprintAuditPayload = JSON.parse(blueprintAuditResult.stdout);
    }

    return {
      projectRoot,
      fixture,
      scenario,
      handoffPayload,
      treeValidationResult,
      treeValidationPayload,
      specAuditResult,
      specAuditPayload,
      closeoutResult,
      closeoutPayload,
      blueprintAuditResult,
      blueprintAuditPayload,
    };
  });
}

test("validate-spec-governance dispatches host-configured commands", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-governance", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi-realm",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {
          "single-source": ["node -e \"process.stdout.write('single-source-ok\\\\n')\""],
        },
        generate_commands: {},
      },
      ai_governance: {
        agents_freshness: {
          targets: [],
          required_sections: [],
          stale_tokens: [],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "validate-spec-governance",
      "--profile",
      "nimi-realm",
      "--scope",
      "single-source",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /single-source-ok/);
  });
});

test("validate-spec-governance supports host-defined scopes via --scope all", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-governance-all", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {
          "runtime-consistency": ["node -e \"process.stdout.write('runtime-ok\\\\n')\""],
          "sdk-consistency": ["node -e \"process.stdout.write('sdk-ok\\\\n')\""],
        },
        generate_commands: {
          runtime: ["node -e \"process.stdout.write('generate-runtime\\\\n')\""],
        },
      },
      ai_governance: {
        agents_freshness: {
          targets: [],
          required_sections: [],
          stale_tokens: [],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "validate-spec-governance",
      "--profile",
      "nimi",
      "--scope",
      "all",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /runtime-ok/);
    assert.match(result.stdout, /sdk-ok/);
  });
});

test("generate-spec-derived-docs supports host-defined scopes and --check", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-generate-governance", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {},
        generate_commands: {
          "spec-human-doc": ["node -e \"process.stdout.write(process.argv.includes('--check') ? 'human-check\\\\n' : 'human-generate\\\\n')\" --"],
        },
      },
      ai_governance: {
        agents_freshness: {
          targets: [],
          required_sections: [],
          stale_tokens: [],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "generate-spec-derived-docs",
      "--profile",
      "nimi",
      "--scope",
      "spec-human-doc",
      "--check",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /human-check/);
  });
});

test("validate-ai-governance uses host-configured agents freshness targets", async () => {
  await withTempProject(async (projectRoot) => {
    await writeFile(
      path.join(projectRoot, "package.json"),
      JSON.stringify({ name: "temp-ai-governance", private: true, scripts: {} }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "AGENTS.md"),
      [
        "# Test",
        "",
        "## Scope",
        "ok",
        "",
        "## Hard Boundaries",
        "ok",
        "",
        "## Retrieval Defaults",
        "ok",
        "",
        "## Verification Commands",
        "ok",
      ].join("\n"),
      "utf8",
    );
    await writeGovernanceConfig(projectRoot, {
      profile_id: "nimi-realm",
      spec_governance: {
        canonical_root: ".nimi/spec",
        validate_commands: {},
        generate_commands: {},
      },
      ai_governance: {
        agents_freshness: {
          targets: [{ rel: "AGENTS.md", max_lines: 50 }],
          required_sections: [
            "## Scope",
            "## Hard Boundaries",
            "## Retrieval Defaults",
            "## Verification Commands",
          ],
          stale_tokens: ["AISC-"],
        },
        context_budget: {
          version: 1,
          default_profile: "production",
          profiles: { production: {} },
          classifiers: {},
          exclude: [],
          waivers: [],
        },
        structure_budget: {
          version: 1,
          allowed_forwarding_shells: ["index.ts"],
          rules: [{ id: "noop", include: ["missing/**"], depth_base: "missing", warning_depth: 5, error_depth: 7 }],
          exclude: ["**"],
          waivers: [],
        },
        high_risk_doc_metadata: {
          doc_roots: [".local"],
          exempt_paths: [],
          name_patterns: ["design"],
          required_metadata_keys: ["Spec Status"],
        },
      },
    });

    const result = await captureRunCli([
      "validate-ai-governance",
      "--profile",
      "nimi-realm",
      "--scope",
      "agents-freshness",
    ]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /agents freshness check passed/);
  });
});

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

    const bootstrapState = await readFile(
      path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"),
      "utf8",
    );
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
    const hostAdapter = await readFile(
      path.join(projectRoot, ".nimi", "config", "host-adapter.yaml"),
      "utf8",
    );
    const externalExecutionArtifacts = await readFile(
      path.join(projectRoot, ".nimi", "config", "external-execution-artifacts.yaml"),
      "utf8",
    );
    const productScope = await readFile(
      path.join(projectRoot, ".nimi", "spec", "product-scope.yaml"),
      "utf8",
    );
    const specTreeModel = await readFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "spec-tree-model.yaml"),
      "utf8",
    );
    const commandGatingMatrix = await readFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "command-gating-matrix.yaml"),
      "utf8",
    );
    const generateDriftChecklist = await readFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "generate-drift-migration-checklist.yaml"),
      "utf8",
    );
    const governanceRoutingChecklist = await readFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "governance-routing-cutover-checklist.yaml"),
      "utf8",
    );
    const impactedSurfaceMatrix = await readFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "phase2-impacted-surface-matrix.yaml"),
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
    const hostCompatibilityContract = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "external-host-compatibility.yaml"),
      "utf8",
    );
    const executionPacketSchema = await readFile(
      path.join(projectRoot, ".nimi", "contracts", "execution-packet.schema.yaml"),
      "utf8",
    );
    const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
    const agents = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    const claude = await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
    const handoffJson = await readFile(path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.json"), "utf8");
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "methodology", "spec-target-truth-profile.yaml"), "utf8"));
    assert.match(bootstrapState, /ready_for_ai_reconstruction: true/);
    assert.match(bootstrapConfig, /initialized_by: "@nimiplatform\/nimi-coding"/);
    assert.match(bootstrapConfig, /bootstrap_contract: "nimicoding.bootstrap"/);
    assert.match(bootstrapConfig, /bootstrap_contract_version: 1/);
    assert.match(specGenerationInputs, /mode: mixed/);
    assert.match(specGenerationInputs, /canonical_target_root: \.nimi\/spec/);
    assert.match(specGenerationInputs, /benchmark_mode: none/);
    assert.doesNotMatch(coreYaml, /cli_runtime/);
    assert.match(hostAdapter, /selected_adapter_id: none/);
    assert.match(hostAdapter, /- oh_my_codex/);
    assert.match(hostAdapter, /artifact_contract_ref: \.nimi\/config\/external-execution-artifacts\.yaml/);
    assert.match(externalExecutionArtifacts, /packet_ref: \.nimi\/local\/packets/);
    assert.match(externalExecutionArtifacts, /worker_output_ref: \.nimi\/local\/outputs/);
    assert.match(productScope, /canonical_spec_root: "\.nimi\/spec"/);
    assert.match(productScope, /phase_one_posture: contract_and_checklist_only/);
    assert.match(productScope, /phase_one_contracts:/);
    assert.match(productScope, /blocked_until_phase_two:/);
    assert.match(productScope, /high_risk_admissions_truth: \.nimi\/spec\/high-risk-admissions\.yaml/);
    assert.match(productScope, /profile: boundary_complete/);
    assert.match(productScope, /completed_surfaces:/);
    assert.match(productScope, /deferred_execution_surfaces:/);
    assert.match(productScope, /packet_bound_run_kernel/);
    assert.match(specTreeModel, /canonical_root: \.nimi\/spec/);
    assert.match(commandGatingMatrix, /command_gating_matrix:/);
    assert.match(generateDriftChecklist, /generate_drift_migration_checklist:/);
    assert.match(governanceRoutingChecklist, /governance_routing_cutover_checklist:/);
    assert.match(impactedSurfaceMatrix, /phase2_impacted_surface_matrix:/);
    assert.match(agents, /nimicoding:managed:agents:start/);
    assert.match(claude, /nimicoding:managed:claude:start/);
    assert.match(agents, /AI-context-efficient/);
    assert.match(claude, /AI-context-efficient/);
    assert.match(handoffJson, /"skill":/);
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.prompt.md"), "utf8"));
    assert.match(result.stdout, /4\. Paste Prompt/);
    assert.match(result.stdout, /\.nimi\/local\/handoff\/spec_reconstruction\.json/);
    assert.doesNotMatch(handoffJson, /spec-target-truth-profile/);
    assert.match(exchangeProjection, /exchange_surfaces:/);
    assert.match(exchangeProjection, /contractVersion/);
    assert.match(exchangeProjection, /- handoff/);
    assert.match(exchangeProjection, /- closeout/);
    assert.match(specReconstructionContract, /canonical_tree_completion:/);
    assert.match(specReconstructionContract, /required_tree_state: canonical_tree_ready/);
    assert.match(highRiskExecutionContract, /delegated_high_risk_execution_result/);
    assert.match(highRiskExecutionContract, /candidate_ready/);
    assert.match(highRiskAdmissionContract, /canonical_high_risk_admissions_truth/);
    assert.match(highRiskAdmissionContract, /source_decision_contract/);
    assert.match(specGenerationInputsContract, /canonical_spec_generation_inputs/);
    assert.match(specGenerationInputsContract, /acceptance_mode_enum:/);
    assert.match(specGenerationAuditContract, /canonical_spec_generation_audit/);
    assert.match(specGenerationAuditContract, /required_file_entry_fields:/);
    assert.match(hostCompatibilityContract, /external_host_boundary_compatibility/);
    assert.match(hostCompatibilityContract, /supported_host_posture:/);
    assert.match(hostCompatibilityContract, /host_agnostic_external_host/);
    assert.match(hostCompatibilityContract, /consume_handoff_json_as_authoritative_contract/);
    assert.match(executionPacketSchema, /kind: execution-packet/);
    assert.match(executionPacketSchema, /phase_required:/);
    assert.match(gitignore, /\.nimi\/local\//);
    assert.match(gitignore, /\.nimi\/cache\//);
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

test("start projects canonical spec meta contracts and checklists as valid yaml", async () => {
  await withTempProject(async (projectRoot) => {
    const result = await captureRunCli(["start"]);
    assert.equal(result.exitCode, 0);

    const specTreeModel = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-tree-model.yaml"));
    const bootstrapState = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"));
    const productScope = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "product-scope.yaml"));
    const specGenerationInputs = await readYamlFile(path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml"));
    const commandGatingMatrix = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "_meta", "command-gating-matrix.yaml"));
    const generateDriftChecklist = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "_meta", "generate-drift-migration-checklist.yaml"));
    const governanceRoutingChecklist = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "_meta", "governance-routing-cutover-checklist.yaml"));
    const cutoverReadiness = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-authority-cutover-readiness.yaml"));
    const impactedSurfaceMatrix = await readYamlFile(path.join(projectRoot, ".nimi", "spec", "_meta", "phase2-impacted-surface-matrix.yaml"));

    assert.equal(specTreeModel.spec_tree_model.profile, "minimal");
    assert.equal(specTreeModel.spec_tree_model.canonical_root, ".nimi/spec");
    assert.equal(specTreeModel.spec_tree_model.blueprint_source, undefined);
    assert.equal(bootstrapState.state.tree_state, "bootstrap_only");
    assert.equal(bootstrapState.state.authority_mode, "external_authority_active");
    assert.equal(specGenerationInputs.spec_generation_inputs.mode, "mixed");
    assert.equal(specGenerationInputs.spec_generation_inputs.benchmark_mode, "none");
    assert.ok(!bootstrapState.current_truth.admitted_files.includes(".nimi/methodology/spec-target-truth-profile.yaml"));
    assert.equal(productScope.canonical_spec_model.state_carrier_ref, ".nimi/spec/bootstrap-state.yaml");
    assert.equal(productScope.canonical_spec_model.phase_one_contracts[2], ".nimi/spec/_meta/spec-authority-cutover-readiness.yaml");
    assert.equal(commandGatingMatrix.command_gating_matrix[0].command, "start");
    assert.ok(commandGatingMatrix.command_gating_matrix.some((entry) => entry.command === "handoff" && entry.skill === "high_risk_execution"));
    assert.ok(commandGatingMatrix.command_gating_matrix.some((entry) => entry.command === "closeout" && entry.skill === "high_risk_execution"));
    assert.equal(cutoverReadiness.spec_authority_cutover_readiness.gate_families[0].id, "canonical_generation_gate");
    assert.equal(
      generateDriftChecklist.generate_drift_migration_checklist.entries[0].command,
      "pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope runtime",
    );
    assert.equal(governanceRoutingChecklist.governance_routing_cutover_checklist.entries[0].file, "CLAUDE.md");
    assert.equal(impactedSurfaceMatrix.phase2_impacted_surface_matrix[0].surface, "start_command");
    await assert.rejects(readFile(path.join(projectRoot, ".nimi", "spec", "_meta", "blueprint-reference.yaml"), "utf8"));
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

    const handoffJson = await readFile(path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.json"), "utf8");
    assert.match(handoffJson, /"skill":/);
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

test("start restores missing bootstrap seed files without overwriting existing truth and pauses on blocking drift", async () => {
  await withTempProject(async (projectRoot) => {
    await mkdir(path.join(projectRoot, ".nimi", "spec"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml"),
      "sentinel: preserved\n",
      "utf8",
    );

    const result = await captureRunCli(["start"]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /nimicoding start paused/);
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
    assert.match(result.stdout, /bootstrap-state\.yaml is missing required lifecycle fields/);
  });
});

test("doctor validates a freshly started bootstrap", async () => {
  await withTempProject(async () => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const doctorResult = await captureRunCli(["doctor"]);

    assert.equal(doctorResult.exitCode, 0);
    assert.match(doctorResult.stdout, /status: ok/);
    assert.match(doctorResult.stdout, /project rules: incomplete/);
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
    assert.equal(payload.reconstructionRequired, true);
    assert.equal(payload.runtimeInstalled, false);
    assert.equal(payload.handoffReadiness.ok, true);
    assert.equal(payload.specGenerationInputs.mode, "mixed");
    assert.equal(payload.specGenerationInputs.benchmarkMode, "none");
    assert.equal(payload.benchmarkAuditReadiness.available, false);
    assert.equal(payload.benchmarkAuditReadiness.ready, false);
    assert.equal(payload.bootstrapContract.status, "supported");
    assert.equal(payload.completionProfile, "boundary_complete");
    assert.equal(payload.completionStatus, "complete");
    assert.equal(payload.hostCompatibility.contractRef, ".nimi/contracts/external-host-compatibility.yaml");
    assert.deepEqual(payload.hostCompatibility.supportedHostPosture, ["host_agnostic_external_host"]);
    assert.deepEqual(payload.hostCompatibility.supportedHostExamples, ["oh_my_codex", "codex", "claude", "gemini"]);
    assert.ok(payload.hostCompatibility.requiredBehavior.includes("consume_handoff_json_as_authoritative_contract"));
    assert.ok(payload.hostCompatibility.forbiddenBehavior.includes("assume_packaged_run_kernel"));
    assert.equal(payload.hostCompatibility.genericExternalHostCompatible, true);
    assert.equal(payload.hostCompatibility.namedOverlaySupport.mode, "named_admitted_overlay_available");
    assert.deepEqual(payload.hostCompatibility.namedOverlaySupport.admittedOverlayIds, ["oh_my_codex"]);
    assert.equal(payload.hostCompatibility.namedOverlaySupport.selectedOverlayId, null);
    assert.deepEqual(payload.hostCompatibility.futureOnlyHostSurfaces, [
      {
        adapterId: "oh_my_codex",
        status: "future_only_not_packaged",
        command: "nimicoding run-next-prompt",
      },
    ]);
    assert.deepEqual(payload.completedSurfaces, [
      "bootstrap",
      "doctor",
      "handoff",
      "validators",
      "topic_lifecycle_report_methodology",
      "closeout",
      "ingest",
      "review",
      "decision",
      "admission",
      "host_overlay_recognition",
    ]);
    assert.deepEqual(payload.deferredExecutionSurfaces, [
      "packet_bound_run_kernel",
      "provider_backed_execution",
      "scheduler",
      "notification",
      "automation_backend",
      "multi_topic_orchestration",
    ]);
    assert.deepEqual(payload.promotedParityGapSummary, [
      "packet_bound_run_kernel",
      "provider_backed_execution",
      "scheduler_automation_notification",
    ]);
    assert.match(JSON.stringify(payload.checks), /Packaged external host compatibility contract is present and aligned/);
    assert.equal(payload.delegatedContracts.runtimeOwner, "external_ai_host");
    assert.equal(payload.delegatedContracts.executionMode, "delegated");
    assert.equal(payload.delegatedContracts.selectedAdapterId, "none");
    assert.deepEqual(payload.delegatedContracts.admittedAdapterIds, ["oh_my_codex"]);
    assert.equal(payload.delegatedContracts.adapterHandoffMode, "prompt_output_evidence_handoff");
    assert.equal(payload.delegatedContracts.semanticReviewOwner, "nimicoding_manager");
    assert.equal(payload.adapterProfiles.admitted.length, 1);
    assert.equal(payload.adapterProfiles.invalid.length, 0);
    assert.equal(payload.adapterProfiles.admitted[0].id, "oh_my_codex");
    assert.equal(payload.adapterProfiles.admitted[0].profileRef, "adapters/oh-my-codex/profile.yaml");
    assert.equal(payload.adapterProfiles.admitted[0].hostClass, "external_execution_host");
    assert.equal(payload.adapterProfiles.admitted[0].promptHandoff.futureSurfaceStatus, "future_only_not_packaged");
    assert.deepEqual(payload.adapterProfiles.admitted[0].promptHandoff.futureSurface, ["nimicoding run-next-prompt"]);
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
    assert.equal(payload.specGenerationInputs.acceptanceMode, "canonical_tree_validity_without_blueprint");
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

    await mkdir(path.join(projectRoot, ".nimi", "spec", "_meta"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "blueprint-reference.yaml"),
      YAML.stringify({
        version: 1,
        blueprint_reference: {
          mode: "repo_spec_blueprint",
          root: "spec",
          canonical_target_root: ".nimi/spec",
          equivalence_contract_ref:
            ".nimi/local/report/closed/2026-04-11-nimicoding-canonical-spec-model-redesign/design.md",
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
    await writeFile(path.join(projectRoot, "spec", "project", "kernel", "tables", "rule-catalog.yaml"), "rules: []\n", "utf8");
    await writeFile(path.join(projectRoot, ".nimi", "spec", "project", "kernel", "tables", "rule-catalog.yaml"), "rules: []\n", "utf8");

    const auditResult = await captureRunCli(["blueprint-audit", "--json", "--write-local"]);

    assert.equal(auditResult.exitCode, 0);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.blueprintRoot, "spec");
    assert.equal(payload.specGenerationInputs.acceptanceMode, "canonical_tree_validity_without_blueprint");
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
        ".nimi/local/report/nimicoding-canonical-spec-model-redesign-2026-04-11.md",
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

    await mkdir(path.join(projectRoot, ".nimi", "spec", "_meta"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "blueprint-reference.yaml"),
      YAML.stringify({
        version: 1,
        blueprint_reference: {
          mode: "repo_spec_blueprint",
          root: "spec",
          canonical_target_root: ".nimi/spec",
          equivalence_contract_ref: ".nimi/local/report/nimicoding-canonical-spec-model-redesign-2026-04-11.md",
        },
      }),
      "utf8",
    );

    const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
    const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
    bootstrapState.state.blueprint_mode = "repo_spec_blueprint";
    await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");

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

    await mkdir(path.join(projectRoot, ".nimi", "spec", "_meta"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "blueprint-reference.yaml"),
      YAML.stringify({
        version: 1,
        blueprint_reference: {
          mode: "repo_spec_blueprint",
          root: "spec",
          canonical_target_root: ".nimi/spec",
          equivalence_contract_ref:
            ".nimi/local/report/closed/2026-04-11-nimicoding-canonical-spec-model-redesign/design.md",
        },
      }),
      "utf8",
    );

    const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
    const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
    bootstrapState.state.blueprint_mode = "repo_spec_blueprint";
    await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");

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
        ".nimi/local/report/proposal/2026-04-14-runtime-speech/design.md",
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
        ".nimi/local/report/pending/2026-04-14-runtime-speech/design.md",
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
        ".nimi/local/report/2026-04-14-runtime-speech-design.md",
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
    assert.equal(payload.specGenerationInputs.mode, "mixed");
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

test("blueprint-audit fails dual-domain benchmark acceptance when a generated view is missing", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await materializeFixtureScenario(projectRoot, "dual-domain-benchmark", "missing_generated_view");

    const auditResult = await captureRunCli(["blueprint-audit", "--json"]);

    assert.equal(auditResult.exitCode, 1);
    const payload = JSON.parse(auditResult.stdout);
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.derivedViewGaps.missingKernelGenerated, [
      "desktop/kernel/generated/overview.md",
    ]);
    assert.match(
      JSON.stringify(payload.nextSteps),
      /Regenerate derived kernel docs after canonical blueprint content is built out/,
    );
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
    assert.deepEqual(payload.generationContext.docsRoots, ["docs"]);
    assert.deepEqual(payload.generationContext.structureRoots, ["src", "docs"]);
    assert.deepEqual(payload.generationContext.humanNotePaths, [".nimi/local/notes/reconstruction-note.md"]);
    assert.equal(payload.generationContext.benchmarkBlueprintRoot, "spec");
    assert.equal(payload.generationContext.benchmarkMode, "repo_spec_blueprint");
    assert.equal(payload.generationContext.acceptanceMode, "semantic_and_structural_parity_when_blueprint_exists");
    assert.deepEqual(payload.generationContext.minimumGenerationSequence, [
      ".nimi/spec/INDEX.md",
      ".nimi/spec/project/kernel/index.md",
      ".nimi/spec/project/kernel/core-rules.md",
      ".nimi/spec/project/kernel/tables/rule-catalog.yaml",
    ]);
    assert.ok(payload.generationContext.skeletonRules.includes("generate_minimal_kernel_before_optional_guides_and_generated_views"));

    const promptResult = await captureRunCli(["handoff", "--skill", "spec_reconstruction", "--prompt"]);
    assert.equal(promptResult.exitCode, 0);
    const promptText = await readFile(
      path.join(projectRoot, ".nimi", "local", "handoff", "spec_reconstruction.prompt.md"),
      "utf8",
    );
    assert.match(promptText, /Benchmark blueprint root: spec/);
    assert.match(promptText, /Code roots: src/);
    assert.match(promptText, /Docs roots: docs/);
    assert.match(promptText, /Human note paths: \.nimi\/local\/notes\/reconstruction-note\.md/);
    assert.match(promptText, /aim for semantic and structural parity/i);
    assert.match(promptText, /minimum generation sequence/i);
    assert.match(promptText, /\.nimi\/spec\/project\/kernel\/core-rules\.md/);
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
  assert.equal(result.closeoutPayload.summary.audit_ref, ".nimi/spec/_meta/spec-generation-audit.yaml");
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

test("fixture loop fails benchmark acceptance when a generated view is missing", async () => {
  const result = await runSpecReconstructionFixtureLoop("dual-domain-benchmark", "missing_generated_view");

  assert.equal(result.treeValidationResult.exitCode, 0);
  assert.equal(result.specAuditResult.exitCode, 1);
  assert.equal(result.closeoutResult.exitCode, 1);
  assert.equal(result.closeoutPayload.ok, false);
  assert.match(result.closeoutPayload.readiness.reason, /spec-generation-audit/i);
  assert.equal(result.blueprintAuditResult.exitCode, 1);
  assert.equal(result.blueprintAuditPayload.ok, false);
  assert.deepEqual(
    result.blueprintAuditPayload.derivedViewGaps.missingKernelGenerated,
    ["desktop/kernel/generated/overview.md"],
  );
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

test("doctor fails closed when standalone completion truth drifts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const productScopePath = path.join(projectRoot, ".nimi", "spec", "product-scope.yaml");
    const productScopeText = await readFile(productScopePath, "utf8");
    await writeFile(
      productScopePath,
      productScopeText.replace("profile: boundary_complete", "profile: promoted_runtime_parity"),
      "utf8",
    );

    const doctorResult = await captureRunCli(["doctor", "--json"]);

    assert.equal(doctorResult.exitCode, 1);
    const payload = JSON.parse(doctorResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.completionStatus, "drifted");
    assert.match(
      JSON.stringify(payload.checks),
      /product-scope\.yaml is missing or drifted from the package-owned standalone completion truth/,
    );
  });
});

test("doctor fails closed when canonical-tree-ready state loses the generation audit artifact", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await seedReconstructedTargetTruth(projectRoot);
    await rm(path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml"), { force: true });

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
    assert.equal(payload.generationContext.mode, "mixed");
    assert.deepEqual(payload.generationContext.requiredFileClasses, [
      "INDEX.md",
      "domain kernel/*.md",
      "domain kernel/tables/**",
    ]);
    assert.equal(payload.generationContext.benchmarkBlueprintRoot, null);
    assert.equal(payload.generationContext.acceptanceMode, "canonical_tree_validity_without_blueprint");
    assert.equal(payload.generationContext.auditRef, ".nimi/spec/_meta/spec-generation-audit.yaml");
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
    assert.deepEqual(payload.handoffSurface.hostCompatibilitySummary.namedOverlaySupport.admittedOverlayIds, ["oh_my_codex"]);
    assert.deepEqual(payload.handoffSurface.hostCompatibilitySummary.futureOnlyHostSurfaces, [
      {
        adapterId: "oh_my_codex",
        status: "future_only_not_packaged",
        command: "nimicoding run-next-prompt",
      },
    ]);
    assert.equal(payload.adapter.selectedId, "none");
    assert.deepEqual(payload.adapter.admittedIds, ["oh_my_codex"]);
    assert.equal(payload.adapter.semanticReviewOwner, "nimicoding_manager");
    assert.equal(payload.contracts.hostAdapterRef, ".nimi/config/host-adapter.yaml");
    assert.equal(
      payload.contracts.exchangeProjectionContractRef,
      ".nimi/methodology/skill-exchange-projection.yaml",
    );
    assert.match(payload.nextAction, /Delegate explicit skill execution/);
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
    assert.match(promptText, /Admitted named overlays: oh_my_codex/);
    assert.match(promptText, /Future-only host surfaces: oh_my_codex:nimicoding run-next-prompt:future_only_not_packaged/);
    assert.match(promptText, /You are the external AI host responsible/);
    assert.match(promptText, /Read this project-local truth first, in order:/);
    assert.match(promptText, /Do not assume local skill installation or self-hosting/);
    assert.match(promptText, /Canonical target root: \.nimi\/spec/);
    assert.match(promptText, /Audit output: \.nimi\/spec\/_meta\/spec-generation-audit\.yaml/);
    assert.match(promptText, /Write `\.nimi\/spec\/_meta\/spec-generation-audit\.yaml` alongside the canonical tree/);
    assert.match(promptText, /Required file classes: INDEX\.md, domain kernel\/\*\.md, domain kernel\/tables\/\*\*/);
    assert.match(promptText, /Minimum generation sequence: \.nimi\/spec\/INDEX\.md, \.nimi\/spec\/project\/kernel\/index\.md/);
    assert.match(promptText, /Code roots: none/);
    assert.match(promptText, /Docs roots: README\.md/);
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
  await assert.doesNotReject(readFile(path.join(repoRoot, "config", "spec-generation-inputs.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(repoRoot, "contracts", "spec-generation-inputs.schema.yaml"), "utf8"));
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
