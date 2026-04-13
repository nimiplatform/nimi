import { localize } from "../lib/ui.mjs";
import { loadGovernanceConfig, requireProfile } from "../lib/internal/governance/config.mjs";
import { runCommand } from "../lib/internal/governance/runner.mjs";

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
        return { ok: false, error: "nimicoding validate-spec-governance refused: --profile requires a value.\n" };
      }
      options.profile = value;
      index += 1;
      continue;
    }

    if (arg === "--scope") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        return { ok: false, error: "nimicoding validate-spec-governance refused: --scope requires a value.\n" };
      }
      options.scope = value;
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `nimicoding validate-spec-governance refused: unknown option ${arg}.\n`,
    };
  }

  return { ok: true, options };
}

function resolveScopes(scope, governanceConfig) {
  const configuredScopes = Object.keys(governanceConfig.specGovernance.validateCommands || {});
  if (scope === "all") {
    return {
      ok: true,
      scopes: configuredScopes,
      error: null,
    };
  }
  if (!configuredScopes.includes(scope)) {
    return {
      ok: false,
      scopes: [],
      error: `nimicoding validate-spec-governance refused: unsupported --scope value ${scope}.\n`,
    };
  }
  return {
    ok: true,
    scopes: [scope],
    error: null,
  };
}

export async function runValidateSpecGovernance(args) {
  const parsed = parseOptions(args);
  if (!parsed.ok) {
    process.stderr.write(localize(parsed.error, parsed.error));
    return 2;
  }

  const governance = await loadGovernanceConfig(process.cwd());
  if (!governance.ok) {
    process.stderr.write(localize(
      `nimicoding validate-spec-governance refused: ${governance.reason} at ${governance.path}.\n`,
      `nimicoding validate-spec-governance 已拒绝：${governance.path} 的治理配置不可用。\n`,
    ));
    return 2;
  }

  const profileCheck = requireProfile(governance.config, parsed.options.profile);
  if (!profileCheck.ok) {
    process.stderr.write(localize(
      `nimicoding validate-spec-governance refused: ${profileCheck.error}.\n`,
      `nimicoding validate-spec-governance 已拒绝：${profileCheck.error}。\n`,
    ));
    return 2;
  }

  const scopeResolution = resolveScopes(parsed.options.scope, governance.config);
  if (!scopeResolution.ok) {
    process.stderr.write(localize(scopeResolution.error, scopeResolution.error));
    return 2;
  }

  let failed = false;
  for (const scope of scopeResolution.scopes) {
    const commands = governance.config.specGovernance.validateCommands[scope] || [];
    if (commands.length === 0) {
      process.stderr.write(localize(
        `nimicoding validate-spec-governance refused: scope ${scope} is not configured in .nimi/config/governance.yaml.\n`,
        `nimicoding validate-spec-governance 已拒绝：.nimi/config/governance.yaml 未配置 ${scope}。\n`,
      ));
      return 2;
    }

    for (const command of commands) {
      const result = runCommand(command, { cwd: process.cwd() });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      if (!result.ok) {
        failed = true;
        break;
      }
    }

    if (failed) {
      break;
    }
  }

  return failed ? 1 : 0;
}
