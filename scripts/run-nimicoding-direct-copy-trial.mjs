#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import YAML from "yaml";

const repoRoot = process.cwd();
const nimicodingBin = path.join(repoRoot, "nimi-coding", "bin", "nimicoding.mjs");
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const trialRoot = path.join(repoRoot, ".nimi", "local", "direct-copy-trial", timestamp);
const projectRoot = path.join(trialRoot, "project");
const latestReportPath = path.join(repoRoot, ".nimi", "local", "report", "direct-copy-trial.latest.json");
const reportPath = path.join(trialRoot, "direct-copy-trial.json");

function runNimicoding(args, cwd) {
  const result = spawnSync(process.execPath, [nimicodingBin, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    exitCode: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

async function pathIsDirectory(targetPath) {
  try {
    const entries = await readdir(targetPath);
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

async function collectSpecDomains(sourceRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const domains = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const kernelRoot = path.join(sourceRoot, entry.name, "kernel");
    if (!(await pathIsDirectory(kernelRoot))) {
      continue;
    }

    const generatedRoot = path.join(kernelRoot, "generated");
    domains.push({
      id: entry.name,
      root: `.nimi/spec/${entry.name}`,
      normative_root: `.nimi/spec/${entry.name}/kernel`,
      tables_root: `.nimi/spec/${entry.name}/kernel/tables`,
      ...(await pathIsDirectory(generatedRoot)
        ? { generated_root: `.nimi/spec/${entry.name}/kernel/generated` }
        : {}),
      guide_paths: [],
    });
  }

  return domains.sort((left, right) => left.id.localeCompare(right.id));
}

async function collectRequiredFiles(sourceRoot) {
  const required = [
    ".nimi/spec/INDEX.md",
    ".nimi/spec/_meta/spec-tree-model.yaml",
  ];

  async function walk(currentPath, relativePath = "") {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const childAbsolutePath = path.join(currentPath, entry.name);
      const childRelativePath = relativePath
        ? path.posix.join(relativePath, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        await walk(childAbsolutePath, childRelativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (/^[^/]+\/kernel\/[^/]+\.md$/.test(childRelativePath)
        || /^[^/]+\/kernel\/tables\/.+\.(ya?ml)$/.test(childRelativePath)) {
        required.push(`.nimi/spec/${childRelativePath}`);
      }
    }
  }

  await walk(sourceRoot);
  return Array.from(new Set(required)).sort();
}

async function collectDomainSidecarYamlPaths(sourceRoot) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const sidecars = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const domainRoot = path.join(sourceRoot, entry.name);
    const domainEntries = await readdir(domainRoot, { withFileTypes: true });
    for (const domainEntry of domainEntries) {
      if (!domainEntry.isFile()) {
        continue;
      }

      if (!/\.(ya?ml)$/.test(domainEntry.name)) {
        continue;
      }

      sidecars.push(`.nimi/spec/${entry.name}/${domainEntry.name}`);
    }
  }

  return sidecars.sort();
}

async function configureRepoSpecificSpecTreeModel() {
  const specTreeModelPath = path.join(projectRoot, ".nimi", "spec", "_meta", "spec-tree-model.yaml");
  const sourceSpecRoot = path.join(repoRoot, "spec");
  const specTreeModelDocument = YAML.parse(await readFile(specTreeModelPath, "utf8"));
  const model = specTreeModelDocument.spec_tree_model;
  const domains = await collectSpecDomains(sourceSpecRoot);
  const requiredFiles = await collectRequiredFiles(sourceSpecRoot);
  const domainSidecarYamlPaths = await collectDomainSidecarYamlPaths(sourceSpecRoot);

  model.profile = "mature";
  model.domains = domains;
  model.required_files = {
    minimal: requiredFiles,
    standard: requiredFiles,
    mature: requiredFiles,
  };
  if (domainSidecarYamlPaths.length > 0) {
    model.guidance_classes = [
      ...(model.guidance_classes ?? []).filter((entry) => entry.id !== "domain_sidecar_yaml"),
      {
        id: "domain_sidecar_yaml",
        path_patterns: domainSidecarYamlPaths,
        excluded_path_patterns: [],
        must_reference_normative_ids: false,
        normative: false,
      },
    ];
  }

  await writeFile(specTreeModelPath, YAML.stringify(specTreeModelDocument), "utf8");
}

async function writeBlueprintReference() {
  const blueprintReferencePath = path.join(projectRoot, ".nimi", "spec", "_meta", "blueprint-reference.yaml");
  const bootstrapStatePath = path.join(projectRoot, ".nimi", "spec", "bootstrap-state.yaml");
  await mkdir(path.dirname(blueprintReferencePath), { recursive: true });
  await writeFile(
    blueprintReferencePath,
    YAML.stringify({
      version: 1,
      blueprint_reference: {
        mode: "repo_spec_blueprint",
        root: "spec",
        canonical_target_root: ".nimi/spec",
        equivalence_contract_ref: ".nimi/spec/_meta/direct-copy-validation-checklist.yaml",
      },
    }),
    "utf8",
  );

  const bootstrapState = YAML.parse(await readFile(bootstrapStatePath, "utf8"));
  bootstrapState.state.blueprint_mode = "repo_spec_blueprint";
  await writeFile(bootstrapStatePath, YAML.stringify(bootstrapState), "utf8");
}

async function main() {
  await mkdir(projectRoot, { recursive: true });

  const startResult = runNimicoding(["start", "--yes"], projectRoot);
  if (startResult.exitCode !== 0) {
    process.stderr.write(startResult.stderr || startResult.stdout);
    process.exit(startResult.exitCode);
  }

  await writeBlueprintReference();
  await configureRepoSpecificSpecTreeModel();

  await cp(path.join(repoRoot, "spec"), path.join(projectRoot, "spec"), {
    recursive: true,
    force: true,
  });
  await cp(path.join(repoRoot, "spec"), path.join(projectRoot, ".nimi", "spec"), {
    recursive: true,
    force: true,
  });

  const validateSpecTreeResult = runNimicoding(["validate-spec-tree"], projectRoot);
  const blueprintAuditResult = runNimicoding(["blueprint-audit", "--json", "--write-local"], projectRoot);

  const summary = {
    contract: "nimicoding.direct-copy-trial.v1",
    ok: validateSpecTreeResult.exitCode === 0 && blueprintAuditResult.exitCode === 0,
    project_root: projectRoot,
    benchmark_root: path.join(projectRoot, "spec"),
    canonical_root: path.join(projectRoot, ".nimi", "spec"),
    validate_spec_tree: {
      exit_code: validateSpecTreeResult.exitCode,
      stdout: validateSpecTreeResult.stdout,
      stderr: validateSpecTreeResult.stderr,
    },
    blueprint_audit: {
      exit_code: blueprintAuditResult.exitCode,
      stdout: blueprintAuditResult.stdout,
      stderr: blueprintAuditResult.stderr,
    },
    local_audit_report: path.join(projectRoot, ".nimi", "local", "report", "blueprint-equivalence-audit.json"),
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(latestReportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(latestReportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  process.stdout.write([
    `nimicoding direct-copy trial: ${summary.ok ? "ok" : "failed"}`,
    `trial project: ${projectRoot}`,
    `summary report: ${reportPath}`,
    `latest report: ${latestReportPath}`,
    `validate-spec-tree exit: ${validateSpecTreeResult.exitCode}`,
    `blueprint-audit exit: ${blueprintAuditResult.exitCode}`,
  ].join("\n"));
  process.stdout.write("\n");

  process.exit(summary.ok ? 0 : 1);
}

await main();
