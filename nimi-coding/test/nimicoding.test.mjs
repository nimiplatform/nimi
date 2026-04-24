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
import { runNativeCodexSdkPrompt } from "../cli/lib/codex-sdk-runner.mjs";
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

test("native Codex adapter dispatches through the Codex SDK boundary", async () => {
  const calls = [];
  const fakeCodex = {
    startThread() {
      calls.push(["startThread"]);
      return {
        id: "thread-started",
        async run(prompt) {
          calls.push(["run", prompt]);
          return { final_response: "started" };
        },
      };
    },
    resumeThread(threadId) {
      calls.push(["resumeThread", threadId]);
      return {
        id: threadId,
        async run(prompt) {
          calls.push(["run", prompt]);
          return { finalResponse: "resumed" };
        },
      };
    },
  };

  const started = await runNativeCodexSdkPrompt({
    codex: fakeCodex,
    prompt: "execute admitted topic step",
  });
  assert.equal(started.ok, true);
  assert.equal(started.adapterId, "codex");
  assert.equal(started.sdkPackage, "@openai/codex-sdk");
  assert.equal(started.mode, "start_thread");
  assert.equal(started.threadId, "thread-started");
  assert.equal(started.finalResponse, "started");

  const resumed = await runNativeCodexSdkPrompt({
    codex: fakeCodex,
    threadId: "thread-existing",
    prompt: "continue admitted topic step",
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.mode, "resume_thread");
  assert.equal(resumed.threadId, "thread-existing");
  assert.equal(resumed.finalResponse, "resumed");
  assert.deepEqual(calls, [
    ["startThread"],
    ["run", "execute admitted topic step"],
    ["resumeThread", "thread-existing"],
    ["run", "continue admitted topic step"],
  ]);

  const refused = await runNativeCodexSdkPrompt({ codex: fakeCodex, prompt: "" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /prompt must be a non-empty string/);
});

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
          ".nimi/topics/closed/2026-04-11-nimicoding-canonical-spec-model-redesign/design.md",
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

test("topic create scaffolds an enriched proposal topic and status/validate succeed", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "wave-one-demo",
      "--title",
      "Wave One Demo",
      "--justification",
      "authority-bearing redesign line",
      "--applicability",
      "authority-bearing",
      "--json",
    ]);

    assert.equal(createResult.exitCode, 0);
    const createPayload = JSON.parse(createResult.stdout);
    assert.equal(createPayload.ok, true);
    assert.equal(createPayload.command, "topic.create");
    assert.match(createPayload.topicRef, /^\.nimi\/topics\/proposal\/\d{4}-\d{2}-\d{2}-wave-one-demo$/);

    const topicDir = path.join(projectRoot, createPayload.topicRef);
    const topicYaml = await readFile(path.join(topicDir, "topic.yaml"), "utf8");
    assert.match(topicYaml, /title: Wave One Demo/);
    assert.match(topicYaml, /mode: greenfield/);
    assert.match(topicYaml, /posture: no_legacy_hard_cut/);
    assert.match(topicYaml, /applicability: authority_bearing/);
    assert.match(topicYaml, /execution_mode: manager_worker_auditor/);
    await assert.doesNotReject(readFile(path.join(topicDir, "README.md"), "utf8"));
    await assert.doesNotReject(readFile(path.join(topicDir, "design.md"), "utf8"));
    await assert.doesNotReject(readFile(path.join(topicDir, "preflight.md"), "utf8"));
    await assert.doesNotReject(readFile(path.join(topicDir, "waves.md"), "utf8"));

    const statusResult = await captureRunCli([
      "topic",
      "status",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(statusResult.exitCode, 0);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.equal(statusPayload.ok, true);
    assert.equal(statusPayload.command, "topic.status");
    assert.equal(statusPayload.schemaMode, "enriched");
    assert.equal(statusPayload.state, "proposal");
    assert.equal(statusPayload.selectedNextTarget, "topic_design_baseline");
    assert.equal(statusPayload.currentTrueCloseStatus, "not_started");

    const validateResult = await captureRunCli([
      "topic",
      "validate",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
    assert.equal(validatePayload.command, "topic.validate");
    assert.equal(validatePayload.schemaMode, "enriched");
    assert.deepEqual(validatePayload.warnings, []);

    const previousCwd = process.cwd();
    try {
      process.chdir(topicDir);
      const nestedStatusResult = await captureRunCli([
        "topic",
        "status",
        "--json",
      ]);
      assert.equal(nestedStatusResult.exitCode, 0);
      const nestedStatusPayload = JSON.parse(nestedStatusResult.stdout);
      assert.equal(nestedStatusPayload.ok, true);
      assert.equal(nestedStatusPayload.topicId, createPayload.topicId);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

test("topic status accepts a legacy minimal topic root and reports schema mode explicitly", async () => {
  await withTempProject(async (projectRoot) => {
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", "2026-04-23-legacy-minimal-topic");
    await mkdir(topicDir, { recursive: true });
    await writeFile(
      path.join(topicDir, "topic.yaml"),
      YAML.stringify({
        topic_id: "2026-04-23-legacy-minimal-topic",
        state: "proposal",
        created_at: "2026-04-23",
        last_transition_at: "2026-04-23",
        last_transition_reason: "legacy_topic_root_seeded_for_status_test",
      }),
      "utf8",
    );
    await writeFile(path.join(topicDir, "README.md"), "# Legacy Minimal Topic\n", "utf8");
    await writeFile(path.join(topicDir, "design.md"), "# Design\n", "utf8");

    const statusResult = await captureRunCli([
      "topic",
      "status",
      "2026-04-23-legacy-minimal-topic",
      "--json",
    ]);

    assert.equal(statusResult.exitCode, 0);
    const payload = JSON.parse(statusResult.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.schemaMode, "legacy_minimal");
    assert.ok(payload.warnings.some((entry) => entry.includes("legacy minimal shape")));
  });
});

test("topic validate audits the real golden fixture and reports representability without auto-migrating it", async () => {
  const fixtureId = "2026-04-20-desktop-agent-live2d-companion-substrate";
  const result = await runCliSubprocess([
    "topic",
    "validate",
    fixtureId,
    "--json",
  ], { cwd: repoRoot });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.schemaMode, "legacy_minimal");
  assert.equal(payload.migrationPosture, "explicit_legacy_reconstruction_required");
  assert.equal(payload.validationDisposition, "report_only");
  assert.equal(payload.canonicalValidated, false);
  assert.equal(payload.ignoredByPolicy, true);
  assert.equal(payload.ignorePolicyReason, "historical_dense_topic_pre_machine_wave_registry");
  assert.ok(payload.artifactSummary.files > 50);
  assert.ok(payload.artifactSummary.packets > 10);
  assert.ok(payload.artifactSummary.results > 10);
  assert.equal(payload.featureFlags.decision_review_lineage, true);
  assert.equal(payload.featureFlags.remediation_lineage, true);
  assert.equal(payload.featureFlags.overflow_lineage, true);
  assert.equal(payload.featureFlags.true_close_lineage, true);
  assert.equal(payload.featureFlags.exec_pack_lineage, true);
  assert.ok(payload.legacyWaveIds.includes("wave-1"));
  assert.ok(payload.legacyWaveIds.includes("wave-6a"));
  assert.ok(Array.isArray(payload.legacyObservedWaves));
  const wave1 = payload.legacyObservedWaves.find((entry) => entry.wave_id === "wave-1");
  assert.ok(wave1);
  assert.equal(wave1.observed_lineage, "closed_lineage");
  assert.ok(wave1.packets > 0);
  assert.ok(wave1.closeouts > 0);
  const wave6a = payload.legacyObservedWaves.find((entry) => entry.wave_id === "wave-6a");
  assert.ok(wave6a);
  assert.ok(wave6a.results > 0);
});

test("topic validate fails closed on ambiguous lifecycle naming, active-wave closeout conflict, and premature true-close", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "validator-rail-demo",
      "--justification",
      "validator rail demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const topicDir = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId);
    await writeFile(path.join(topicDir, "result-bad.md"), "# bad result\n", "utf8");
    await writeFile(
      path.join(topicDir, "closeout-wave-1-foundation.md"),
      `---\n${YAML.stringify({
        closeout_id: "wave-1-foundation",
        topic_id: createPayload.topicId,
        scope: "wave",
        authority_closure: "closed",
        semantic_closure: "closed",
        consumer_closure: "closed",
        drift_resistance_closure: "closed",
        disposition: "complete",
      }).trimEnd()}\n---\n\n# bad closeout\n`,
      "utf8",
    );
    await writeFile(
      path.join(topicDir, "topic-true-close-audit.md"),
      `---\n${YAML.stringify({
        topic_id: createPayload.topicId,
        status: "passed",
      }).trimEnd()}\n---\n\n# premature true-close\n`,
      "utf8",
    );

    const validateResult = await captureRunCli([
      "topic",
      "validate",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 1);
    const payload = JSON.parse(validateResult.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((entry) => entry.id === "artifact_naming_unambiguous" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "no_active_wave_closeout_conflict" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "true_close_not_premature" && entry.ok === false));
  });
});

test("topic validate fails closed when topic root state evidence is malformed", async () => {
  await withTempProject(async (projectRoot) => {
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", "2026-04-23-malformed-topic");
    await mkdir(topicDir, { recursive: true });
    await writeFile(
      path.join(topicDir, "topic.yaml"),
      YAML.stringify({
        topic_id: "2026-04-23-malformed-topic",
        state: "ongoing",
        created_at: "2026-04-23",
        last_transition_at: "2026-04-23",
      }),
      "utf8",
    );

    const validateResult = await captureRunCli([
      "topic",
      "validate",
      "2026-04-23-malformed-topic",
      "--json",
    ]);

    assert.equal(validateResult.exitCode, 1);
    const payload = JSON.parse(validateResult.stdout);
    assert.equal(payload.ok, false);
    assert.equal(payload.schemaMode, "legacy_minimal");
    assert.ok(payload.checks.some((entry) => entry.id === "state_matches_root" && entry.ok === false));
    assert.ok(payload.checks.some((entry) => entry.id === "minimal_state_evidence" && entry.ok === false));
  });
});

test("topic wave add/select/admit and graph validation manage machine wave state", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "graph-demo",
      "--justification",
      "multi-wave authority-bearing line",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    const waveOneAdd = await captureRunCli([
      "topic",
      "wave",
      "add",
      createPayload.topicId,
      "wave-1-foundation",
      "foundation",
      "--goal",
      "close the foundation cut",
      "--owner-domain",
      "nimicoding/topic",
      "--json",
    ]);
    assert.equal(waveOneAdd.exitCode, 0);

    const waveTwoAdd = await captureRunCli([
      "topic",
      "wave",
      "add",
      createPayload.topicId,
      "wave-2-follow-on",
      "follow-on",
      "--goal",
      "close the dependent follow-on cut",
      "--owner-domain",
      "nimicoding/topic",
      "--dep",
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(waveTwoAdd.exitCode, 0);

    const selectResult = await captureRunCli([
      "topic",
      "wave",
      "select",
      createPayload.topicId,
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(selectResult.exitCode, 0);

    const graphResult = await captureRunCli([
      "topic",
      "validate",
      "graph",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(graphResult.exitCode, 0);
    const graphPayload = JSON.parse(graphResult.stdout);
    assert.equal(graphPayload.ok, true);
    assert.equal(graphPayload.command, "topic.validate.graph");
    assert.equal(graphPayload.waveCount, 2);

    const admitResult = await captureRunCli([
      "topic",
      "wave",
      "admit",
      createPayload.topicId,
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(admitResult.exitCode, 0);
    const admitPayload = JSON.parse(admitResult.stdout);
    assert.equal(admitPayload.ok, true);
    assert.equal(admitPayload.waveState, "preflight_admitted");
    assert.equal(admitPayload.state, "ongoing");

    const topicYamlPath = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId, "topic.yaml");
    const movedTopicYamlPath = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml");
    const activeTopicYamlPath = await readFile(movedTopicYamlPath, "utf8").then(() => movedTopicYamlPath).catch(() => topicYamlPath);
    const topicYaml = YAML.parse(await readFile(activeTopicYamlPath, "utf8"));
    const waveOne = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(waveOne.state, "preflight_admitted");
    assert.equal(topicYaml.selected_next_target, "wave-1-foundation");
  });
});

test("topic wave add fails closed on unresolved dependencies before mutating topic.yaml", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "graph-hardening-demo",
      "--justification",
      "graph hardening demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    const topicYamlPath = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId, "topic.yaml");

    const addResult = await captureRunCli([
      "topic",
      "wave",
      "add",
      createPayload.topicId,
      "wave-2-dependent",
      "dependent",
      "--goal",
      "close a missing dependency",
      "--owner-domain",
      "nimicoding/topic",
      "--dep",
      "wave-1-missing",
      "--json",
    ]);
    assert.equal(addResult.exitCode, 1);
    assert.match(addResult.stderr, /missing dependency refs/);

    const topicYaml = YAML.parse(await readFile(topicYamlPath, "utf8"));
    assert.deepEqual(topicYaml.waves, []);
  });
});

test("topic validate admission fails closed when upstream dependencies are not closed", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "admission-demo",
      "--justification",
      "multi-wave authority-bearing line",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-2-dependent", "dependent",
      "--goal", "close dependent", "--owner-domain", "nimicoding/topic", "--dep", "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-2-dependent", "--json",
    ]);

    const admissionResult = await captureRunCli([
      "topic",
      "validate",
      "admission",
      createPayload.topicId,
      "wave-2-dependent",
      "--json",
    ]);
    assert.equal(admissionResult.exitCode, 1);
    const payload = JSON.parse(admissionResult.stdout);
    assert.equal(payload.ok, false);
    assert.ok(payload.checks.some((entry) => entry.id === "upstream_dependencies_closed" && entry.ok === false));

    const topicYaml = YAML.parse(await readFile(path.join(topicDir, "topic.yaml"), "utf8"));
    topicYaml.waves = topicYaml.waves.map((entry) => (
      entry.wave_id === "wave-1-foundation"
        ? { ...entry, state: "closed" }
        : entry
    ));
    await writeFile(path.join(topicDir, "topic.yaml"), YAML.stringify(topicYaml), "utf8");

    const admissionPass = await captureRunCli([
      "topic",
      "validate",
      "admission",
      createPayload.topicId,
      "wave-2-dependent",
      "--json",
    ]);
    assert.equal(admissionPass.exitCode, 0);
    const passPayload = JSON.parse(admissionPass.stdout);
    assert.equal(passPayload.ok, true);
  });
});

