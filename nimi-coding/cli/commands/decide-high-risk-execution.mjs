import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildHighRiskDecisionPayload,
  formatHighRiskDecisionPayload,
} from "../lib/high-risk-decision.mjs";
import { localize } from "../lib/ui.mjs";

function parseDecideHighRiskExecutionOptions(args) {
  const options = {
    fromPath: null,
    acceptancePath: null,
    verifiedAt: null,
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

    if (arg === "--from" || arg === "--acceptance" || arg === "--verified-at") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding decide-high-risk-execution refused: ${arg} requires a value.`,
            `nimicoding decide-high-risk-execution 已拒绝：${arg} 需要一个值。`,
          )}\n`,
        };
      }

      if (arg === "--from") {
        options.fromPath = next;
      } else if (arg === "--acceptance") {
        options.acceptancePath = next;
      } else {
        options.verifiedAt = next;
      }
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding decide-high-risk-execution refused: unknown option ${arg}.`,
        `nimicoding decide-high-risk-execution 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.fromPath) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding decide-high-risk-execution refused: explicit --from is required.",
        "nimicoding decide-high-risk-execution 已拒绝：必须显式提供 `--from`。",
      )}\n`,
    };
  }

  if (!options.acceptancePath) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding decide-high-risk-execution refused: explicit --acceptance is required.",
        "nimicoding decide-high-risk-execution 已拒绝：必须显式提供 `--acceptance`。",
      )}\n`,
    };
  }

  if (!options.verifiedAt) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding decide-high-risk-execution refused: explicit --verified-at is required.",
        "nimicoding decide-high-risk-execution 已拒绝：必须显式提供 `--verified-at`。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

export async function runDecideHighRiskExecution(args) {
  const parsed = parseDecideHighRiskExecutionOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const payload = await buildHighRiskDecisionPayload(process.cwd(), parsed.options);
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
    process.stdout.write(formatHighRiskDecisionPayload(payload));
  }

  return payload.exitCode;
}

export { parseDecideHighRiskExecutionOptions };
