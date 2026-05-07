import { localize } from "../lib/ui.mjs";
import { loadGovernanceConfig, requireProfile } from "../lib/internal/governance/config.mjs";
import { evaluateAiContextBudget, formatBytes } from "../lib/internal/governance/ai/ai-context-budget-core.mjs";
import { evaluateAiStructureBudget } from "../lib/internal/governance/ai/ai-structure-budget-core.mjs";
import { evaluateHighRiskDocMetadata } from "../lib/internal/governance/ai/check-high-risk-doc-metadata-core.mjs";
import {
  evaluateAgentsFreshnessCheck,
  runAgentsFreshnessCheck,
} from "../lib/internal/governance/ai/check-agents-freshness.mjs";

const SCOPES = new Set([
  "agents-freshness",
  "context-budget",
  "structure-budget",
  "high-risk-doc-metadata",
]);

function parseOptions(args) {
  const options = {
    profile: null,
    scope: "all",
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--profile") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "nimicoding validate-ai-governance refused: --profile requires a value.\n" };
      }
      options.profile = value;
      index += 1;
      continue;
    }

    if (arg === "--scope") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "nimicoding validate-ai-governance refused: --scope requires a value.\n" };
      }
      options.scope = value;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    return {
      ok: false,
      error: `nimicoding validate-ai-governance refused: unknown option ${arg}.\n`,
    };
  }

  if (options.scope !== "all" && !SCOPES.has(options.scope)) {
    return {
      ok: false,
      error: `nimicoding validate-ai-governance refused: unsupported --scope value ${options.scope}.\n`,
    };
  }

  return { ok: true, options };
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function buildContextBudgetReport(governanceConfig) {
  const report = evaluateAiContextBudget({
    cwd: process.cwd(),
    config: governanceConfig.aiGovernance.contextBudget,
    configPathLabel: ".nimi/config/governance.yaml#ai_governance.context_budget",
  });
  const exitCode = report.invalidWaivers.length > 0 || report.expiredWaivers.length > 0 || report.errors.length > 0
    ? 1
    : 0;
  return { exitCode, report };
}

function buildStructureBudgetReport(governanceConfig) {
  const report = evaluateAiStructureBudget({
    cwd: process.cwd(),
    config: governanceConfig.aiGovernance.structureBudget,
    configPathLabel: ".nimi/config/governance.yaml#ai_governance.structure_budget",
  });
  const exitCode = report.errors.length > 0 || report.expiredWaivers.length > 0 ? 1 : 0;
  return { exitCode, report };
}

function buildHighRiskDocMetadataReport(governanceConfig) {
  const config = governanceConfig.aiGovernance.highRiskDocMetadata;
  const report = evaluateHighRiskDocMetadata({
    repoRoot: process.cwd(),
    docRoots: Array.isArray(config.doc_roots) ? config.doc_roots : [".local"],
    exemptPaths: Array.isArray(config.exempt_paths) ? config.exempt_paths : [],
    namePatterns: Array.isArray(config.name_patterns) ? config.name_patterns : [],
    requiredMetadataKeys: Array.isArray(config.required_metadata_keys)
      ? config.required_metadata_keys
      : [],
  });
  return {
    exitCode: report.failures.length > 0 ? 1 : 0,
    report: {
      ...report,
      exemptPaths: [...report.exemptPaths],
    },
  };
}

function buildAgentsFreshnessReport(governanceConfig) {
  const report = evaluateAgentsFreshnessCheck({
    projectRoot: process.cwd(),
    config: governanceConfig.aiGovernance.agentsFreshness,
  });
  return {
    exitCode: report.failures.length > 0 ? 1 : 0,
    report,
  };
}

function formatStructureRow(row) {
  if (row.check === "depth") {
    return `${row.file} [rule=${row.ruleId}] depth=${row.depth} base=${row.depthBase} subject=${row.depthSubject} (threshold warn>=${row.warningDepth} error>=${row.errorDepth})`;
  }
  return `${row.file} [rule=${row.ruleId}] basename=${row.basename} (forwarding shell outside allowed basename set)`;
}

function formatContextBudgetRow(row, thresholdPrefix) {
  return `${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} max-line=${formatBytes(row.maxLineBytes)} avg-line=${formatBytes(Math.round(row.averageLineBytes))} `
    + `(${thresholdPrefix} lines>=${row[`${thresholdPrefix}Lines`] ?? "-"} bytes>=${row[`${thresholdPrefix}Bytes`] ?? "-"} max-line>=${row[`${thresholdPrefix}MaxLineBytes`] ?? "-"} avg-line>=${row[`${thresholdPrefix}AverageLineBytes`] ?? "-"})`;
}

async function runContextBudget(governanceConfig) {
  const { exitCode, report } = buildContextBudgetReport(governanceConfig);

  process.stdout.write(`ai-context-budget: config=${report.configPath}\n`);
  process.stdout.write(`ai-context-budget: tracked=${report.totalTrackedFiles}, analyzed=${report.analyzedFiles}\n`);

  for (const row of report.warnings) {
    process.stderr.write(`WARN: ${formatContextBudgetRow(row, "warning")}\n`);
  }
  for (const row of report.waivedErrors) {
    const until = row.waiver?.until ? row.waiver.until.toISOString().slice(0, 10) : "n/a";
    const reason = row.waiver?.reason || "no reason";
    process.stderr.write(`WARN: WAIVED error for ${formatContextBudgetRow(row, "error")} until=${until} reason=${reason}\n`);
  }
  for (const row of report.expiredWaivers) {
    process.stderr.write(`ERROR: waiver expired for ${formatContextBudgetRow(row, "error")}\n`);
  }
  for (const row of report.invalidWaivers) {
    process.stderr.write(`ERROR: invalid waiver for ${row.file}: ${row.detail}\n`);
  }
  for (const row of report.errors) {
    process.stderr.write(`ERROR: ${formatContextBudgetRow(row, "error")}\n`);
  }

  if (exitCode !== 0) {
    return exitCode;
  }

  process.stdout.write("ai-context-budget: OK\n");
  return 0;
}