test("topic packet freeze validates required fields and writes a frozen packet artifact", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "packet-freeze-demo",
      "--justification",
      "packet discipline demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);

    const draftPath = path.join(projectRoot, "draft-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["all required fields stay explicit"],
        negative_tests: ["missing required field fails closed"],
        reopen_conditions: ["owner-cut changes require new packet"],
      }),
      "utf8",
    );

    const freezeResult = await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);
    assert.equal(freezeResult.exitCode, 0);
    const freezePayload = JSON.parse(freezeResult.stdout);
    assert.equal(freezePayload.ok, true);
    assert.equal(freezePayload.status, "candidate");
    const packetText = await readFile(path.join(projectRoot, freezePayload.packetRef), "utf8");
    assert.match(packetText, /^---\n/);
    assert.match(packetText, /status: candidate/);

    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "broken-packet",
        topic_id: createPayload.topicId,
      }),
      "utf8",
    );
    const brokenFreeze = await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);
    assert.equal(brokenFreeze.exitCode, 1);
    assert.match(brokenFreeze.stderr, /missing required fields/);
  });
});

test("topic run-next-step emits gated decisions without mutating topic state", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "next-step-demo",
      "--justification",
      "next-step gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const admitDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(admitDecisionResult.exitCode, 0);
    const admitDecision = JSON.parse(admitDecisionResult.stdout).decision;
    assert.equal(admitDecision.stop_class, "require_human_confirmation");
    assert.equal(admitDecision.recommended_action, "admit_wave");
    assert.equal(admitDecision.requires_human_confirmation, true);

    const admitResult = await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    assert.equal(admitResult.exitCode, 0);

    const packetDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(packetDecisionResult.exitCode, 0);
    const packetDecision = JSON.parse(packetDecisionResult.stdout).decision;
    assert.equal(packetDecision.stop_class, "require_human_confirmation");
    assert.equal(packetDecision.recommended_action, "freeze_packet");

    const draftPath = path.join(projectRoot, "draft-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["all required fields stay explicit"],
        negative_tests: ["missing required field fails closed"],
        reopen_conditions: ["owner-cut changes require new packet"],
      }),
      "utf8",
    );
    const freezeResult = await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    assert.equal(freezeResult.exitCode, 0);

    const dispatchDecisionResult = await captureRunCli([
      "topic",
      "run-next-step",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(dispatchDecisionResult.exitCode, 0);
    const dispatchDecision = JSON.parse(dispatchDecisionResult.stdout).decision;
    assert.equal(dispatchDecision.stop_class, "continue");
    assert.equal(dispatchDecision.recommended_action, "dispatch_worker");
    assert.equal(dispatchDecision.requires_human_confirmation, false);

    const movedTopicYamlPath = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml");
    const topicYaml = YAML.parse(await readFile(movedTopicYamlPath, "utf8"));
    const wave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(wave.state, "preflight_admitted");
  });
});

