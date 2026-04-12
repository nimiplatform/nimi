import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

async function copyFixtureTree(repoRoot, projectRoot, fixtureRelativePath, targetRelativePath) {
  const sourcePath = path.join(repoRoot, "test", "fixtures", "spec-generation", fixtureRelativePath);
  const targetPath = path.join(projectRoot, targetRelativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true, force: true });
}

export async function loadFixtureManifest(repoRoot, fixtureId) {
  const manifestPath = path.join(repoRoot, "test", "fixtures", "spec-generation", fixtureId, "fixture.yaml");
  return YAML.parse(await readFile(manifestPath, "utf8")).fixture;
}

export async function applyFixtureScenario({
  repoRoot,
  projectRoot,
  fixtureId,
  scenarioId,
  updateSpecGenerationInputs,
  writeBlueprintReference,
  scenarioOverrides = {},
}) {
  const fixture = await loadFixtureManifest(repoRoot, fixtureId);
  const baseScenario = fixture.scenarios.find((entry) => entry.id === scenarioId);
  if (!baseScenario) {
    throw new Error(`Unknown fixture scenario '${scenarioId}' for fixture '${fixtureId}'`);
  }
  const scenario = {
    ...baseScenario,
    ...scenarioOverrides,
    generation_inputs_overrides: {
      ...(baseScenario.generation_inputs_overrides ?? {}),
      ...(scenarioOverrides.generation_inputs_overrides ?? {}),
    },
    mutations: scenarioOverrides.mutations ?? baseScenario.mutations,
    expected: {
      ...(baseScenario.expected ?? {}),
      ...(scenarioOverrides.expected ?? {}),
    },
  };

  if (scenario.apply_blueprint ?? true) {
    await copyFixtureTree(repoRoot, projectRoot, `${fixtureId}/${fixture.blueprint.source}`, fixture.blueprint.target);
  }

  if (scenario.apply_canonical ?? fixture.canonical.include_by_default) {
    await copyFixtureTree(repoRoot, projectRoot, `${fixtureId}/${fixture.canonical.source}`, fixture.canonical.target);
  }

  for (const input of fixture.inputs) {
    await copyFixtureTree(repoRoot, projectRoot, `${fixtureId}/${input.source}`, input.target);
  }

  await updateSpecGenerationInputs(projectRoot, (inputs) => {
    inputs.code_roots = fixture.generation_inputs.code_roots;
    inputs.docs_roots = fixture.generation_inputs.docs_roots;
    inputs.structure_roots = fixture.generation_inputs.structure_roots;
    inputs.human_note_paths = fixture.generation_inputs.human_note_paths;
    inputs.benchmark_blueprint_root = fixture.generation_inputs.benchmark_blueprint_root;
    inputs.benchmark_mode = fixture.generation_inputs.benchmark_mode;
    inputs.acceptance_mode = fixture.generation_inputs.acceptance_mode;

    for (const [key, value] of Object.entries(scenario.generation_inputs_overrides ?? {})) {
      inputs[key] = value;
    }
  });

  const specGenerationInputsPath = path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml");
  const effectiveGenerationInputs = YAML.parse(await readFile(specGenerationInputsPath, "utf8")).spec_generation_inputs;

  if (fixture.spec_tree_model) {
    const specTreeModelPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-tree-model.yaml");
    const specTreeModelDocument = YAML.parse(await readFile(specTreeModelPath, "utf8"));
    const model = specTreeModelDocument.spec_tree_model;
    model.domains = fixture.spec_tree_model.domains;
    model.required_files = fixture.spec_tree_model.required_files;
    if (fixture.spec_tree_model.generated_pipelines) {
      model.generated_pipelines = fixture.spec_tree_model.generated_pipelines;
    }
    await writeFile(specTreeModelPath, YAML.stringify(specTreeModelDocument), "utf8");
  }

  const auditPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml");
  try {
    const auditDocument = YAML.parse(await readFile(auditPath, "utf8"));
    auditDocument.spec_generation_audit.input_roots.code_roots = effectiveGenerationInputs.code_roots;
    auditDocument.spec_generation_audit.input_roots.docs_roots = effectiveGenerationInputs.docs_roots;
    auditDocument.spec_generation_audit.input_roots.structure_roots = effectiveGenerationInputs.structure_roots;
    auditDocument.spec_generation_audit.input_roots.human_note_paths = effectiveGenerationInputs.human_note_paths;
    auditDocument.spec_generation_audit.input_roots.benchmark_blueprint_root = effectiveGenerationInputs.benchmark_blueprint_root;
    await writeFile(auditPath, YAML.stringify(auditDocument), "utf8");
  } catch {
    // Scenario may intentionally omit the audit artifact before reconstruction output exists.
  }

  if (scenario.include_blueprint_reference ?? fixture.blueprint_reference.include_by_default) {
    await writeBlueprintReference(projectRoot, fixture.blueprint_reference.root);
  }

  await applyScenarioMutations(projectRoot, scenario.mutations ?? []);

  return { fixture, scenario };
}

