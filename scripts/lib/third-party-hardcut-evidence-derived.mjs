import {
  assertArtifactRef,
  assertExactObject,
  fail,
} from './third-party-hardcut-evidence-core.mjs';
import { resolveAndVerifyPacketArtifact } from './third-party-hardcut-evidence-paths.mjs';

export function validateDerivedReports(artifactStore, derivedReports, contract) {
  for (const report of derivedReports) {
    if (!Array.isArray(report.source_artifact_refs) || report.source_artifact_refs.length === 0) {
      fail(
        'DERIVED_REPORT_SOURCE_MISSING',
        `derived report ${report.path ?? '<unknown>'} has no raw source artifacts`,
      );
    }
    assertExactObject(
      report,
      contract.object_schemas.derived_report_ref.required_fields,
      `derived report ${report.path ?? '<unknown>'}`,
    );
    assertArtifactRef(contract, report, `derived report ${report.path}`);
    for (const source of report.source_artifact_refs) {
      assertArtifactRef(contract, source, `derived report ${report.path} source`);
      resolveAndVerifyPacketArtifact(artifactStore, source);
    }
    resolveAndVerifyPacketArtifact(artifactStore, report);
  }
}