test("topic run-ledger records append-only events and rebuilds the run projection", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "run-ledger-demo",
      "--justification",
      "run ledger demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    const initResult = await captureRunCli([
      "topic",
      "run-ledger",
      "init",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--json",
    ]);
    assert.equal(initResult.exitCode, 0);
    const initPayload = JSON.parse(initResult.stdout);
    assert.equal(initPayload.runStatus, "running");
    assert.equal(initPayload.eventCount, 0);

    const decisionRef = "decision-output.json";
    await writeFile(
      path.join(projectRoot, decisionRef),
      `${JSON.stringify({ stop_class: "require_human_confirmation", recommended_action: "admit_wave" }, null, 2)}\n`,
      "utf8",
    );

    const sourceRef = `${createPayload.topicRef}/topic.yaml`;
    const gateResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--event",
      "decision_emitted",
      "--stop-class",
      "require_human_confirmation",
      "--action",
      "admit_wave",
      "--source",
      sourceRef,
      "--summary",
      "manager admission gate emitted",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--artifact",
      `decision_ref=${decisionRef}`,
      "--json",
    ]);
    assert.equal(gateResult.exitCode, 0);
    const gatePayload = JSON.parse(gateResult.stdout);
    assert.equal(gatePayload.runStatus, "awaiting_human_confirmation");
    assert.equal(gatePayload.eventCount, 1);
    assert.equal(gatePayload.ledger.current_human_gate.recommended_action, "admit_wave");

    const resolvedResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--event",
      "human_gate_resolved",
      "--stop-class",
      "continue",
      "--action",
      "admit_wave",
      "--source",
      sourceRef,
      "--summary",
      "manager approved wave admission",
      "--verified-at",
      "2026-04-24T00:01:00Z",
      "--json",
    ]);
    assert.equal(resolvedResult.exitCode, 0);

    const buildResult = await captureRunCli([
      "topic",
      "run-ledger",
      "build",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--json",
    ]);
    assert.equal(buildResult.exitCode, 0);
    const buildPayload = JSON.parse(buildResult.stdout);
    assert.equal(buildPayload.runStatus, "running");
    assert.equal(buildPayload.eventCount, 2);
    assert.equal(buildPayload.ledger.current_human_gate, null);
    assert.deepEqual(buildPayload.ledger.event_refs, [
      "run-event-ralph-loop-demo-0001-decision_emitted.yaml",
      "run-event-ralph-loop-demo-0002-human_gate_resolved.yaml",
    ]);

    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, createPayload.topicRef, "run-ledger-ralph-loop-demo.yaml"),
      "utf8",
    ));
    assert.equal(ledger.kind, "topic-run-ledger");
    assert.equal(ledger.latest_decision_ref, decisionRef);

    await writeFile(path.join(projectRoot, "closeout-wave-1-foundation.md"), "# closeout\n", "utf8");
    const closeResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "ralph-loop-demo",
      "--event",
      "wave_closed",
      "--stop-class",
      "continue",
      "--action",
      "no_action",
      "--source",
      "closeout-wave-1-foundation.md",
      "--summary",
      "wave closure resolved closeout gate",
      "--verified-at",
      "2026-04-24T00:02:00Z",
      "--artifact",
      "closeout_ref=closeout-wave-1-foundation.md",
      "--json",
    ]);
    assert.equal(closeResult.exitCode, 0);
    const closePayload = JSON.parse(closeResult.stdout);
    assert.equal(closePayload.ledger.current_human_gate, null);
  });
});

test("topic run-ledger fails closed on invalid artifact lineage", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "run-ledger-invalid",
      "--justification",
      "run ledger invalid lineage",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic",
      "run-ledger",
      "init",
      createPayload.topicId,
      "--run-id",
      "invalid-lineage",
      "--json",
    ]);

    const recordResult = await captureRunCli([
      "topic",
      "run-ledger",
      "record",
      createPayload.topicId,
      "--run-id",
      "invalid-lineage",
      "--event",
      "decision_emitted",
      "--stop-class",
      "continue",
      "--action",
      "dispatch_worker",
      "--source",
      `${createPayload.topicRef}/topic.yaml`,
      "--summary",
      "invalid artifact ref",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--artifact",
      "packet_ref=missing-packet.md",
      "--json",
    ]);
    assert.equal(recordResult.exitCode, 1);
    assert.match(recordResult.stderr, /packet_ref does not resolve to a file/);
  });
});

test("topic-runner stops on human gates without executing placeholder commands", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-human-gate",
      "--justification",
      "runner human gate demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    const runnerResult = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "runner-human-gate",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 0);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.executed, false);
    assert.equal(payload.stopClass, "require_human_confirmation");
    assert.equal(payload.recommendedAction, "admit_wave");
    assert.match(payload.decision.next_command_ref, /<wave-id>/);
    assert.equal(payload.gate.reasonCode, "no_selected_next_target");
    assert.equal(payload.gate.recommendedAction, "admit_wave");
    assert.match(payload.gate.nextCommandRef, /<wave-id>/);

    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, createPayload.topicRef, "run-ledger-runner-human-gate.yaml"),
      "utf8",
    ));
    assert.equal(ledger.event_count, 1);
    assert.equal(ledger.current_human_gate.recommended_action, "admit_wave");
    assert.match(ledger.latest_decision_ref, /runner-decision-runner-human-gate-0001\.json/);
  });
});

test("topic-runner run records a runner_blocked event when the max-step circuit breaker opens", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-circuit-breaker",
      "--justification",
      "runner circuit breaker demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-runner", "runner",
      "--goal", "trip runner max step breaker", "--owner-domain", "nimicoding/topic-runner", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-runner", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-runner", "--json"]);

    const draftPath = path.join(projectRoot, "runner-breaker-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-runner",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-runner",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic-runner"],
        canonical_seams: ["runner circuit breaker"],
        forbidden_shortcuts: ["unbounded retry"],
        acceptance_invariants: ["max step exhaustion records runner_blocked"],
        negative_tests: ["max step exhaustion is not success"],
        reopen_conditions: ["runner needs hidden retry state"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json"]);

    const runnerResult = await captureRunCli([
      "topic-runner",
      "run",
      createPayload.topicId,
      "--run-id",
      "runner-circuit-breaker",
      "--adapter",
      "codex",
      "--max-steps",
      "1",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 1);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.runnerStatus, "blocked");
    assert.equal(payload.circuitBreaker.state, "open");
    assert.equal(payload.circuitBreaker.reason, "max_steps_exhausted");

    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, payload.topicRef, "run-ledger-runner-circuit-breaker.yaml"),
      "utf8",
    ));
    assert.equal(ledger.run_status, "blocked");
    assert.equal(ledger.event_count, 3);
    assert.deepEqual(ledger.event_refs, [
      "run-event-runner-circuit-breaker-0001-decision_emitted.yaml",
      "run-event-runner-circuit-breaker-0002-worker_dispatched.yaml",
      "run-event-runner-circuit-breaker-0003-runner_blocked.yaml",
    ]);
  });
});

test("topic-runner run executes mechanical dispatch and records run-ledger lineage", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-dispatch",
      "--justification",
      "runner dispatch demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-runner", "runner",
      "--goal", "dispatch via topic runner", "--owner-domain", "nimicoding/topic-runner", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-runner", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-runner", "--json"]);

    const draftPath = path.join(projectRoot, "runner-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-runner",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-runner",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic-runner"],
        canonical_seams: ["runner dispatch command"],
        forbidden_shortcuts: ["manual run-ledger primitive chain"],
        acceptance_invariants: ["topic-runner records decision and dispatch"],
        negative_tests: ["placeholder command is refused"],
        reopen_conditions: ["runner needs semantic ownership"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json"]);

    const runnerResult = await captureRunCli([
      "topic-runner",
      "run",
      createPayload.topicId,
      "--run-id",
      "runner-dispatch",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 0);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.mode, "run");
    assert.equal(payload.stepCount, 2);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.stopClass, "await_external_evidence");
    assert.equal(payload.steps[0].runnerStatus, "continued");
    assert.equal(payload.steps[0].dispatch.role, "worker");

    await readFile(path.join(projectRoot, payload.steps[0].dispatch.promptRef), "utf8");
    const ledger = YAML.parse(await readFile(
      path.join(projectRoot, payload.topicRef, "run-ledger-runner-dispatch.yaml"),
      "utf8",
    ));
    assert.equal(ledger.event_count, 3);
    assert.deepEqual(ledger.event_refs, [
      "run-event-runner-dispatch-0001-decision_emitted.yaml",
      "run-event-runner-dispatch-0002-worker_dispatched.yaml",
      "run-event-runner-dispatch-0003-decision_emitted.yaml",
    ]);
    assert.equal(ledger.latest_packet_ref, `${payload.topicRef}/packet-wave-1-runner.md`);
    assert.equal(ledger.latest_prompt_ref, `${payload.topicRef}/prompt-wave-1-runner-worker.md`);
    assert.equal(ledger.run_status, "awaiting_external_evidence");
  });
});

test("topic-runner completed stop does not true-close the topic", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "runner-completed-boundary",
      "--justification",
      "runner completed boundary demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-runner", "runner",
      "--goal", "prove runner completion is not true-close", "--owner-domain", "nimicoding/topic-runner", "--json",
    ]);
    await captureRunCli(["topic", "wave", "select", createPayload.topicId, "wave-1-runner", "--json"]);
    await captureRunCli(["topic", "wave", "admit", createPayload.topicId, "wave-1-runner", "--json"]);

    const draftPath = path.join(projectRoot, "runner-completed-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-runner",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-runner",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic-runner"],
        canonical_seams: ["runner completed stop is operational only"],
        forbidden_shortcuts: ["runner_true_close_promotion"],
        acceptance_invariants: ["completed stop records ledger only"],
        negative_tests: ["completed stop creates no true-close artifacts"],
        reopen_conditions: ["runner closes topic without true-close audit"],
      }),
      "utf8",
    );
    await captureRunCli(["topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json"]);
    await captureRunCli(["topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-runner", "--json"]);

    const resultSource = path.join(projectRoot, "runner-completed-result.md");
    await writeFile(resultSource, "# Runner Result\n\nCompleted boundary evidence.\n", "utf8");
    await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);
    await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-runner",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);

    const runnerResult = await captureRunCli([
      "topic-runner",
      "step",
      createPayload.topicId,
      "--run-id",
      "runner-completed-boundary",
      "--adapter",
      "codex",
      "--verified-at",
      "2026-04-24T00:00:00Z",
      "--json",
    ]);

    assert.equal(runnerResult.exitCode, 0);
    const payload = JSON.parse(runnerResult.stdout);
    assert.equal(payload.runnerStatus, "stopped");
    assert.equal(payload.executed, false);
    assert.equal(payload.stopClass, "completed");
    assert.equal(payload.recommendedAction, "closeout_topic");
    assert.equal(payload.gate.stopClass, "completed");

    const topicDir = path.join(projectRoot, payload.topicRef);
    const ledger = YAML.parse(await readFile(
      path.join(topicDir, "run-ledger-runner-completed-boundary.yaml"),
      "utf8",
    ));
    assert.equal(ledger.run_status, "completed");
    assert.equal(ledger.event_count, 1);
    await assert.rejects(readFile(path.join(topicDir, "topic-true-close-audit.md"), "utf8"));
    await assert.rejects(readFile(path.join(topicDir, "topic-true-close-record.md"), "utf8"));
  });
});

