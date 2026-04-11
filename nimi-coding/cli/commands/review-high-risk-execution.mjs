import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHighRiskReviewPayload,
  formatHighRiskReviewPayload,
} from "../lib/high-risk-review.mjs";
import { localize } from "../lib/ui.mjs";

function parseReviewHighRiskExecutionOptions(args) {
  const options = {
    fromPath: null,
    json: false,
    writeLocal: false,
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

    if (arg === "--from") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: `${localize(
            "nimicoding review-high-risk-execution refused: --from requires a value.",
            "nimicoding review-high-risk-execution 已拒绝：`--from` 需要一个值。",
          )}\n`,
        };
      }
      options.fromPath = next;
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding review-high-risk-execution refused: unknown option ${arg}.`,
        `nimicoding review-high-risk-execution 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.fromPath) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding review-high-risk-execution refused: explicit --from is required.",
        "nimicoding review-high-risk-execution 已拒绝：必须显式提供 `--from`。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

export async function runReviewHighRiskExecution(args) {
  const parsed = parseReviewHighRiskExecutionOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const payload = await buildHighRiskReviewPayload(process.cwd(), parsed.options.fromPath, parsed.options);
  if (payload.inputError) {
    process.stderr.write(payload.error);
    return payload.exitCode;
  }

  if (parsed.options.writeLocal && payload.ok) {
    await mkdir(path.dirname(payload.artifactPath), { recursive: true });
    await writeFile(payload.artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(formatHighRiskReviewPayload(payload));
  }

  return payload.exitCode;
}

export { parseReviewHighRiskExecutionOptions };
