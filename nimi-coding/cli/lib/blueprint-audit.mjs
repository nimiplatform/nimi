import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { loadBlueprintReference, loadSpecGenerationInputsConfig, loadSpecTreeModelContract } from "./contracts.mjs";
import { pathExists } from "./fs-helpers.mjs";
import {
  localize,
  styleHeading,
  styleLabel,
  styleStatus,
} from "./ui.mjs";

const BLUEPRINT_AUDIT_CONTRACT_VERSION = "nimicoding.blueprint-audit.v1";
const DEFAULT_REPORT_PATH = ".nimi/local/report/blueprint-equivalence-audit.json";

async function collectFiles(rootPath, relativePrefix = "") {
  const info = await pathExists(rootPath);
  if (!info || !info.isDirectory()) {
    return [];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const collected = [];
  for (const entry of entries) {
    const absoluteChildPath = path.join(rootPath, entry.name);
    const relativeChildPath = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      collected.push(...await collectFiles(absoluteChildPath, relativeChildPath));
    } else if (entry.isFile()) {
      collected.push(relativeChildPath.split(path.sep).join(path.posix.sep));
    }
  }

  return collected.sort();
}

async function collectDomainInventory(rootPath) {
  const info = await pathExists(rootPath);
  if (!info || !info.isDirectory()) {
    return {
      domains: [],
      hasIndex: false,
      files: [],
    };
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const domains = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const kernelPath = path.join(rootPath, entry.name, "kernel");
    const kernelInfo = await pathExists(kernelPath);
    if (kernelInfo?.isDirectory()) {
      domains.push(entry.name);
    }
  }

  const indexInfo = await pathExists(path.join(rootPath, "INDEX.md"));
  const files = await collectFiles(rootPath);

  return {
    domains: domains.sort(),
    hasIndex: Boolean(indexInfo?.isFile()),
    files,
  };
}

function categorizeBlueprintFiles(files) {
  const kernelMarkdown = [];
  const kernelTables = [];
  const kernelGenerated = [];
  const domainGuides = [];

  for (const relativePath of files) {
    if (/^([^/]+)\/kernel\/[^/]+\.md$/.test(relativePath)) {
      kernelMarkdown.push(relativePath);
      continue;
    }

    if (/^([^/]+)\/kernel\/tables\/.+\.(ya?ml)$/.test(relativePath)) {
      kernelTables.push(relativePath);
      continue;
    }

    if (/^([^/]+)\/kernel\/generated\/.+\.md$/.test(relativePath)) {
      kernelGenerated.push(relativePath);
      continue;
    }

    if (/^[^/]+\/[^/]+\.md$/.test(relativePath)) {
      domainGuides.push(relativePath);
    }
  }

  return {
    kernelMarkdown,
    kernelTables,
    kernelGenerated,
    domainGuides,
  };
}

function compareFileSets(blueprintFiles, canonicalFiles) {
  const canonicalSet = new Set(canonicalFiles);
  const blueprintSet = new Set(blueprintFiles);

  return {
    present: blueprintFiles.filter((filePath) => canonicalSet.has(filePath)),
    missing: blueprintFiles.filter((filePath) => !canonicalSet.has(filePath)),
    extra: canonicalFiles.filter((filePath) => !blueprintSet.has(filePath)),
  };
}

function buildSummarySection(compareResult) {
  return {
    present: compareResult.present.length,
    missing: compareResult.missing.length,
    extra: compareResult.extra.length,
  };
}

function collectIds(value, ids = []) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectIds(entry, ids);
    }
    return ids;
  }

  if (value && typeof value === "object") {
    if (typeof value.id === "string") {
      ids.push(value.id);
    }
    for (const nestedValue of Object.values(value)) {
      collectIds(nestedValue, ids);
    }
  }

  return ids;
}