test("topic worker dispatch writes a prompt artifact and moves the selected wave into active implementation", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "dispatch-demo",
      "--justification",
      "dispatch discipline demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "dispatch-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["packet fields remain explicit"],
        negative_tests: ["missing packet id fails"],
        reopen_conditions: ["owner-cut change reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);

    const dispatchResult = await captureRunCli([
      "topic",
      "worker",
      "dispatch",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-implementation",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);
    const dispatchPayload = JSON.parse(dispatchResult.stdout);
    assert.equal(dispatchPayload.ok, true);
    assert.equal(dispatchPayload.command, "topic.worker.dispatch");
    assert.equal(dispatchPayload.waveState, "implementation_active");

    const promptText = await readFile(path.join(projectRoot, dispatchPayload.promptRef), "utf8");
    assert.match(promptText, /# Worker Dispatch/);
    assert.match(promptText, /Packet: `wave-1-foundation-implementation`/);

    const topicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    const wave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(wave.state, "implementation_active");

    const packetText = await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "packet-wave-1-foundation-implementation.md"),
      "utf8",
    );
    assert.match(packetText, /status: dispatched/);
  });
});

test("topic audit dispatch writes an audit prompt without mutating the wave back out of implementation flow", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "audit-dispatch-demo",
      "--justification",
      "audit dispatch coverage",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "audit-dispatch-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["audit prompt remains packet-bound"],
        negative_tests: ["missing packet fails"],
        reopen_conditions: ["owner-cut drift reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);

    const auditDispatch = await captureRunCli([
      "topic",
      "audit",
      "dispatch",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-implementation",
      "--json",
    ]);
    assert.equal(auditDispatch.exitCode, 0);
    const auditPayload = JSON.parse(auditDispatch.stdout);
    assert.equal(auditPayload.ok, true);
    assert.equal(auditPayload.command, "topic.audit.dispatch");

    const promptText = await readFile(path.join(projectRoot, auditPayload.promptRef), "utf8");
    assert.match(promptText, /# Audit Dispatch/);
    assert.match(promptText, /Role: `audit`/);
  });
});

test("topic result record writes result artifacts and updates wave state by verdict", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "result-demo",
      "--justification",
      "result recording demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "result-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["result lineage remains wave-bound"],
        negative_tests: ["missing packet lineage fails"],
        reopen_conditions: ["owner-cut drift reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic",
      "packet",
      "freeze",
      createPayload.topicId,
      "--from",
      draftPath,
      "--json",
    ]);

    const sourcePath = path.join(projectRoot, "worker-result.md");
    await writeFile(sourcePath, "# Worker Result\n\nImplementation closed.\n", "utf8");

    const passResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "preflight",
      "--verdict",
      "PASS",
      "--from",
      sourcePath,
      "--verified-at",
      "2026-04-23T10:00:00Z",
      "--json",
    ]);
    assert.equal(passResult.exitCode, 0);
    const passPayload = JSON.parse(passResult.stdout);
    assert.equal(passPayload.ok, true);
    assert.equal(passPayload.waveState, "implementation_admitted");
    assert.equal(passPayload.resultKind, "preflight");

    const overflowResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "OVERFLOW",
      "--from",
      sourcePath,
      "--verified-at",
      "2026-04-23T11:00:00Z",
      "--json",
    ]);
    assert.equal(overflowResult.exitCode, 0);
    const overflowPayload = JSON.parse(overflowResult.stdout);
    assert.equal(overflowPayload.ok, true);
    assert.equal(overflowPayload.waveState, "overflowed");

    const resultText = await readFile(path.join(projectRoot, overflowPayload.resultRef), "utf8");
    assert.match(resultText, /result_kind: audit/);
    assert.match(resultText, /verdict: OVERFLOW/);

    const invalidTimestamp = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "audit",
      "--verdict",
      "PASS",
      "--from",
      sourcePath,
      "--verified-at",
      "2026-04-23 11:00:00",
      "--json",
    ]);
    assert.equal(invalidTimestamp.exitCode, 1);
    assert.match(invalidTimestamp.stderr, /ISO-8601 UTC timestamp/);
  });
});

test("topic decision-review records owner-cut changes and can supersede the selected wave", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "decision-review-demo",
      "--justification",
      "owner-cut review demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);
    const topicDir = path.join(projectRoot, ".nimi", "topics", "proposal", createPayload.topicId);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-2-follow-on", "follow-on",
      "--goal", "close follow-on", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const reviewResult = await captureRunCli([
      "topic",
      "decision-review",
      createPayload.topicId,
      "re-cut-foundation",
      "--decision",
      "wave-1 is no longer the active owner cut",
      "--replaced-scope",
      "foundation packet line",
      "--active-replacement-scope",
      "wave-2-follow-on",
      "--disposition",
      "superseded",
      "--target-wave",
      "wave-1-foundation",
      "--date",
      "2026-04-23",
      "--json",
    ]);
    assert.equal(reviewResult.exitCode, 0);
    const reviewPayload = JSON.parse(reviewResult.stdout);
    assert.equal(reviewPayload.ok, true);
    assert.equal(reviewPayload.disposition, "superseded");
    assert.equal(reviewPayload.targetWaveId, "wave-1-foundation");

    const topicYaml = YAML.parse(await readFile(path.join(topicDir, "topic.yaml"), "utf8"));
    const retiredWave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(retiredWave.state, "superseded");
    assert.equal(retiredWave.selected, false);
    assert.equal(topicYaml.selected_next_target, "wave-2-follow-on");

    const reviewText = await readFile(path.join(topicDir, "decision-review-re-cut-foundation.md"), "utf8");
    assert.match(reviewText, /decision_review_id: re-cut-foundation/);
    assert.match(reviewText, /disposition: superseded/);

    const invalidReview = await captureRunCli([
      "topic",
      "decision-review",
      createPayload.topicId,
      "bad-re-cut",
      "--decision",
      "replacement scope is not machine identifiable",
      "--replaced-scope",
      "foundation packet line",
      "--active-replacement-scope",
      "freeform-note",
      "--disposition",
      "unchanged",
      "--date",
      "2026-04-23",
      "--json",
    ]);
    assert.equal(invalidReview.exitCode, 1);
    assert.match(invalidReview.stderr, /machine-identifiable/);
  });
});

test("topic remediation open records explicit remediation lineage and moves the wave into needs_revision", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "remediation-demo",
      "--justification",
      "explicit remediation lineage demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const remediationResult = await captureRunCli([
      "topic",
      "remediation",
      "open",
      createPayload.topicId,
      "--kind",
      "a",
      "--reason",
      "split-owner-cut",
      "--json",
    ]);
    assert.equal(remediationResult.exitCode, 0);
    const remediationPayload = JSON.parse(remediationResult.stdout);
    assert.equal(remediationPayload.ok, true);
    assert.equal(remediationPayload.kind, "a");
    assert.equal(remediationPayload.waveState, "needs_revision");

    const topicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    const wave = topicYaml.waves.find((entry) => entry.wave_id === "wave-1-foundation");
    assert.equal(wave.state, "needs_revision");

    const remediationText = await readFile(path.join(projectRoot, remediationPayload.remediationRef), "utf8");
    assert.match(remediationText, /remediation_id: wave-1-foundation-remediation-a-split-owner-cut/);
    assert.match(remediationText, /kind: a/);
  });
});

