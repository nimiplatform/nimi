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

  if (scenario.include_blueprint_reference ?? fixture.blueprint_reference.include_by_default) {
    await writeBlueprintReference(projectRoot, fixture.blueprint_reference.root);
  }

  for (const mutation of scenario.mutations ?? []) {
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

    throw new Error(`Unsupported fixture mutation op '${mutation.op}'`);
  }

  return { fixture, scenario };
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

  const verifiedAt = overrides.verifiedAt ?? "2026-04-10T00:00:00.000Z";
  return {
    projectRoot,
    skill: { id: "spec_reconstruction" },
    outcome: overrides.outcome ?? "completed",
    verifiedAt,
    localOnly: true,
    summary: {
      generated_paths: generatedPaths,
      status: overrides.summaryStatus ?? "reconstructed",
      summary: overrides.summaryText ?? "Canonical spec generation completed from the declared mixed inputs.",
      verified_at: verifiedAt,
    },
  };
}