async function compareRuleIds(blueprintAbsoluteRoot, canonicalAbsoluteRoot, presentTablePaths) {
  const files = [];
  const aggregateMissing = new Set();
  const aggregateExtra = new Set();
  const parseErrors = [];

  for (const relativePath of presentTablePaths) {
    try {
      const blueprintText = await readFile(path.join(blueprintAbsoluteRoot, relativePath), "utf8");
      const canonicalText = await readFile(path.join(canonicalAbsoluteRoot, relativePath), "utf8");
      const blueprintIds = Array.from(new Set(collectIds(YAML.parse(blueprintText)))).sort();
      const canonicalIds = Array.from(new Set(collectIds(YAML.parse(canonicalText)))).sort();
      const missingIds = blueprintIds.filter((entry) => !canonicalIds.includes(entry));
      const extraIds = canonicalIds.filter((entry) => !blueprintIds.includes(entry));

      missingIds.forEach((entry) => aggregateMissing.add(entry));
      extraIds.forEach((entry) => aggregateExtra.add(entry));

      files.push({
        path: relativePath,
        blueprintIds: blueprintIds.length,
        canonicalIds: canonicalIds.length,
        missingIds,
        extraIds,
      });
    } catch (error) {
      parseErrors.push({
        path: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    comparedFiles: files.length,
    files,
    parseErrors,
    missingRuleIds: Array.from(aggregateMissing).sort(),
    extraRuleIds: Array.from(aggregateExtra).sort(),
  };
}

export async function buildBlueprintAuditPayload(projectRoot, options = {}) {
  const specTreeModel = await loadSpecTreeModelContract(projectRoot);
  const blueprintReference = await loadBlueprintReference(projectRoot);
  const specGenerationInputs = await loadSpecGenerationInputsConfig(projectRoot);

  const canonicalRoot = options.canonicalRoot
    ?? specTreeModel.canonicalRoot
    ?? ".nimi/spec";
  const blueprintRoot = options.blueprintRoot
    ?? blueprintReference.root
    ?? specGenerationInputs.benchmarkBlueprintRoot
    ?? null;

  if (!blueprintRoot) {
    return {
      ok: false,
      exitCode: 2,
      inputError: true,
      error: `${localize(
        "nimicoding blueprint-audit refused: no blueprint root is declared; pass --blueprint-root or add project-local blueprint reference metadata.",
        "nimicoding blueprint-audit 已拒绝：没有声明 blueprint root；请传入 --blueprint-root，或补充项目本地 blueprint reference 元数据。",
      )}\n`,
    };
  }

  const blueprintAbsoluteRoot = path.resolve(projectRoot, blueprintRoot);
  const canonicalAbsoluteRoot = path.resolve(projectRoot, canonicalRoot);
  const blueprintInventory = await collectDomainInventory(blueprintAbsoluteRoot);
  const canonicalInventory = await collectDomainInventory(canonicalAbsoluteRoot);

  const missingDomains = blueprintInventory.domains.filter((domainId) => !canonicalInventory.domains.includes(domainId));
  const extraDomains = canonicalInventory.domains.filter((domainId) => !blueprintInventory.domains.includes(domainId));
  const blueprintFiles = categorizeBlueprintFiles(blueprintInventory.files);
  const canonicalFiles = categorizeBlueprintFiles(canonicalInventory.files);

  const kernelMarkdown = compareFileSets(blueprintFiles.kernelMarkdown, canonicalFiles.kernelMarkdown);
  const kernelTables = compareFileSets(blueprintFiles.kernelTables, canonicalFiles.kernelTables);
  const kernelGenerated = compareFileSets(blueprintFiles.kernelGenerated, canonicalFiles.kernelGenerated);
  const domainGuides = compareFileSets(blueprintFiles.domainGuides, canonicalFiles.domainGuides);
  const ruleIdPreservation = await compareRuleIds(
    blueprintAbsoluteRoot,
    canonicalAbsoluteRoot,
    kernelTables.present,
  );

  const indexPresent = blueprintInventory.hasIndex ? canonicalInventory.hasIndex : true;
  const ok = missingDomains.length === 0
    && kernelMarkdown.missing.length === 0
    && kernelTables.missing.length === 0
    && kernelGenerated.missing.length === 0
    && domainGuides.missing.length === 0
    && ruleIdPreservation.missingRuleIds.length === 0
    && ruleIdPreservation.parseErrors.length === 0
    && indexPresent;

  const reportPath = path.join(projectRoot, DEFAULT_REPORT_PATH);
  const nextSteps = [];
  if (missingDomains.length > 0 || kernelMarkdown.missing.length > 0 || kernelTables.missing.length > 0 || !indexPresent) {
    nextSteps.push("Copy the missing blueprint structure into `/.nimi/spec/**` before attempting authority cutover.");
  }
  if (kernelGenerated.missing.length > 0) {
    nextSteps.push("Regenerate derived kernel docs after canonical blueprint content is built out.");
  }
  if (domainGuides.missing.length > 0) {
    nextSteps.push("Thin and map domain guides only after kernel coverage is in place.");
  }
  if (ruleIdPreservation.missingRuleIds.length > 0 || ruleIdPreservation.parseErrors.length > 0) {
    nextSteps.push("Preserve benchmark rule IDs in canonical kernel tables before treating the canonical tree as benchmark-equivalent.");
  }

  return {
    contractVersion: BLUEPRINT_AUDIT_CONTRACT_VERSION,
    ok,
    exitCode: ok ? 0 : 1,
    projectRoot,
    blueprintRoot,
    canonicalRoot,
    blueprintReference,
    specTreeModel: {
      ok: specTreeModel.ok,
      profile: specTreeModel.profile,
      canonicalRoot: specTreeModel.canonicalRoot,
      authorityMode: specTreeModel.authorityMode,
    },
    specGenerationInputs: {
      ok: specGenerationInputs.ok,
      mode: specGenerationInputs.mode,
      acceptanceMode: specGenerationInputs.acceptanceMode,
      benchmarkBlueprintRoot: specGenerationInputs.benchmarkBlueprintRoot,
    },
    inventory: {
      blueprintDomains: blueprintInventory.domains,
      canonicalDomains: canonicalInventory.domains,
      missingDomains,
      extraDomains,
      indexPresent,
    },
    comparison: {
      kernelMarkdown: {
        ...buildSummarySection(kernelMarkdown),
        missingPaths: kernelMarkdown.missing,
      },
      kernelTables: {
        ...buildSummarySection(kernelTables),
        missingPaths: kernelTables.missing,
      },
      kernelGenerated: {
        ...buildSummarySection(kernelGenerated),
        missingPaths: kernelGenerated.missing,
      },
      domainGuides: {
        ...buildSummarySection(domainGuides),
        missingPaths: domainGuides.missing,
      },
    },
    structuralGaps: {
      missingDomains,
      missingKernelMarkdown: kernelMarkdown.missing,
      missingKernelTables: kernelTables.missing,
      indexMissing: !indexPresent,
    },
    semanticMappingGaps: {
      ruleIdPreservation,
    },
    derivedViewGaps: {
      missingKernelGenerated: kernelGenerated.missing,
      missingDomainGuides: domainGuides.missing,
    },
    artifactPath: reportPath,
    nextSteps,
  };
}

export function formatBlueprintAuditPayload(payload) {
  const lines = [
    styleHeading(`nimicoding blueprint-audit: ${payload.projectRoot}`),
    "",
    styleLabel(localize("Summary:", "摘要：")),
    `  - ${localize("status", "状态")}: ${styleStatus(payload.ok ? "ok" : "needs_attention")}`,
    `  - ${localize("blueprint root", "blueprint root")}: ${payload.blueprintRoot}`,
    `  - ${localize("canonical root", "canonical root")}: ${payload.canonicalRoot}`,
    `  - ${localize("missing domains", "缺失域")}: ${payload.inventory.missingDomains.length}`,
    `  - ${localize("kernel markdown missing", "缺失 kernel markdown")}: ${payload.comparison.kernelMarkdown.missing}`,
    `  - ${localize("kernel tables missing", "缺失 kernel tables")}: ${payload.comparison.kernelTables.missing}`,
    `  - ${localize("generated views missing", "缺失 generated 视图")}: ${payload.comparison.kernelGenerated.missing}`,
    `  - ${localize("guide mappings missing", "缺失 guide 映射")}: ${payload.comparison.domainGuides.missing}`,
    `  - ${localize("rule ids missing", "缺失 rule id")}: ${payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.length}`,
    "",
    styleLabel(localize("Coverage:", "覆盖情况：")),
    `  - ${localize("blueprint domains", "blueprint 域")}: ${payload.inventory.blueprintDomains.length}`,
    `  - ${localize("canonical domains", "canonical 域")}: ${payload.inventory.canonicalDomains.length}`,
    `  - ${localize("INDEX present", "INDEX 已存在")}: ${payload.inventory.indexPresent ? "true" : "false"}`,
  ];

  if (payload.inventory.missingDomains.length > 0) {
    lines.push(`  - ${localize("missing domain ids", "缺失域 ID")}: ${payload.inventory.missingDomains.join(", ")}`);
  }

  if (payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.length > 0) {
    lines.push(`  - ${localize("missing rule ids", "缺失 rule id")}: ${payload.semanticMappingGaps.ruleIdPreservation.missingRuleIds.join(", ")}`);
  }

  if (payload.semanticMappingGaps.ruleIdPreservation.parseErrors.length > 0) {
    lines.push(`  - ${localize("rule-id parse errors", "rule-id 解析错误")}: ${payload.semanticMappingGaps.ruleIdPreservation.parseErrors.length}`);
  }

  if (payload.nextSteps.length > 0) {
    lines.push("", styleLabel(localize("Next:", "下一步：")));
    for (const step of payload.nextSteps) {
      lines.push(`  - ${localize(step, step)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function writeBlueprintAuditArtifact(projectRoot, payload) {
  await mkdir(path.dirname(payload.artifactPath), { recursive: true });
  await writeFile(payload.artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    jsonRef: path.relative(projectRoot, payload.artifactPath).split(path.sep).join(path.posix.sep),
  };
}