test("topic overflow continue records explicit continuation lineage and reopens dispatch through continuation_packet_open", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "overflow-demo",
      "--justification",
      "explicit overflow continuation demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const initialPacketDraft = path.join(projectRoot, "initial-overflow-packet.yaml");
    await writeFile(
      initialPacketDraft,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["packet fields remain explicit"],
        negative_tests: ["missing packet id fails"],
        reopen_conditions: ["owner-cut change reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", initialPacketDraft, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);

    const overflowResultSource = path.join(projectRoot, "overflow-result.md");
    await writeFile(overflowResultSource, "# Overflow\n\nPacket boundary was too thin.\n", "utf8");
    const overflowResult = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "OVERFLOW",
      "--from",
      overflowResultSource,
      "--verified-at",
      "2026-04-23T12:00:00Z",
      "--json",
    ]);
    assert.equal(overflowResult.exitCode, 0);
    const overflowPayload = JSON.parse(overflowResult.stdout);
    assert.equal(overflowPayload.waveState, "overflowed");

    const continuationPacketDraft = path.join(projectRoot, "continuation-packet.yaml");
    await writeFile(
      continuationPacketDraft,
      YAML.stringify({
        packet_id: "wave-1-foundation-continuation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["continuation stays inside owner domain"],
        negative_tests: ["cross-domain continuation fails"],
        reopen_conditions: ["owner-cut drift reopens packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", continuationPacketDraft, "--json",
    ]);

    const continueResult = await captureRunCli([
      "topic",
      "overflow",
      "continue",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-continuation",
      "--overflowed-packet",
      "wave-1-foundation-implementation",
      "--manager-judgement",
      "direction stayed correct and owner domain did not move",
      "--same-owner-domain",
      "--json",
    ]);
    assert.equal(continueResult.exitCode, 0);
    const continuePayload = JSON.parse(continueResult.stdout);
    assert.equal(continuePayload.ok, true);
    assert.equal(continuePayload.waveState, "continuation_packet_open");

    const continuationText = await readFile(path.join(projectRoot, continuePayload.continuationRef), "utf8");
    assert.match(continuationText, /overflowed_packet_id: wave-1-foundation-implementation/);
    assert.match(continuationText, /continuation_packet_id: wave-1-foundation-continuation/);
    assert.match(continuationText, /same_owner_domain: true/);

    const dispatchContinuation = await captureRunCli([
      "topic",
      "worker",
      "dispatch",
      createPayload.topicId,
      "--packet",
      "wave-1-foundation-continuation",
      "--json",
    ]);
    assert.equal(dispatchContinuation.exitCode, 0);
    const dispatchPayload = JSON.parse(dispatchContinuation.stdout);
    assert.equal(dispatchPayload.waveState, "implementation_active");
  });
});

test("topic closeout wave, validate closure, true-close-audit, and closeout topic enforce final closure gates", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "closeout-demo",
      "--justification",
      "full closure and true-close demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "closeout-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["closure evidence remains explicit"],
        negative_tests: ["missing closeout evidence fails"],
        reopen_conditions: ["owner-cut drift reopens wave"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);
    const resultSource = path.join(projectRoot, "closeout-result.md");
    await writeFile(resultSource, "# Implementation Result\n\nWave evidence closed.\n", "utf8");
    const resultRecord = await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-23T13:00:00Z",
      "--json",
    ]);
    assert.equal(resultRecord.exitCode, 0);

    const earlyAudit = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "wave is still active so true close cannot pass",
      "--json",
    ]);
    assert.equal(earlyAudit.exitCode, 1);
    const earlyAuditPayload = JSON.parse(earlyAudit.stdout);
    assert.equal(earlyAuditPayload.status, "pending");
    assert.ok(earlyAuditPayload.checks.some((entry) => entry.id === "all_waves_terminal" && entry.ok === false));

    const closeoutWave = await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-foundation",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutWave.exitCode, 0);
    const closeoutWavePayload = JSON.parse(closeoutWave.stdout);
    assert.equal(closeoutWavePayload.waveState, "closed");

    const validateClosure = await captureRunCli([
      "topic",
      "validate",
      "closure",
      createPayload.topicId,
      "wave-1-foundation",
      "--json",
    ]);
    assert.equal(validateClosure.exitCode, 0);
    const closurePayload = JSON.parse(validateClosure.stdout);
    assert.equal(closurePayload.ok, true);

    const passAudit = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "all waves are terminal and no active target remains",
      "--json",
    ]);
    assert.equal(passAudit.exitCode, 0);
    const passAuditPayload = JSON.parse(passAudit.stdout);
    assert.equal(passAuditPayload.status, "passed");

    const closeoutTopic = await captureRunCli([
      "topic",
      "closeout",
      "topic",
      createPayload.topicId,
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutTopic.exitCode, 0);
    const closeoutTopicPayload = JSON.parse(closeoutTopic.stdout);
    assert.equal(closeoutTopicPayload.state, "closed");
    assert.equal(closeoutTopicPayload.currentTrueCloseStatus, "true_closed");

    const closedTopicYaml = YAML.parse(await readFile(
      path.join(projectRoot, ".nimi", "topics", "closed", createPayload.topicId, "topic.yaml"),
      "utf8",
    ));
    assert.equal(closedTopicYaml.state, "closed");
    assert.equal(closedTopicYaml.current_true_close_status, "true_closed");
  });
});

test("topic hold and resume create pending-note lineage and move the topic between pending and ongoing", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "pending-resume-demo",
      "--justification",
      "pending hold and resume demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-2-follow-on", "follow-on",
      "--goal", "close follow-on", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "pending-demo-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["pending only after prior wave is closed"],
        negative_tests: ["active implementation hold fails"],
        reopen_conditions: ["new owner-cut needs a fresh packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);

    const resultSource = path.join(projectRoot, "pending-demo-result.md");
    await writeFile(resultSource, "# Result\n\nFoundation wave closed.\n", "utf8");
    await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-23T14:00:00Z",
      "--json",
    ]);
    await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-foundation",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-2-follow-on", "--json",
    ]);

    const holdResult = await captureRunCli([
      "topic",
      "hold",
      createPayload.topicId,
      "--reason",
      "external-dependency-wait",
      "--summary",
      "waiting on an external dependency before wave-2 can reopen",
      "--reopen-criteria",
      "dependency owner confirms the contract is stable",
      "--json",
    ]);
    assert.equal(holdResult.exitCode, 0);
    const holdPayload = JSON.parse(holdResult.stdout);
    assert.equal(holdPayload.state, "pending");

    const pendingTopicDir = path.join(projectRoot, ".nimi", "topics", "pending", createPayload.topicId);
    const pendingNote = await readFile(path.join(pendingTopicDir, "pending-note.md"), "utf8");
    assert.match(pendingNote, /reason: external-dependency-wait/);
    assert.match(pendingNote, /status: active/);

    const validatePending = await captureRunCli([
      "topic",
      "validate",
      createPayload.topicId,
      "--json",
    ]);
    assert.equal(validatePending.exitCode, 0);
    const validatePendingPayload = JSON.parse(validatePending.stdout);
    assert.equal(validatePendingPayload.state, "pending");
    assert.equal(validatePendingPayload.pendingNoteStatus, "active");

    const resumeResult = await captureRunCli([
      "topic",
      "resume",
      createPayload.topicId,
      "--criteria-met",
      "dependency owner confirmed the contract is stable",
      "--json",
    ]);
    assert.equal(resumeResult.exitCode, 0);
    const resumePayload = JSON.parse(resumeResult.stdout);
    assert.equal(resumePayload.state, "ongoing");

    const resumedTopicDir = path.join(projectRoot, ".nimi", "topics", "ongoing", createPayload.topicId);
    const resumedPendingNote = await readFile(path.join(resumedTopicDir, "pending-note.md"), "utf8");
    assert.match(resumedPendingNote, /status: resumed/);
    assert.match(resumedPendingNote, /last_resume_reason: dependency owner confirmed the contract is stable/);
  });
});

test("topic hold fails closed while active implementation tracking remains", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "pending-blocker-demo",
      "--justification",
      "pending blocker demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "pending-blocker-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["hold must refuse active implementation"],
        negative_tests: ["implementation-active hold fails"],
        reopen_conditions: ["new owner-cut needs a fresh packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);

    const holdResult = await captureRunCli([
      "topic",
      "hold",
      createPayload.topicId,
      "--reason",
      "external-dependency-wait",
      "--summary",
      "cannot pause while implementation is still active",
      "--reopen-criteria",
      "not relevant",
      "--json",
    ]);
    assert.equal(holdResult.exitCode, 1);
    assert.match(holdResult.stderr, /no active implementation wave/);
  });
});

