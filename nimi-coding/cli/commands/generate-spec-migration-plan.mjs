import {
  generateSpecMigrationPlan,
  parseSurfaceValidatorOptions,
  writeMigrationPlanIfRequested,
} from "../lib/internal/surface-taxonomy-validators.mjs";
import { localize } from "../lib/ui.mjs";

export async function runGenerateSpecMigrationPlan(args) {
  const parsed = parseSurfaceValidatorOptions(args);
  if (!parsed.ok) {
    process.stderr.write(localize(
      `nimicoding generate-spec-migration-plan refused: ${parsed.error}\n`,
      `nimicoding generate-spec-migration-plan 已拒绝：${parsed.error}\n`,
    ));
    return 2;
  }

  try {
    const report = await generateSpecMigrationPlan(process.cwd(), parsed.options);
    await writeMigrationPlanIfRequested(report, parsed.options.emit, process.cwd());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(localize(
      `nimicoding generate-spec-migration-plan refused: ${error.message}\n`,
      `nimicoding generate-spec-migration-plan 已拒绝：${error.message}\n`,
    ));
    return 2;
  }
}