async function runStructureBudget(governanceConfig) {
  const { exitCode, report } = buildStructureBudgetReport(governanceConfig);

  process.stdout.write(`ai-structure-budget: config=${report.configPath}\n`);
  process.stdout.write(`ai-structure-budget: tracked=${report.totalTrackedFiles}, analyzed=${report.analyzedFiles}\n`);
  for (const row of report.warnings) {
    process.stderr.write(`WARN: ${formatStructureRow(row)}\n`);
  }
  for (const row of report.waivedErrors) {
    const until = row.waiver?.untilDate ? row.waiver.untilDate.toISOString().slice(0, 10) : "n/a";
    const reason = row.waiver?.reason || "no reason";
    process.stderr.write(`WARN: WAIVED error for ${formatStructureRow(row)} until=${until} reason=${reason}\n`);
  }
  for (const row of report.expiredWaivers) {
    process.stderr.write(`ERROR: expired waiver for ${formatStructureRow(row)}\n`);
  }
  for (const row of report.errors) {
    process.stderr.write(`ERROR: ${formatStructureRow(row)}\n`);
  }
  if (exitCode !== 0) {
    return exitCode;
  }

  process.stdout.write("ai-structure-budget: OK\n");
  return 0;
}

async function runHighRiskDocMetadata(governanceConfig) {
  const { exitCode, report } = buildHighRiskDocMetadataReport(governanceConfig);

  if (exitCode !== 0) {
    process.stderr.write("high-risk doc metadata check failed:\n");
    for (const failure of report.failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    return exitCode;
  }

  process.stdout.write(`high-risk doc metadata check passed (${report.scanned.length} file(s) scanned)\n`);
  return 0;
}

function runJsonScope(governanceConfig, scope) {
  if (scope === "agents-freshness") {
    return buildAgentsFreshnessReport(governanceConfig);
  }
  if (scope === "context-budget") {
    return buildContextBudgetReport(governanceConfig);
  }
  if (scope === "structure-budget") {
    return buildStructureBudgetReport(governanceConfig);
  }
  if (scope === "high-risk-doc-metadata") {
    return buildHighRiskDocMetadataReport(governanceConfig);
  }
  return {
    exitCode: 2,
    report: { error: `unsupported scope: ${scope}` },
  };
}

export async function runValidateAiGovernance(args) {
  const wantsJson = args.includes("--json");
  const parsed = parseOptions(args);
  if (!parsed.ok) {
    if (wantsJson) {
      writeJson({
        ok: false,
        command: "validate-ai-governance",
        error: parsed.error.trim(),
      });
    } else {
      process.stderr.write(localize(parsed.error, parsed.error));
    }
    return 2;
  }

  const governance = await loadGovernanceConfig(process.cwd());
  if (!governance.ok) {
    const error = `nimicoding validate-ai-governance refused: ${governance.reason} at ${governance.path}.`;
    if (parsed.options.json) {
      writeJson({
        ok: false,
        command: "validate-ai-governance",
        error,
        governancePath: governance.path,
      });
    } else {
      process.stderr.write(localize(
        `${error}\n`,
        `nimicoding validate-ai-governance 已拒绝：${governance.path} 的治理配置不可用。\n`,
      ));
    }
    return 2;
  }

  const profileCheck = requireProfile(governance.config, parsed.options.profile);
  if (!profileCheck.ok) {
    const error = `nimicoding validate-ai-governance refused: ${profileCheck.error}.`;
    if (parsed.options.json) {
      writeJson({
        ok: false,
        command: "validate-ai-governance",
        error,
        profile: profileCheck.profile,
      });
    } else {
      process.stderr.write(localize(
        `${error}\n`,
        `nimicoding validate-ai-governance 已拒绝：${profileCheck.error}。\n`,
      ));
    }
    return 2;
  }

  const scopes = parsed.options.scope === "all"
    ? ["agents-freshness", "context-budget", "structure-budget", "high-risk-doc-metadata"]
    : [parsed.options.scope];

  if (parsed.options.json) {
    const results = [];
    let exitCode = 0;
    for (const scope of scopes) {
      const result = runJsonScope(governance.config, scope);
      if (exitCode === 0 && result.exitCode !== 0) {
        exitCode = result.exitCode;
      }
      results.push({
        scope,
        ok: result.exitCode === 0,
        exitCode: result.exitCode,
        report: result.report,
      });
    }
    writeJson({
      ok: exitCode === 0,
      command: "validate-ai-governance",
      profile: profileCheck.profile,
      scope: parsed.options.scope,
      scopes: results,
    });
    return exitCode;
  }

  for (const scope of scopes) {
    let exitCode = 0;
    if (scope === "agents-freshness") {
      exitCode = runAgentsFreshnessCheck({
        projectRoot: process.cwd(),
        config: governance.config.aiGovernance.agentsFreshness,
      });
    } else if (scope === "context-budget") {
      exitCode = await runContextBudget(governance.config);
    } else if (scope === "structure-budget") {
      exitCode = await runStructureBudget(governance.config);
    } else if (scope === "high-risk-doc-metadata") {
      exitCode = await runHighRiskDocMetadata(governance.config);
    }

    if (exitCode !== 0) {
      return exitCode;
    }
  }

  return 0;
}