test("topic closeout from pending requires a close trigger and records pending-note closure", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    const createResult = await captureRunCli([
      "topic",
      "create",
      "pending-closeout-demo",
      "--justification",
      "close from pending demo",
      "--json",
    ]);
    const createPayload = JSON.parse(createResult.stdout);

    await captureRunCli([
      "topic", "wave", "add", createPayload.topicId, "wave-1-foundation", "foundation",
      "--goal", "close foundation", "--owner-domain", "nimicoding/topic", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "select", createPayload.topicId, "wave-1-foundation", "--json",
    ]);
    await captureRunCli([
      "topic", "wave", "admit", createPayload.topicId, "wave-1-foundation", "--json",
    ]);

    const draftPath = path.join(projectRoot, "pending-closeout-packet.yaml");
    await writeFile(
      draftPath,
      YAML.stringify({
        packet_id: "wave-1-foundation-implementation",
        topic_id: createPayload.topicId,
        wave_id: "wave-1-foundation",
        packet_kind: "implementation",
        status: "draft",
        authority_owner: ["nimi-coding/topic"],
        canonical_seams: ["topic.yaml waves[]"],
        forbidden_shortcuts: ["placeholder_success"],
        acceptance_invariants: ["pending closeout remains explicit"],
        negative_tests: ["closeout from pending without close trigger fails"],
        reopen_conditions: ["new owner-cut needs a fresh packet"],
      }),
      "utf8",
    );
    await captureRunCli([
      "topic", "packet", "freeze", createPayload.topicId, "--from", draftPath, "--json",
    ]);
    await captureRunCli([
      "topic", "worker", "dispatch", createPayload.topicId, "--packet", "wave-1-foundation-implementation", "--json",
    ]);
    const resultSource = path.join(projectRoot, "pending-closeout-result.md");
    await writeFile(resultSource, "# Result\n\nTopic can close.\n", "utf8");
    await captureRunCli([
      "topic",
      "result",
      "record",
      createPayload.topicId,
      "--kind",
      "implementation",
      "--verdict",
      "PASS",
      "--from",
      resultSource,
      "--verified-at",
      "2026-04-23T15:00:00Z",
      "--json",
    ]);
    await captureRunCli([
      "topic",
      "closeout",
      "wave",
      createPayload.topicId,
      "wave-1-foundation",
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);

    const holdWithoutCloseTrigger = await captureRunCli([
      "topic",
      "hold",
      createPayload.topicId,
      "--reason",
      "rollout-observation",
      "--summary",
      "waiting for a final closure signal",
      "--reopen-criteria",
      "sponsor asks for follow-on work",
      "--json",
    ]);
    assert.equal(holdWithoutCloseTrigger.exitCode, 0);

    const passAudit = await captureRunCli([
      "topic",
      "true-close-audit",
      createPayload.topicId,
      "--judgement",
      "all waves are terminal and the topic may close if the close trigger exists",
      "--json",
    ]);
    assert.equal(passAudit.exitCode, 0);

    const closeoutWithoutTrigger = await captureRunCli([
      "topic",
      "closeout",
      "topic",
      createPayload.topicId,
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutWithoutTrigger.exitCode, 1);
    const closeoutWithoutTriggerPayload = JSON.parse(closeoutWithoutTrigger.stdout);
    assert.match(closeoutWithoutTriggerPayload.error, /close trigger/);

    const pendingTopicDir = path.join(projectRoot, ".nimi", "topics", "pending", createPayload.topicId);
    const pendingNotePath = path.join(pendingTopicDir, "pending-note.md");
    const existingPendingNote = await readFile(pendingNotePath, "utf8");
    const closingPendingNote = YAML.parse(existingPendingNote.match(/^---\n([\s\S]*?)\n---\n/m)[1]);
    closingPendingNote.close_trigger = "sponsor confirmed no follow-on work remains";
    await writeFile(
      pendingNotePath,
      `---\n${YAML.stringify(closingPendingNote).trimEnd()}\n---\n\n# Pending Note\n`,
      "utf8",
    );

    const closeoutTopic = await captureRunCli([
      "topic",
      "closeout",
      "topic",
      createPayload.topicId,
      "--authority",
      "closed",
      "--semantic",
      "closed",
      "--consumer",
      "closed",
      "--drift-resistance",
      "closed",
      "--disposition",
      "complete",
      "--json",
    ]);
    assert.equal(closeoutTopic.exitCode, 0);
    const closeoutPayload = JSON.parse(closeoutTopic.stdout);
    assert.equal(closeoutPayload.state, "closed");

    const closedPendingNote = await readFile(
      path.join(projectRoot, ".nimi", "topics", "closed", createPayload.topicId, "pending-note.md"),
      "utf8",
    );
    assert.match(closedPendingNote, /status: closed/);
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

    await mkdir(path.join(projectRoot, ".nimi", "spec", "_meta"), { recursive: true });
    await writeFile(
      path.join(projectRoot, ".nimi", "spec", "_meta", "blueprint-reference.yaml"),
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
            ".nimi/topics/closed/2026-04-11-nimicoding-canonical-spec-model-redesign/design.md",
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
      "summary",
      "verified_at",
    ]);
    assert.deepEqual(payload.skill.expectedCloseoutSummaryStatus, [
      "candidate_ready",
      "partial",
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

async function seedFrozenAuditSweep(projectRoot, {
  sweepId,
  actionability = "auto-fix",
  severity = "medium",
  findingTitle = "Fixture finding",
} = {}) {
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "service.ts"), "export function service() { return 1; }\n", "utf8");

  assert.equal((await captureRunCli([
    "audit-sweep",
    "plan",
    "--root",
    "src",
    "--sweep-id",
    sweepId,
    "--json",
  ])).exitCode, 0);
  assert.equal((await captureRunCli([
    "audit-sweep",
    "chunk",
    "dispatch",
    "--sweep-id",
    sweepId,
    "--chunk-id",
    "chunk-001",
    "--dispatched-at",
    "2026-04-10T00:00:00.000Z",
    "--json",
  ])).exitCode, 0);
  await writeFile(
    path.join(projectRoot, `${sweepId}-audit-output.json`),
    `${JSON.stringify({
      chunk_id: "chunk-001",
      auditor: { id: "test-auditor", model: "fixture" },
      coverage: { files: ["src/service.ts"] },
      findings: [
        {
          severity,
          actionability,
          confidence: "high",
          category: "quality",
          impact: "The fixture finding demonstrates audit-sweep lifecycle enforcement.",
          location: { file: "src/service.ts", line: 1, symbol: "service" },
          title: findingTitle,
          description: "The audited fixture service requires an explicit remediation posture.",
          evidence: {
            summary: "service() is the audited fixture surface.",
            auditor_reasoning: "The file is in the chunk and the finding is intentionally actionable.",
          },
        },
      ],
    }, null, 2)}\n`,
    "utf8",
  );
  assert.equal((await captureRunCli([
    "audit-sweep",
    "chunk",
    "ingest",
    "--sweep-id",
    sweepId,
    "--chunk-id",
    "chunk-001",
    "--from",
    `${sweepId}-audit-output.json`,
    "--verified-at",
    "2026-04-10T00:00:00.000Z",
    "--json",
  ])).exitCode, 0);
  assert.equal((await captureRunCli([
    "audit-sweep",
    "chunk",
    "review",
    "--sweep-id",
    sweepId,
    "--chunk-id",
    "chunk-001",
    "--verdict",
    "pass",
    "--reviewed-at",
    "2026-04-10T01:00:00.000Z",
    "--summary",
    "manager accepted auditor fixture",
    "--json",
  ])).exitCode, 0);
  const ledgerResult = await captureRunCli([
    "audit-sweep",
    "ledger",
    "build",
    "--sweep-id",
    sweepId,
    "--verified-at",
    "2026-04-10T02:00:00.000Z",
    "--json",
  ]);
  assert.equal(ledgerResult.exitCode, 0);
  return JSON.parse(ledgerResult.stdout);
}

test("audit-sweep plan creates deterministic local chunk artifacts", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, "src", "domain"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "domain", "alpha.ts"), "export const alpha = 1;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "domain", "beta.ts"), "export const beta = 2;\n", "utf8");
    await writeFile(path.join(projectRoot, "src", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
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
    assert.deepEqual(payload.criteria, ["quality", "security"]);
    assert.match(payload.inventoryHash, /^[a-f0-9]{64}$/);

    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-plan.yaml"), "utf8"));
    assert.equal(plan.kind, "audit-plan");
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
    await mkdir(path.join(projectRoot, "runtime", "internal"), { recursive: true });
    await writeFile(path.join(projectRoot, "runtime", "internal", "service.go"), "package internal\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
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

    const plan = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "plans", "audit-sweep-test-spec-basis.yaml"), "utf8"));
    assert.equal(plan.planning_basis.mode, "spec_authority");
    assert.equal(plan.planning_basis.authority_root, ".nimi/spec");
    assert.equal(plan.planning_basis.files_are_evidence_only, true);
    assert.ok(plan.inventory.every((entry) => entry.file_ref.startsWith(".nimi/spec/")));
    assert.ok(!plan.inventory.some((entry) => entry.file_ref === "runtime/internal/service.go"));

    const runtimeChunk = plan.chunks.find((chunk) => chunk.owner_domain === "runtime" && chunk.spec_surface === "kernel-contracts");
    assert.ok(runtimeChunk);
    assert.ok(runtimeChunk.authority_refs.includes(".nimi/spec/runtime/kernel/runtime-audit-surface.md"));
    assert.ok(runtimeChunk.evidence_roots.includes("runtime"));
    assert.ok(runtimeChunk.evidence_roots.includes("config"));
    const specRootChunk = plan.chunks.find((chunk) => chunk.owner_domain === "spec-root");
    assert.ok(specRootChunk);
    assert.ok(specRootChunk.evidence_roots.includes("apps"));
    assert.ok(specRootChunk.evidence_roots.includes("config"));

    const dispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      runtimeChunk.chunk_id,
      "--dispatched-at",
      "2026-04-24T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);

    const evidencePath = path.join(projectRoot, "runtime-audit-evidence.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify({
        chunk_id: runtimeChunk.chunk_id,
        auditor: { id: "spec-first-auditor" },
        coverage: {
          authority_refs: runtimeChunk.authority_refs,
          files: [...runtimeChunk.authority_refs, "runtime/internal/service.go"],
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
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-spec-basis",
      "--chunk-id",
      runtimeChunk.chunk_id,
      "--from",
      "runtime-audit-evidence.json",
      "--verified-at",
      "2026-04-24T00:01:00.000Z",
      "--json",
    ]);
    assert.equal(ingestResult.exitCode, 0, ingestResult.stderr);
    const ingestPayload = JSON.parse(ingestResult.stdout);
    assert.equal(ingestPayload.addedCount, 1);
  });
});

