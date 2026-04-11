import {
  buildHighRiskAdmissionPayload,
  formatHighRiskAdmissionPayload,
  writeHighRiskAdmission,
} from "../lib/high-risk-admission.mjs";
import { localize } from "../lib/ui.mjs";

function parseAdmitHighRiskDecisionOptions(args) {
  const options = {
    fromPath: null,
    admittedAt: null,
    json: false,
    writeSpec: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--write-spec") {
      options.writeSpec = true;
      continue;
    }

    if (arg === "--from" || arg === "--admitted-at") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding admit-high-risk-decision refused: ${arg} requires a value.`,
            `nimicoding admit-high-risk-decision 已拒绝：${arg} 需要一个值。`,
          )}\n`,
        };
      }

      if (arg === "--from") {
        options.fromPath = next;
      } else {
        options.admittedAt = next;
      }
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding admit-high-risk-decision refused: unknown option ${arg}.`,
        `nimicoding admit-high-risk-decision 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  if (!options.fromPath) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding admit-high-risk-decision refused: explicit --from is required.",
        "nimicoding admit-high-risk-decision 已拒绝：必须显式提供 `--from`。",
      )}\n`,
    };
  }

  if (!options.admittedAt) {
    return {
      ok: false,
      error: `${localize(
        "nimicoding admit-high-risk-decision refused: explicit --admitted-at is required.",
        "nimicoding admit-high-risk-decision 已拒绝：必须显式提供 `--admitted-at`。",
      )}\n`,
    };
  }

  return { ok: true, options };
}

export async function runAdmitHighRiskDecision(args) {
  const parsed = parseAdmitHighRiskDecisionOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const payload = await buildHighRiskAdmissionPayload(process.cwd(), parsed.options);
  if (payload.inputError) {
    process.stderr.write(payload.error);
    return payload.exitCode;
  }

  if (payload.ok && parsed.options.writeSpec) {
    await writeHighRiskAdmission(process.cwd(), payload);
  }

  if (parsed.options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(formatHighRiskAdmissionPayload(payload));
  }

  return payload.exitCode;
}

export { parseAdmitHighRiskDecisionOptions };
