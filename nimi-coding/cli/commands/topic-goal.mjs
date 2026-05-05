import process from "node:process";

import { buildTopicGoal } from "../lib/topic-goal.mjs";
import { resolveTopicProjectRoot } from "../lib/topic.mjs";
import { formatTopicGoalRefusal, writeJson } from "./topic-formatters.mjs";
import { parseTopicGoalOptions } from "./topic-options.mjs";

export async function runTopicGoal(args) {
  const parsed = parseTopicGoalOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 3;
  }
  try {
    const projectRoot = await resolveTopicProjectRoot(process.cwd());
    const report = await buildTopicGoal(projectRoot, parsed.options);
    if (report.inputError) {
      process.stderr.write(`${report.error}\n`);
      return 3;
    }
    if (parsed.options.format === "json") {
      writeJson(report);
    } else if (report.ok) {
      process.stdout.write(`${report.goal_command}\n`);
    } else {
      process.stderr.write(formatTopicGoalRefusal(report));
    }
    return report.ok ? 0 : 2;
  } catch (error) {
    process.stderr.write(`nimicoding topic goal failed: ${error?.message ?? String(error)}\n`);
    return 1;
  }
}