test("audit-sweep state machine builds immutable ledger, remediation map, rerun closure, and closeout summary", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);

    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "service.ts"), "export function service() { return 1; }\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0);

    const dispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--auditor",
      "test-auditor",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);
    const dispatchPayload = JSON.parse(dispatchResult.stdout);
    assert.equal(dispatchPayload.state, "dispatched");
    assert.equal(dispatchPayload.packetRef, ".nimi/local/audit/packets/audit-sweep-test-ledger/chunk-001.auditor-packet.yaml");
    const auditorPacket = YAML.parse(await readFile(path.join(projectRoot, ...dispatchPayload.packetRef.split("/")), "utf8"));
    assert.equal(auditorPacket.kind, "audit-auditor-packet");
    assert.deepEqual(auditorPacket.output_contract.coverage_files_must_exactly_match, ["src/service.ts"]);

    const evidencePath = path.join(projectRoot, "audit-output.json");
    await writeFile(
      evidencePath,
      `${JSON.stringify({
        chunk_id: "chunk-001",
        auditor: { id: "test-auditor", model: "fixture" },
        coverage: { files: ["src/service.ts"] },
        findings: [
          {
            severity: "high",
            actionability: "needs-decision",
            confidence: "high",
            category: "security",
            impact: "The service can ship behavior that has not passed a security decision.",
            location: {
              file: "src/service.ts",
              line: 1,
              symbol: "service",
            },
            title: "Service exposes unchecked behavior",
            description: "The service path needs a concrete security review before remediation.",
            evidence: {
              summary: "service() returns without any guard or decision point.",
              auditor_reasoning: "The exported service is in the audited chunk and lacks a security decision boundary.",
            },
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--chunk-id",
      "chunk-001",
      "--from",
      "audit-output.json",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 0);
    const ingestPayload = JSON.parse(ingestResult.stdout);
    assert.equal(ingestPayload.state, "ingested");
    assert.equal(ingestPayload.addedCount, 1);
    assert.equal(ingestPayload.evidenceRef, ".nimi/local/audit/evidence/audit-sweep-test-ledger/chunk-001.audit-evidence.json");

    const reviewResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "review",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--chunk-id",
      "chunk-001",
      "--verdict",
      "pass",
      "--reviewed-at",
      "2026-04-10T01:00:00.000Z",
      "--summary",
      "manager accepted auditor evidence",
      "--json",
    ]);
    assert.equal(reviewResult.exitCode, 0);
    assert.equal(JSON.parse(reviewResult.stdout).state, "frozen");

    const ledgerResult = await captureRunCli([
      "audit-sweep",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(ledgerResult.exitCode, 0);
    const ledgerPayload = JSON.parse(ledgerResult.stdout);
    assert.equal(ledgerPayload.status, "candidate_ready");
    assert.match(ledgerPayload.snapshotId, /^ledger-[a-f0-9]{16}$/);
    assert.equal(ledgerPayload.findingCount, 1);
    assert.equal(ledgerPayload.unresolvedFindingCount, 1);
    assert.equal(ledgerPayload.coverage.audited_files, 1);
    assert.match(ledgerPayload.ledgerRef, /^\.nimi\/local\/audit\/ledgers\/audit-sweep-test-ledger\/ledger-[a-f0-9]{16}\.yaml$/);
    assert.match(ledgerPayload.reportRef, /^\.nimi\/local\/audit\/reports\/audit-sweep-test-ledger\/ledger-[a-f0-9]{16}\.md$/);

    const ledger = YAML.parse(await readFile(path.join(projectRoot, ...ledgerPayload.ledgerRef.split("/")), "utf8"));
    assert.equal(ledger.kind, "audit-ledger");
    assert.equal(ledger.immutable, true);
    assert.equal(ledger.finding_count, 1);
    assert.equal(ledger.unresolved_finding_count, 1);
    assert.deepEqual(ledger.evidence_refs, [
      ".nimi/local/audit/evidence/audit-sweep-test-ledger/findings.yaml",
      ".nimi/local/audit/evidence/audit-sweep-test-ledger/chunk-001.audit-evidence.json",
    ]);
    const latestPointer = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "ledgers", "audit-sweep-test-ledger", "latest.yaml"), "utf8"));
    assert.equal(latestPointer.ledger_ref, ledgerPayload.ledgerRef);

    const remediationMapResult = await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--max-findings",
      "1",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(remediationMapResult.exitCode, 0);
    const remediationMapPayload = JSON.parse(remediationMapResult.stdout);
    assert.equal(remediationMapPayload.waveCount, 1);
    assert.equal(remediationMapPayload.mappedFindingCount, 1);
    assert.match(remediationMapPayload.remediationMapRef, /^\.nimi\/local\/audit\/remediation-maps\/audit-sweep-test-ledger\/ledger-[a-f0-9]{16}\.yaml$/);

    const remediationMap = YAML.parse(await readFile(path.join(projectRoot, ...remediationMapPayload.remediationMapRef.split("/")), "utf8"));
    assert.equal(remediationMap.kind, "audit-remediation-map");
    assert.equal(remediationMap.source_ledger_ref, ledgerPayload.ledgerRef);
    assert.equal(remediationMap.waves[0].wave_id, "remediation-wave-001");
    assert.equal(remediationMap.waves[0].owner_domain, "src");
    assert.deepEqual(remediationMap.waves[0].finding_ids, ["finding-0001"]);
    assert.equal(remediationMap.waves[0].admission_checklist.re_audit_required, true);

    const findingsStore = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-test-ledger", "findings.yaml"), "utf8"));
    const sourceFingerprint = findingsStore.findings[0].fingerprint;

    await writeFile(
      path.join(projectRoot, "resolution-output.json"),
      `${JSON.stringify({
        finding_id: "finding-0001",
        source_fingerprint: sourceFingerprint,
        disposition: "remediated",
        rerun: {
          chunk_id: "chunk-001",
          covered_files: ["src/service.ts"],
          verdict: "not_reproduced",
          auditor: { id: "test-auditor", model: "fixture" },
        },
        evidence_summary: "Re-audit evidence confirms the finding has been remediated.",
      }, null, 2)}\n`,
      "utf8",
    );

    const resolveResult = await captureRunCli([
      "audit-sweep",
      "finding",
      "resolve",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--finding-id",
      "finding-0001",
      "--disposition",
      "remediated",
      "--from",
      "resolution-output.json",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(resolveResult.exitCode, 0);
    const resolvePayload = JSON.parse(resolveResult.stdout);
    assert.equal(resolvePayload.disposition, "remediated");
    assert.equal(resolvePayload.evidenceRef, ".nimi/local/audit/evidence/audit-sweep-test-ledger/resolution-finding-0001.json");

    const rebuiltLedgerResult = await captureRunCli([
      "audit-sweep",
      "ledger",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(rebuiltLedgerResult.exitCode, 0);
    const rebuiltLedgerPayload = JSON.parse(rebuiltLedgerResult.stdout);
    assert.equal(rebuiltLedgerPayload.unresolvedFindingCount, 0);
    assert.ok(rebuiltLedgerPayload.evidenceRefs.includes(".nimi/local/audit/evidence/audit-sweep-test-ledger/resolution-finding-0001.json"));
    assert.notEqual(rebuiltLedgerPayload.ledgerRef, ledgerPayload.ledgerRef);

    const emptyRemediationMapResult = await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(emptyRemediationMapResult.exitCode, 0);
    assert.equal(JSON.parse(emptyRemediationMapResult.stdout).waveCount, 0);

    const closeoutSummaryResult = await captureRunCli([
      "audit-sweep",
      "closeout",
      "summary",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(closeoutSummaryResult.exitCode, 0);
    const closeoutImport = JSON.parse(closeoutSummaryResult.stdout);
    assert.equal(closeoutImport.skill.id, "audit_sweep");
    assert.equal(closeoutImport.outcome, "completed");
    assert.equal(closeoutImport.summary.status, "candidate_ready");
    assert.equal(closeoutImport.summary.unresolved_finding_count, 0);
    assert.equal(closeoutImport.auditCloseout.closeout_posture, "audit_complete_all_findings_postured");
    assert.equal(closeoutImport.summary.audit_closeout_ref, closeoutImport.auditCloseoutRef);
    assert.equal("audit_closeout" in closeoutImport.summary, false);

    const closeoutImportPath = path.join(projectRoot, "audit-sweep-closeout.json");
    await writeFile(closeoutImportPath, `${JSON.stringify(closeoutImport, null, 2)}\n`, "utf8");
    const closeoutResult = await captureRunCli([
      "closeout",
      "--from",
      closeoutImportPath,
      "--json",
    ]);
    assert.equal(closeoutResult.exitCode, 0);
    const closeoutPayload = JSON.parse(closeoutResult.stdout);
    assert.equal(closeoutPayload.ok, true);
    assert.equal(closeoutPayload.skill.id, "audit_sweep");

    const statusResult = await captureRunCli([
      "audit-sweep",
      "status",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--json",
    ]);
    assert.equal(statusResult.exitCode, 0);
    const statusPayload = JSON.parse(statusResult.stdout);
    assert.equal(statusPayload.coverage.frozenChunks, 1);
    assert.equal(statusPayload.findingCount, 1);

    const validateResult = await captureRunCli([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-ledger",
      "--scope",
      "all",
      "--json",
    ]);
    assert.equal(validateResult.exitCode, 0);
    const validatePayload = JSON.parse(validateResult.stdout);
    assert.equal(validatePayload.ok, true);
    assert.ok(validatePayload.checks.length > 0);
  });
});

test("audit-sweep chunk ingest fails closed on malformed findings", async () => {
  await withTempProject(async (projectRoot) => {
    const startResult = await captureRunCli(["start"]);
    assert.equal(startResult.exitCode, 0);

    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "service.ts"), "export const service = 1;\n", "utf8");

    const planResult = await captureRunCli([
      "audit-sweep",
      "plan",
      "--root",
      "src",
      "--sweep-id",
      "audit-sweep-test-invalid",
      "--json",
    ]);
    assert.equal(planResult.exitCode, 0);

    const dispatchResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-invalid",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(dispatchResult.exitCode, 0);

    await writeFile(
      path.join(projectRoot, "bad-audit-output.json"),
      `${JSON.stringify({
        chunk_id: "chunk-001",
        auditor: { id: "test-auditor" },
        coverage: { files: ["src/service.ts"] },
        findings: [
          {
            severity: "high",
            category: "security",
            confidence: "high",
            impact: "Impact exists, actionability does not.",
            location: { file: "src/service.ts" },
            title: "Missing actionability",
            description: "This finding omits required actionability.",
            evidence: {
              summary: "Invalid fixture.",
              auditor_reasoning: "Invalid fixture.",
            },
          },
        ],
      }, null, 2)}\n`,
      "utf8",
    );

    const ingestResult = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-invalid",
      "--chunk-id",
      "chunk-001",
      "--from",
      "bad-audit-output.json",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);

    assert.equal(ingestResult.exitCode, 2);
    assert.match(ingestResult.stderr, /actionability must be one of/);
  });
});

test("audit-sweep closeout and validators fail closed on missing remediation map and tampered ledger", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    const ledgerPayload = await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-test-gates",
      actionability: "auto-fix",
    });

    const closeoutWithoutMap = await captureRunCli([
      "audit-sweep",
      "closeout",
      "summary",
      "--sweep-id",
      "audit-sweep-test-gates",
      "--verified-at",
      "2026-04-10T03:00:00.000Z",
      "--json",
    ]);
    assert.equal(closeoutWithoutMap.exitCode, 2);
    assert.match(closeoutWithoutMap.stderr, /remediation map exists for the latest ledger/);

    const ledgerPath = path.join(projectRoot, ...ledgerPayload.ledgerRef.split("/"));
    const ledger = YAML.parse(await readFile(ledgerPath, "utf8"));
    ledger.coverage.audited_files = 0;
    await writeFile(ledgerPath, YAML.stringify(ledger), "utf8");

    const validateLedger = await captureRunCli([
      "audit-sweep",
      "validate",
      "--sweep-id",
      "audit-sweep-test-gates",
      "--scope",
      "ledger",
      "--json",
    ]);
    assert.equal(validateLedger.exitCode, 2);
    const validatePayload = JSON.parse(validateLedger.stdout);
    assert.equal(validatePayload.ok, false);
    assert.ok(validatePayload.checks.some((entry) => entry.id === "ledger_coverage_counts_match" && entry.ok === false));
  });
});

test("audit-sweep rejects coverage mismatch, invalid rerun, and unexpected closeout fields", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(path.join(projectRoot, "src", "service.ts"), "export const service = 1;\n", "utf8");
    assert.equal((await captureRunCli(["audit-sweep", "plan", "--root", "src", "--sweep-id", "audit-sweep-test-negative", "--json"])).exitCode, 0);
    assert.equal((await captureRunCli([
      "audit-sweep",
      "chunk",
      "dispatch",
      "--sweep-id",
      "audit-sweep-test-negative",
      "--chunk-id",
      "chunk-001",
      "--dispatched-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ])).exitCode, 0);

    await writeFile(
      path.join(projectRoot, "coverage-mismatch.json"),
      `${JSON.stringify({
        chunk_id: "chunk-001",
        auditor: { id: "test-auditor" },
        coverage: { files: [] },
        findings: [],
      }, null, 2)}\n`,
      "utf8",
    );
    const mismatch = await captureRunCli([
      "audit-sweep",
      "chunk",
      "ingest",
      "--sweep-id",
      "audit-sweep-test-negative",
      "--chunk-id",
      "chunk-001",
      "--from",
      "coverage-mismatch.json",
      "--verified-at",
      "2026-04-10T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(mismatch.exitCode, 2);
    assert.match(mismatch.stderr, /coverage\.files must exactly match/);

    const ledgerPayload = await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-test-rerun-negative",
      actionability: "auto-fix",
    });
    const findingsStore = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "local", "audit", "evidence", "audit-sweep-test-rerun-negative", "findings.yaml"), "utf8"));
    await writeFile(
      path.join(projectRoot, "bad-resolution.json"),
      `${JSON.stringify({
        finding_id: "finding-0001",
        source_fingerprint: findingsStore.findings[0].fingerprint,
        disposition: "remediated",
        rerun: {
          chunk_id: "chunk-001",
          covered_files: ["src/service.ts"],
          verdict: "still_reproduced",
          auditor: { id: "test-auditor" },
        },
        evidence_summary: "The finding still reproduces, so remediated is invalid.",
      }, null, 2)}\n`,
      "utf8",
    );
    const badRerun = await captureRunCli([
      "audit-sweep",
      "finding",
      "resolve",
      "--sweep-id",
      "audit-sweep-test-rerun-negative",
      "--finding-id",
      "finding-0001",
      "--disposition",
      "remediated",
      "--from",
      "bad-resolution.json",
      "--verified-at",
      "2026-04-11T00:00:00.000Z",
      "--json",
    ]);
    assert.equal(badRerun.exitCode, 2);
    assert.match(badRerun.stderr, /requires not_reproduced/);

    await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-rerun-negative",
      "--verified-at",
      "2026-04-10T03:00:00.000Z",
      "--json",
    ]);
    const closeout = await captureRunCli([
      "audit-sweep",
      "closeout",
      "summary",
      "--sweep-id",
      "audit-sweep-test-rerun-negative",
      "--verified-at",
      "2026-04-10T04:00:00.000Z",
      "--json",
    ]);
    assert.equal(closeout.exitCode, 0);
    const closeoutImport = JSON.parse(closeout.stdout);
    closeoutImport.summary.audit_closeout = { forbidden: true };
    await writeFile(path.join(projectRoot, "bad-audit-closeout-extra.json"), `${JSON.stringify(closeoutImport, null, 2)}\n`, "utf8");
    const imported = await captureRunCli(["closeout", "--from", "bad-audit-closeout-extra.json", "--json"]);
    assert.equal(imported.exitCode, 2);
    assert.match(imported.stderr, /unexpected fields: audit_closeout/);
    assert.match(ledgerPayload.ledgerRef, /audit-sweep-test-rerun-negative/);
  });
});

test("audit-sweep remediation-map admit materializes topic waves and preserves manager decision gates", async () => {
  await withTempProject(async (projectRoot) => {
    assert.equal((await captureRunCli(["start"])).exitCode, 0);
    await seedReconstructedTargetTruth(projectRoot);
    await seedFrozenAuditSweep(projectRoot, {
      sweepId: "audit-sweep-test-topic-admit",
      actionability: "auto-fix",
    });
    assert.equal((await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "build",
      "--sweep-id",
      "audit-sweep-test-topic-admit",
      "--verified-at",
      "2026-04-10T03:00:00.000Z",
      "--json",
    ])).exitCode, 0);

    const createTopicResult = await captureRunCli([
      "topic",
      "create",
      "audit-remediation-demo",
      "--title",
      "Audit Remediation Demo",
      "--justification",
      "audit-sweep remediation waves need topic-owned repair execution",
      "--applicability",
      "authority-bearing",
      "--json",
    ]);
    assert.equal(createTopicResult.exitCode, 0);
    const topic = JSON.parse(createTopicResult.stdout);

    const admitResult = await captureRunCli([
      "audit-sweep",
      "remediation-map",
      "admit",
      "--sweep-id",
      "audit-sweep-test-topic-admit",
      "--topic-id",
      topic.topicId,
      "--json",
    ]);
    assert.equal(admitResult.exitCode, 0);
    const admitPayload = JSON.parse(admitResult.stdout);
    assert.deepEqual(admitPayload.materializedWaveIds, ["wave-audit-remediation-001"]);
    assert.deepEqual(admitPayload.admittedWaveIds, ["wave-audit-remediation-001"]);

    const topicYaml = YAML.parse(await readFile(path.join(projectRoot, ".nimi", "topics", "ongoing", topic.topicId, "topic.yaml"), "utf8"));
    assert.equal(topicYaml.waves[0].wave_id, "wave-audit-remediation-001");
    assert.equal(topicYaml.waves[0].state, "preflight_admitted");
    assert.deepEqual(topicYaml.waves[0].source_audit_sweep.finding_ids, ["finding-0001"]);
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
