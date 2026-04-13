import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_TARGETS = [
  { rel: "AGENTS.md", maxLines: 100 },
  { rel: "nimi-backend/AGENTS.md", maxLines: 80 },
  { rel: "nimi-dashboard/AGENTS.md", maxLines: 65 },
  { rel: ".nimi/spec/AGENTS.md", maxLines: 70 },
  { rel: "scripts/AGENTS.md", maxLines: 45 },
  { rel: "tests/AGENTS.md", maxLines: 35 },
];

const DEFAULT_REQUIRED_SECTIONS = [
  "## Scope",
  "## Hard Boundaries",
  "## Retrieval Defaults",
  "## Verification Commands",
];

const DEFAULT_STALE_TOKENS = ["AISC-", "R-WORLD-", "R-AGENT-", "SOCIAL-013", "ECON-014"];

const GENERIC_PNPM_COMMANDS = new Set([
  "install",
  "test",
  "build",
  "typecheck",
  "lint",
  "dev",
  "preview",
  "check",
  "verify",
  "exec",
  "run",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectKnownPnpmScripts(projectRoot) {
  const rootPkg = readJson(path.join(projectRoot, "package.json"));
  const scripts = new Set(Object.keys(rootPkg.scripts || {}));

  for (const rel of ["nimi-backend/package.json", "nimi-dashboard/package.json"]) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const pkg = readJson(abs);
    for (const name of Object.keys(pkg.scripts || {})) {
      scripts.add(name);
    }
  }

  return scripts;
}

function validatePnpmCommand(command, knownScripts, failures, relPath) {
  const tokens = command.trim().split(/\s+/u);
  if (tokens[0] !== "pnpm") return;

  let index = 1;
  while (tokens[index]?.startsWith("--")) {
    index += tokens[index]?.includes("=") ? 1 : 2;
  }

  const subcommand = String(tokens[index] || "").trim();
  if (!subcommand || GENERIC_PNPM_COMMANDS.has(subcommand) || knownScripts.has(subcommand)) {
    return;
  }

  failures.push(`${relPath}: unknown pnpm command: ${command}`);
}

function validatePathToken(token, failures, relPath, agentsDir, projectRoot) {
  if (token.includes(" ")) return;
  if (!token.includes("/")) return;
  if (
    token.startsWith("http") ||
    token.startsWith("@") ||
    token.includes("*") ||
    token.includes("{")
  ) {
    return;
  }

  const cleaned = token.replace(/[`,.;:()]+$/gu, "").replace(/^[(]+/u, "");
  if (!cleaned || cleaned.startsWith("$") || cleaned.endsWith("/")) return;
  if (cleaned.startsWith("nimi/")) return;

  const absFromAgents = path.join(agentsDir, cleaned);
  const absFromRoot = path.join(projectRoot, cleaned);
  if (!fs.existsSync(absFromAgents) && !fs.existsSync(absFromRoot)) {
    failures.push(`${relPath}: stale path reference: ${cleaned}`);
  }
}

export function runAgentsFreshnessCheck(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const config = options.config || {};
  const targets = Array.isArray(config.targets) && config.targets.length > 0
    ? config.targets
    : DEFAULT_TARGETS;
  const requiredSections = Array.isArray(config.requiredSections) && config.requiredSections.length > 0
    ? config.requiredSections
    : DEFAULT_REQUIRED_SECTIONS;
  const staleTokens = Array.isArray(config.staleTokens) && config.staleTokens.length > 0
    ? config.staleTokens
    : DEFAULT_STALE_TOKENS;

  const failures = [];
  const knownScripts = collectKnownPnpmScripts(projectRoot);

  for (const target of targets) {
    const abs = path.join(projectRoot, target.rel);
    if (!fs.existsSync(abs)) {
      failures.push(`missing AGENTS file: ${target.rel}`);
      continue;
    }

    const content = fs.readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/u);
    if (Number(target.maxLines) > 0 && lines.length > Number(target.maxLines)) {
      failures.push(`${target.rel}: exceeds line budget (${lines.length} > ${target.maxLines})`);
    }

    for (const section of requiredSections) {
      if (!content.includes(section)) {
        failures.push(`${target.rel}: missing required section ${section}`);
      }
    }

    for (const token of staleTokens) {
      if (content.includes(token)) {
        failures.push(`${target.rel}: contains stale token ${token}`);
      }
    }

    const agentsDir = path.dirname(abs);
    const backtickTokens = content.match(/`[^`\n]+`/gu) || [];
    for (const raw of backtickTokens) {
      const inner = raw.slice(1, -1);
      validatePathToken(inner, failures, target.rel, agentsDir, projectRoot);
      validatePnpmCommand(inner, knownScripts, failures, target.rel);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `agents freshness check failed:\n${failures.map((entry) => `- ${entry}`).join("\n")}\n`,
    );
    return 1;
  }

  process.stdout.write(`agents freshness check passed (${targets.length} files)\n`);
  return 0;
}
