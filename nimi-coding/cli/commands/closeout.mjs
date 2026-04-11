import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildCloseoutPayload,
  formatCloseoutPayload,
  loadImportedCloseoutOptions,
} from "../lib/shared.mjs";
import { localize } from "../lib/ui.mjs";

function parseCloseoutOptions(args) {
  const options = {
    json: false,
    writeLocal: false,
    fromPath: null,
    skill: null,
    outcome: null,
    verifiedAt: null,
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

    if (arg === "--skill" || arg === "--outcome" || arg === "--verified-at" || arg === "--from") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding closeout refused: ${arg} requires a value.`,
            `nimicoding closeout 已拒绝：${arg} 需要一个值。`,
          )}\n`,
        };
      }

      if (arg === "--skill") {
        options.skill = next;
      } else if (arg === "--outcome") {
        options.outcome = next;
      } else if (arg === "--from") {
        options.fromPath = next;
      } else {
        options.verifiedAt = next;
      }
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding closeout refused: unknown option ${arg}.`,
        `nimicoding closeout 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (options.fromPath && (options.skill || options.outcome || options.verifiedAt)) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: --from cannot be combined with --skill, --outcome, or --verified-at.",
        "nimicoding closeout 已拒绝：`--from` 不能与 `--skill`、`--outcome` 或 `--verified-at` 同时使用。",
      )}\n`,
    };
  }

  if (options.fromPath) {
    return {
      ok: true,
      options,
    };
  }

  if (!options.skill) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: explicit --skill is required.",
        "nimicoding closeout 已拒绝：必须显式提供 `--skill`。",
      )}\n`,
    };
  }

  if (!options.outcome) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: explicit --outcome is required.",
        "nimicoding closeout 已拒绝：必须显式提供 `--outcome`。",
      )}\n`,
    };
  }

  if (!["completed", "blocked", "failed"].includes(options.outcome)) {
    return {
      ok: false,
      error: `${localize(
        `nimicoding closeout refused: unsupported outcome ${options.outcome}.`,
        `nimicoding closeout 已拒绝：不支持的 outcome ${options.outcome}。`,
      )}\n`,
    };
  }

  if (!options.verifiedAt) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: explicit --verified-at is required.",
        "nimicoding closeout 已拒绝：必须显式提供 `--verified-at`。",
      )}\n`,
    };
  }

  const verifiedDate = new Date(options.verifiedAt);
  if (Number.isNaN(verifiedDate.getTime()) || verifiedDate.toISOString() !== options.verifiedAt) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding closeout refused: --verified-at must be an ISO-8601 UTC timestamp.",
        "nimicoding closeout 已拒绝：`--verified-at` 必须是 ISO-8601 UTC 时间戳。",
      )}\n`,
    };
  }

  return {
    ok: true,
    options,
  };
}

export async function runCloseout(args) {
  const parsed = parseCloseoutOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  let effectiveOptions = parsed.options;
  if (parsed.options.fromPath) {
    const imported = await loadImportedCloseoutOptions(process.cwd(), parsed.options.fromPath);
    if (!imported.ok) {
      process.stderr.write(imported.error);
      return 2;
    }

    effectiveOptions = {
      ...parsed.options,
      ...imported.options,
    };
  }

  const payload = await buildCloseoutPayload(process.cwd(), effectiveOptions);
  if (payload.inputError) {
    process.stderr.write(payload.error);
    return payload.exitCode;
  }

  if (payload.ok && parsed.options.writeLocal) {
    await mkdir(path.dirname(payload.artifactPath), { recursive: true });
    await writeFile(payload.artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(formatCloseoutPayload(payload));
  }

  return payload.exitCode;
}

export { parseCloseoutOptions };