export async function applyScenarioMutations(projectRoot, mutations = []) {
  for (const mutation of mutations) {
    const targetPath = path.join(projectRoot, mutation.target);
    if (mutation.op === "delete") {
      await rm(targetPath, { recursive: true, force: true });
      continue;
    }

    if (mutation.op === "replace_text") {
      const sourceText = await readFile(targetPath, "utf8");
      await writeFile(targetPath, sourceText.replace(mutation.search, mutation.replace), "utf8");
      continue;
    }

    if (mutation.op === "update_audit_entry") {
      const auditDocument = YAML.parse(await readFile(targetPath, "utf8"));
      const files = Array.isArray(auditDocument?.spec_generation_audit?.files)
        ? auditDocument.spec_generation_audit.files
        : [];
      const entry = files.find((file) => file?.canonical_path === mutation.canonical_path);
      if (!entry) {
        throw new Error(`Audit entry '${mutation.canonical_path}' not found in ${targetPath}`);
      }
      for (const [key, value] of Object.entries(mutation.set ?? {})) {
        entry[key] = value;
      }
      await writeFile(targetPath, YAML.stringify(auditDocument), "utf8");
      continue;
    }

    throw new Error(`Unsupported fixture mutation op '${mutation.op}'`);
  }
}

export async function materializeFixtureHostOutput({
  repoRoot,
  projectRoot,
  fixtureId,
}) {
  const fixture = await loadFixtureManifest(repoRoot, fixtureId);
  if (!fixture.host_output) {
    throw new Error(`Fixture '${fixtureId}' does not declare host_output`);
  }

  const sourceRoot = path.join(repoRoot, "test", "fixtures", "spec-generation", fixtureId, fixture.host_output.source_root);
  for (const file of fixture.host_output.files ?? []) {
    const sourcePath = path.join(sourceRoot, file.source);
    const targetPath = path.join(projectRoot, file.target);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await readFile(sourcePath, "utf8"), "utf8");
  }

  if (fixture.host_output.audit) {
    const auditSourcePath = path.join(sourceRoot, fixture.host_output.audit.source);
    const auditTargetPath = path.join(projectRoot, fixture.host_output.audit.target);
    await mkdir(path.dirname(auditTargetPath), { recursive: true });
    await writeFile(auditTargetPath, await readFile(auditSourcePath, "utf8"), "utf8");

    const specGenerationInputsPath = path.join(projectRoot, ".nimi", "config", "spec-generation-inputs.yaml");
    const effectiveGenerationInputs = YAML.parse(await readFile(specGenerationInputsPath, "utf8")).spec_generation_inputs;
    const auditDocument = YAML.parse(await readFile(auditTargetPath, "utf8"));
    auditDocument.spec_generation_audit.input_roots.code_roots = effectiveGenerationInputs.code_roots;
    auditDocument.spec_generation_audit.input_roots.docs_roots = effectiveGenerationInputs.docs_roots;
    auditDocument.spec_generation_audit.input_roots.structure_roots = effectiveGenerationInputs.structure_roots;
    auditDocument.spec_generation_audit.input_roots.human_note_paths = effectiveGenerationInputs.human_note_paths;
    auditDocument.spec_generation_audit.input_roots.benchmark_blueprint_root = effectiveGenerationInputs.benchmark_blueprint_root;
    await writeFile(auditTargetPath, YAML.stringify(auditDocument), "utf8");
  }
}

async function collectRelativeFiles(rootPath, relativePrefix) {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = path.posix.join(relativePrefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRelativeFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

export async function buildSpecReconstructionCloseoutImport(projectRoot, overrides = {}) {
  const generatedPaths = await collectRelativeFiles(
    path.join(projectRoot, ".nimi", "spec"),
    ".nimi/spec",
  );
  const auditPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-generation-audit.yaml");
  const auditDocument = YAML.parse(await readFile(auditPath, "utf8"));
  const auditEntries = Array.isArray(auditDocument?.spec_generation_audit?.files)
    ? auditDocument.spec_generation_audit.files
    : [];
  const completeFiles = auditEntries.filter((entry) => entry.coverage_status === "complete").length;
  const partialFiles = auditEntries.filter((entry) => entry.coverage_status === "partial").length;
  const placeholderFiles = auditEntries.filter((entry) => entry.coverage_status === "placeholder_not_allowed").length;
  const unresolvedFileCount = auditEntries.filter((entry) => Array.isArray(entry.unresolved_items) && entry.unresolved_items.length > 0).length;
  const inferredFileCount = auditEntries.filter((entry) => (
    entry.source_basis === "inferred" || entry.source_basis === "mixed_grounded_and_inferred"
  )).length;
  const inferredOrUnresolved = partialFiles > 0 || unresolvedFileCount > 0 || inferredFileCount > 0;

  const verifiedAt = overrides.verifiedAt ?? "2026-04-10T00:00:00.000Z";
  return {
    projectRoot,
    skill: { id: "spec_reconstruction" },
    outcome: overrides.outcome ?? "completed",
    verifiedAt,
    localOnly: true,
    summary: {
      generated_paths: generatedPaths,
      audit_ref: ".nimi/spec/_meta/spec-generation-audit.yaml",
      coverage_summary: {
        complete_files: completeFiles,
        partial_files: partialFiles,
        placeholder_files: placeholderFiles,
      },
      unresolved_file_count: unresolvedFileCount,
      inferred_file_count: inferredFileCount,
      status: overrides.summaryStatus ?? (inferredOrUnresolved ? "partial" : "reconstructed"),
      summary: overrides.summaryText ?? (
        inferredOrUnresolved
          ? "Canonical spec generation produced a valid minimal skeleton, but explicit unresolved or inferred areas remain."
          : "Canonical spec generation completed from the declared mixed inputs."
      ),
      verified_at: verifiedAt,
    },
  };
}
