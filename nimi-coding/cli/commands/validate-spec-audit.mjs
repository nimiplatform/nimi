import path from "node:path";

import { validateSpecAudit, buildValidatorCliReport } from "../lib/validators.mjs";
import { localize } from "../lib/ui.mjs";

export async function runValidateSpecAudit(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  let targetPath = ".nimi/spec/_meta/spec-generation-audit.yaml";

  if (normalized.length > 1) {
    process.stderr.write(localize(
      "nimicoding validate-spec-audit refused: expected zero or one path argument.\n",
      "nimicoding validate-spec-audit 已拒绝：期望零个或一个路径参数。\n",
    ));
    return 2;
  }

  if (normalized.length === 1) {
    targetPath = normalized[0];
  }

  const absolutePath = path.resolve(process.cwd(), targetPath);
  const report = await validateSpecAudit(absolutePath, { projectRoot: process.cwd() });
  const cliReport = buildValidatorCliReport("validate-spec-audit", absolutePath, report);
  process.stdout.write(`${JSON.stringify(cliReport, null, 2)}\n`);
  return report.ok ? 0 : 1;
}
