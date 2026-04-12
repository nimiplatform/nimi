import {
  buildBlueprintAuditPayload,
  formatBlueprintAuditPayload,
  writeBlueprintAuditArtifact,
} from "../lib/shared.mjs";
import { localize } from "../lib/ui.mjs";

function parseBlueprintAuditOptions(args) {
  const options = {
    json: false,
    writeLocal: false,
    blueprintRoot: null,
    canonicalRoot: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--write-local") {
      options.writeLocal = true;
      continue;
    }

    if (arg === "--blueprint-root" || arg === "--canonical-root") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding blueprint-audit refused: ${arg} requires a value.`,
            `nimicoding blueprint-audit 已拒绝：${arg} 需要一个值。`,
          )}\n`,
        };
      }

      if (arg === "--blueprint-root") {
        options.blueprintRoot = next;
      } else {
        options.canonicalRoot = next;
      }
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding blueprint-audit refused: unknown option ${arg}.`,
        `nimicoding blueprint-audit 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  return {
    ok: true,
    options,
  };
}

export async function runBlueprintAudit(args) {
  const parsed = parseBlueprintAuditOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const payload = await buildBlueprintAuditPayload(process.cwd(), parsed.options);
  if (payload.inputError) {
    process.stderr.write(payload.error);
    return payload.exitCode;
  }

  if (parsed.options.writeLocal) {
    await writeBlueprintAuditArtifact(process.cwd(), payload);
  }

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(formatBlueprintAuditPayload(payload));
  }

  return payload.exitCode;
}

export { parseBlueprintAuditOptions };
