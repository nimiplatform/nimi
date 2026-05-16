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
  normalizeV2SpecGenerationInputs(config.spec_generation_inputs);
  await writeFile(configPath, YAML.stringify(config), "utf8");
}

function normalizeV2SpecGenerationInputs(inputs) {
  if (!inputs || inputs.mode !== "class_filtered") {
    return;
  }

  const authorityClasses = [
    "product_authority",
    "product_authority_table",
    "thin_guidance",
    "host_projection_anchor",
    "support_registry",
  ];
  const forbiddenClasses = [
    "derived_view",
    "spec_generation_state",
    "audit_evidence_state",
    "operational_local_artifact",
    "nimicoding_managed_projection",
    "candidate_roadmap",
    "lifecycle_progress_state",
    "methodology_authority",
  ];

  if (Array.isArray(inputs.code_roots)) {
    inputs.code_inputs = inputs.code_roots.map((root) => ({
      root,
      owner: "fixture",
      projection_edge_ref: null,
    }));
    delete inputs.code_roots;
  }

  const legacyDocsRoots = Array.isArray(inputs.docs_roots) ? inputs.docs_roots : [];
  if (Array.isArray(inputs.docs_roots)) {
    delete inputs.docs_roots;
  }

  if (Array.isArray(inputs.structure_roots) || legacyDocsRoots.length > 0) {
    const structureRoots = [...new Set([
      ...(Array.isArray(inputs.structure_roots) ? inputs.structure_roots : []),
      ...legacyDocsRoots,
    ])];
    inputs.structure_inputs = structureRoots.map((root) => ({
      root,
      owner: "fixture",
      allowed_surface_classes: authorityClasses,
    }));
    delete inputs.structure_roots;
  }
}

async function writeBlueprintReference(projectRoot, root = "spec") {
  const blueprintReferencePath = path.join(projectRoot, ".nimi", "local", "state", "spec-generation", "blueprint-reference.yaml");
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

  try {
    const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
    bootstrapState.state.blueprint_mode = root === "spec" ? "repo_spec_blueprint" : "custom_blueprint";
    await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");
  } catch {
    // v2 bootstrap records blueprint mode in spec-generation-inputs and the local blueprint reference.
  }
}

