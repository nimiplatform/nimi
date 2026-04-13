import { localize } from "../lib/ui.mjs";
import { loadGovernanceConfig, requireProfile } from "../lib/internal/governance/config.mjs";
import { evaluateAiContextBudget, formatBytes } from "../lib/internal/governance/ai/ai-context-budget-core.mjs";
import { evaluateAiStructureBudget } from "../lib/internal/governance/ai/ai-structure-budget-core.mjs";
import { evaluateHighRiskDocMetadata } from "../lib/internal/governance/ai/check-high-risk-doc-metadata-core.mjs";
import { runAgentsFreshnessCheck } from "../lib/internal/governance/ai/check-agents-freshness.mjs";

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

function formatStructureRow(row) {
  if (row.check === "depth") {
    return `${row.file} [rule=${row.ruleId}] depth=${row.depth} base=${row.depthBase} subject=${row.depthSubject} (threshold warn>=${row.warningDepth} error>=${row.errorDepth})`;
  }
  return `${row.file} [rule=${row.ruleId}] basename=${row.basename} (forwarding shell outside allowed basename set)`;
}

async function runContextBudget(governanceConfig) {
  const report = evaluateAiContextBudget({
    cwd: process.cwd(),
    config: governanceConfig.aiGovernance.contextBudget,
    configPathLabel: ".nimi/config/governance.yaml#ai_governance.context_budget",
  });

  process.stdout.write(`ai-context-budget: config=${report.configPath}\n`);
  process.stdout.write(`ai-context-budget: tracked=${report.totalTrackedFiles}, analyzed=${report.analyzedFiles}\n`);

  for (const row of report.warnings) {
    process.stderr.write(
      `WARN: ${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} (threshold warn lines>=${row.warningLines ?? "-"} bytes>=${row.warningBytes ?? "-"})\n`,
    );
  }
  for (const row of report.waivedErrors) {
    const until = row.waiver?.until ? row.waiver.until.toISOString().slice(0, 10) : "n/a";
    const reason = row.waiver?.reason || "no reason";
    process.stderr.write(
      `WARN: WAIVED error for ${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} until=${until} reason=${reason}\n`,
    );
  }
  for (const row of report.expiredWaivers) {
    process.stderr.write(`ERROR: waiver expired for ${row.file} [${row.profile}] (lines=${row.lines} bytes=${formatBytes(row.bytes)})\n`);
  }
  for (const row of report.invalidWaivers) {
    process.stderr.write(`ERROR: invalid waiver for ${row.file}: ${row.detail}\n`);
  }
  for (const row of report.errors) {
    process.stderr.write(
      `ERROR: ${row.file} [${row.profile}] lines=${row.lines} bytes=${formatBytes(row.bytes)} (threshold error lines>=${row.errorLines ?? "-"} bytes>=${row.errorBytes ?? "-"})\n`,
    );
  }

  if (report.invalidWaivers.length > 0 || report.expiredWaivers.length > 0 || report.errors.length > 0) {
    return 1;
  }

  process.stdout.write("ai-context-budget: OK\n");
  return 0;
}

async function runStructureBudget(governanceConfig) {
  const report = evaluateAiStructureBudget({
    cwd: process.cwd(),
    config: governanceConfig.aiGovernance.structureBudget,
    configPathLabel: ".nimi/config/governance.yaml#ai_governance.structure_budget",
  });

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
  if (report.errors.length > 0 || report.expiredWaivers.length > 0) {
    return 1;
  }

  process.stdout.write("ai-structure-budget: OK\n");
  return 0;
}

async function runHighRiskDocMetadata(governanceConfig) {
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

  if (report.failures.length > 0) {
    process.stderr.write("high-risk doc metadata check failed:\n");
    for (const failure of report.failures) {
      process.stderr.write(`- ${failure}\n`);
    }
    return 1;
  }

  process.stdout.write(`high-risk doc metadata check passed (${report.scanned.length} file(s) scanned)\n`);
  return 0;
}

export async function runValidateAiGovernance(args) {
  const parsed = parseOptions(args);
  if (!parsed.ok) {
    process.stderr.write(localize(parsed.error, parsed.error));
    return 2;
  }

  const governance = await loadGovernanceConfig(process.cwd());
  if (!governance.ok) {
    process.stderr.write(localize(
      `nimicoding validate-ai-governance refused: ${governance.reason} at ${governance.path}.\n`,
      `nimicoding validate-ai-governance 已拒绝：${governance.path} 的治理配置不可用。\n`,
    ));
    return 2;
  }

  const profileCheck = requireProfile(governance.config, parsed.options.profile);
  if (!profileCheck.ok) {
    process.stderr.write(localize(
      `nimicoding validate-ai-governance refused: ${profileCheck.error}.\n`,
      `nimicoding validate-ai-governance 已拒绝：${profileCheck.error}。\n`,
    ));
    return 2;
  }

  const scopes = parsed.options.scope === "all"
    ? ["agents-freshness", "context-budget", "structure-budget", "high-risk-doc-metadata"]
    : [parsed.options.scope];

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
