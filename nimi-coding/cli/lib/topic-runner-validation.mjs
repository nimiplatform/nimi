import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { loadTopicReport } from "./topic.mjs";

function utcNowNoMillis() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toPortablePath(value) {
  return value.split(path.sep).join("/");
}

function projectRef(projectRoot, absolutePath) {
  return toPortablePath(path.relative(projectRoot, absolutePath));
}

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function hasPlaceholder(value) {
  return /<[^>]+>/.test(value);
}

function isFilteredPnpmCommand(command) {
  return /(?:^|\s)pnpm\s+--filter\s+\S+\s+\S+/u.test(command);
}

export function classifyValidationCommandResult(command, exitCode, stdout = "", stderr = "") {
  const combinedOutput = `${stdout}\n${stderr}`;
  if (
    exitCode === 0
    && isFilteredPnpmCommand(command)
    && /No projects matched the filters/u.test(combinedOutput)
  ) {
    return {
      status: "validation_drift",
      passed: false,
      summary: "Filtered package command matched no projects; replace with a concrete validation command or admit an explicit no-package evidence rule.",
    };
  }
  if (exitCode === 0) {
    return { status: "pass", passed: true, summary: "validation command passed" };
  }
  const failureLine = combinedOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "validation command failed";
  return {
    status: "fail",
    passed: false,
    summary: failureLine.slice(0, 300),
  };
}

function runShellCommand(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}\n`,
      });
    });
    child.on("close", (code) => {
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export async function runValidationCommandEvidence(projectRoot, options) {
  const loaded = await loadTopicReport(projectRoot, options.topicInput);
  if (!loaded.ok) {
    return loaded;
  }
  const command = String(options.command ?? "").trim();
  if (!command || hasPlaceholder(command)) {
    return {
      ok: false,
      error: "topic-runner validation refused: command must be concrete.",
    };
  }
  const cwd = path.resolve(projectRoot, options.cwd ?? ".");
  const startedAt = options.startedAt ?? utcNowNoMillis();
  const runResult = await runShellCommand(command, cwd);
  const completedAt = options.completedAt ?? utcNowNoMillis();
  const classification = classifyValidationCommandResult(
    command,
    runResult.exitCode,
    runResult.stdout,
    runResult.stderr,
  );
  const validationId = safeSegment(options.validationId ?? command).slice(0, 96) || "validation";
  const evidencePath = path.join(loaded.topicDir, `evidence-validation-${validationId}.json`);
  const evidence = {
    contract: "nimicoding.topic-runner.validation-evidence.v1",
    topic_id: loaded.topicId,
    run_id: options.runId ?? null,
    command,
    cwd: projectRef(projectRoot, cwd),
    started_at: startedAt,
    completed_at: completedAt,
    exit_code: runResult.exitCode,
    status: classification.status,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    remediation: classification.status === "validation_drift"
      ? "replace with concrete validation command or admit an explicit no-package evidence rule"
      : null,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return {
    ok: classification.passed,
    topicId: loaded.topicId,
    topicRef: projectRef(projectRoot, loaded.topicDir),
    command,
    exitCode: runResult.exitCode,
    status: classification.status,
    passed: classification.passed,
    evidenceRef: projectRef(projectRoot, evidencePath),
    summary: classification.summary,
  };
}