async function seedReconstructedTargetTruth(projectRoot) {
  const canonicalFiles = {
    "INDEX.md": "# Project Spec\n\n- Canonical root for project rules.\n",
    "project/kernel/index.md": "# Project Kernel\n\n- Canonical kernel index.\n",
    "project/kernel/core-rules.md": "# Core Rules\n\n- Rule 1: fail closed on authority ambiguity.\n",
    "project/kernel/tables/rule-catalog.yaml": "table_family: product_catalog\nowner: project\ncatalog_id: rule_catalog\nentries:\n  - id: rule-1\n    name: fail_closed_on_authority_ambiguity\n",
    "high-risk-admissions.yaml": "admissions: []\nadmission_rules: []\nsemantic_constraints: []\n",
  };

  for (const [relativePath, contents] of Object.entries(canonicalFiles)) {
    const absolutePath = path.join(projectRoot, ".nimi", "spec", relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
  }

  await mkdir(path.join(projectRoot, ".nimi", "local", "state", "spec-generation"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".nimi", "local", "state", "spec-generation", "spec-generation-audit.yaml"),
    YAML.stringify({
      version: 2,
      contract_ref: ".nimi/contracts/spec-generation-audit.schema.yaml",
      spec_generation_audit: {
        generation_mode: "class_filtered",
        canonical_target_root: ".nimi/spec",
        declared_profile: "surface_taxonomy_v1",
        placement_report_ref: ".nimi/local/state/spec-surface/current-inventory.json",
        input_roots: {
          code_roots: [],
          docs_roots: [".nimi/spec"],
          structure_roots: [],
          human_note_paths: [],
          benchmark_blueprint_root: null,
        },
        files: [
          {
            canonical_path: ".nimi/spec/INDEX.md",
            surface_class: "thin_guidance",
            source_refs: [".nimi/spec/INDEX.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
          {
            canonical_path: ".nimi/spec/project/kernel/index.md",
            surface_class: "product_authority",
            source_refs: [".nimi/spec/INDEX.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
          {
            canonical_path: ".nimi/spec/project/kernel/core-rules.md",
            surface_class: "product_authority",
            source_refs: [".nimi/spec/INDEX.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
          {
            canonical_path: ".nimi/spec/project/kernel/tables/rule-catalog.yaml",
            surface_class: "product_authority_table",
            source_refs: [".nimi/spec/INDEX.md"],
            source_basis: "grounded",
            coverage_status: "complete",
            unresolved_items: [],
            notes: [],
          },
          {
            canonical_path: ".nimi/spec/high-risk-admissions.yaml",
            surface_class: "product_admission_registry",
            source_refs: [".nimi/spec/high-risk-admissions.yaml"],
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
  try {
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
  } catch {
    // v2 host-local bootstrap no longer projects lifecycle state into .nimi/spec.
  }
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
  try {
    const bootstrapState = await readYamlFile(bootstrapStatePath);
    bootstrapState.state.mode = "reconstruction_seeded";
    bootstrapState.state.tree_state = "canonical_tree_ready";
    bootstrapState.state.reconstruction_required = false;
    bootstrapState.status.ready_for_ai_reconstruction = false;
    bootstrapState.cutover_readiness.gate_status.canonical_generation_gate = "ready";
    await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");
  } catch {
    // v2 host-local bootstrap derives readiness from required product authority files.
  }
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

async function seedFrozenAuditSweep(projectRoot, {
  sweepId,
  actionability = "auto-fix",
  severity = "medium",
  findingTitle = "Fixture finding",
} = {}) {
  await mkdir(path.join(projectRoot, "src"), { recursive: true });
  await writeFile(path.join(projectRoot, "src", "service.ts"), "export function service() { return 1; }\n", "utf8");

  assert.equal((await captureRunCli([
    "sweep",
    "audit",
    "plan",
    "--root",
    "src",
    "--sweep-id",
    sweepId,
    "--json",
  ])).exitCode, 0);
  assert.equal((await captureRunCli([
    "sweep",
    "audit",
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
    "sweep",
    "audit",
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
    "sweep",
    "audit",
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
    "sweep",
    "audit",
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

function clusteredAuditFinding({
  file,
  line = 1,
  severity = "high",
  actionability = "auto-fix",
  category = "contract",
  title,
  rootCauseKey,
  repairTarget = "src/service.ts",
  authorityRef = "src/service-contract.md",
}) {
  return {
    severity,
    actionability,
    confidence: "high",
    category,
    impact: `${title} creates a material audit obligation.`,
    location: { file, line, symbol: "service" },
    title,
    description: `${title} needs owner remediation under the clustered audit model.`,
    root_cause: {
      key: rootCauseKey,
      authority_ref: authorityRef,
      evidence_root: "src",
      contract_seam: "service-contract",
      repair_target: repairTarget,
    },
    evidence: {
      summary: `${file} reproduces ${title}.`,
      auditor_reasoning: `${file} is in the audited chunk and the root cause metadata is explicit.`,
    },
  };
}

async function writeAuditEvidence(projectRoot, fileName, chunkId, files, findings) {
  await writeFile(
    path.join(projectRoot, fileName),
    `${JSON.stringify({
      chunk_id: chunkId,
      auditor: { id: "test-auditor", model: "fixture" },
      coverage: { files },
      findings,
    }, null, 2)}\n`,
    "utf8",
  );
}

export {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  os,
  path,
  test,
  assert,
  YAML,
  repoRoot,
  runNativeCodexSdkPrompt,
  createBootstrapSeedFileMap,
  applyFixtureScenario,
  applyScenarioMutations,
  buildSpecReconstructionCloseoutImport,
  loadFixtureManifest,
  materializeFixtureHostOutput,
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
};
