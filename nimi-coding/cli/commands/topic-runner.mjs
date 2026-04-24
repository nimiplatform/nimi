import process from "node:process";

import { runTopicRunner, runTopicRunnerStep } from "../lib/topic-runner.mjs";
import { resolveTopicProjectRoot } from "../lib/topic.mjs";
import {
  localize,
  styleHeading,
  styleLabel,
} from "../lib/ui.mjs";

const ADAPTER_IDS = ["codex", "oh_my_codex", "claude"];

function requireOptionValue(name, next) {
  if (!next || next.startsWith("--")) {
    return {
      ok: false,
      error: `nimicoding topic-runner refused: ${name} requires a value.\n`,
    };
  }
  return { ok: true };
}

function parseTopicRunnerOptions(args) {
  const [mode, topicInput, ...rest] = args;
  if (!["step", "run"].includes(mode) || !topicInput) {
    return {
      ok: false,
      error: localize(
        "nimicoding topic-runner refused: expected <step|run> <topic-id> --run-id <id> --adapter <codex|oh_my_codex|claude>.\n",
        "nimicoding topic-runner 已拒绝：需要 <step|run> <topic-id> --run-id <id> --adapter <codex|oh_my_codex|claude>。\n",
      ),
    };
  }

  const options = {
    mode,
    topicInput,
    runId: null,
    adapter: null,
    executeHost: false,
    threadId: null,
    maxSteps: 20,
    verifiedAt: null,
    json: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--execute-host") {
      options.executeHost = true;
      continue;
    }
    if (arg === "--run-id") {
      const check = requireOptionValue("--run-id", next);
      if (!check.ok) return check;
      options.runId = next;
      index += 1;
      continue;
    }
    if (arg === "--adapter") {
      const check = requireOptionValue("--adapter", next);
      if (!check.ok) return check;
      options.adapter = next;
      index += 1;
      continue;
    }
    if (arg === "--thread-id") {
      const check = requireOptionValue("--thread-id", next);
      if (!check.ok) return check;
      options.threadId = next;
      index += 1;
      continue;
    }
    if (arg === "--max-steps") {
      const check = requireOptionValue("--max-steps", next);
      if (!check.ok) return check;
      options.maxSteps = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--verified-at") {
      const check = requireOptionValue("--verified-at", next);
      if (!check.ok) return check;
      options.verifiedAt = next;
      index += 1;
      continue;
    }
    return {
      ok: false,
      error: `nimicoding topic-runner refused: unknown option ${arg}.\n`,
    };
  }

  if (!options.runId || !options.adapter) {
    return {
      ok: false,
      error: "nimicoding topic-runner refused: --run-id and --adapter are required.\n",
    };
  }
  if (!ADAPTER_IDS.includes(options.adapter)) {
    return {
      ok: false,
      error: `nimicoding topic-runner refused: --adapter must be one of ${ADAPTER_IDS.join(", ")}.\n`,
    };
  }
  if (!Number.isInteger(options.maxSteps) || options.maxSteps <= 0) {
    return {
      ok: false,
      error: "nimicoding topic-runner refused: --max-steps must be a positive integer.\n",
    };
  }

  return { ok: true, options };
}

function writeJson(command, payload) {
  process.stdout.write(`${JSON.stringify({
    contract: "nimicoding.topic-runner-result.v1",
    command,
    ...payload,
  }, null, 2)}\n`);
}

function formatRunnerResult(payload) {
  return `${styleHeading(`nimicoding topic-runner: ${payload.topicId ?? "unknown"}`)}

${styleLabel(localize("Run", "Run"))}: ${payload.runId ?? "unknown"}
${styleLabel(localize("Adapter", "Adapter"))}: ${payload.adapter ?? "unknown"}
${styleLabel(localize("Status", "状态"))}: ${payload.runnerStatus ?? (payload.ok ? "ok" : "failed")}
${styleLabel(localize("Stop Class", "Stop Class"))}: ${payload.stopClass ?? "none"}
${styleLabel(localize("Action", "动作"))}: ${payload.recommendedAction ?? "none"}
${styleLabel(localize("Ledger", "Ledger"))}: ${payload.ledgerRef ?? "none"}
`;
}

export async function runTopicRunnerCommand(args) {
  const parsed = parseTopicRunnerOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const projectRoot = await resolveTopicProjectRoot(process.cwd());
  const { options } = parsed;
  const payload = options.mode === "step"
    ? await runTopicRunnerStep(projectRoot, options)
    : await runTopicRunner(projectRoot, options);

  if (!payload.ok) {
    if (options.json) {
      writeJson(`topic-runner.${options.mode}`, payload);
    } else {
      process.stderr.write(`${payload.error}\n`);
    }
    return 1;
  }

  if (options.json) {
    writeJson(`topic-runner.${options.mode}`, payload);
  } else {
    process.stdout.write(formatRunnerResult(payload));
  }
  return 0;
}
