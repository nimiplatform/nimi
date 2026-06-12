import type { NimiDoctorAssessment, NimiDoctorCapabilityFinding } from './assess';

export function renderTextReport(assessment: NimiDoctorAssessment): string {
  const lines: string[] = [];
  lines.push('nimi sdk doctor — migration assessment');
  lines.push('');

  if (assessment.configErrors.length > 0) {
    lines.push('CONFIG ERRORS (map/ledger drift — fix before trusting this report):');
    for (const error of assessment.configErrors) {
      lines.push(`  ! ${error}`);
    }
    lines.push('');
  }

  if (assessment.frameworks.length === 0 && assessment.pendingFrameworks.length === 0) {
    lines.push('No supported framework usage detected.');
    return lines.join('\n');
  }

  for (const framework of assessment.frameworks) {
    lines.push(`[${framework.frameworkId}] (${framework.upstreamPackage}) — ${framework.apiHitCount} call site(s)`);
    renderBucket(lines, 'supported', framework.supported);
    renderBucket(lines, 'partial', framework.partial);
    renderBucket(lines, 'unsupported', framework.unsupported);
    renderBucket(lines, 'not-applicable', framework.notApplicable);
    if (framework.unknownApis.length > 0) {
      lines.push('  unknown-api (detected but absent from the capability map — report upstream):');
      for (const unknown of framework.unknownApis) {
        lines.push(`    ? ${unknown.call} at ${unknown.location.file}:${unknown.location.line}`);
      }
    }
    if (framework.unboundCalls.length > 0) {
      lines.push('  unbound calls (framework member names whose receiver could not be statically bound — review manually):');
      for (const call of framework.unboundCalls) {
        lines.push(`    ~ .${call.member}() at ${call.location.file}:${call.location.line}`);
      }
    }
    if (framework.unresolvedConditional.length > 0) {
      lines.push('  unresolved conditional capabilities (options not statically resolvable — neither claimed nor cleared):');
      for (const item of framework.unresolvedConditional) {
        lines.push(`    ~ ${item.capability} (${item.when}) via ${item.api} at ${item.location.file}:${item.location.line}`);
      }
    }
    if (framework.dynamicImports.length > 0) {
      lines.push(`  dynamic imports: ${framework.dynamicImports.length} site(s) (usage behind dynamic import is not statically assessed)`);
    }
    lines.push('');
  }

  for (const pending of assessment.pendingFrameworks) {
    lines.push(
      `[${pending.frameworkId}] (${pending.upstreamPackage}) — detected, assessment pending upstream binding; no verdict is synthesized`,
    );
    lines.push('');
  }

  const { totals } = assessment;
  lines.push(
    `Totals: ${totals.supported} supported / ${totals.partial} partial / ${totals.unsupported} unsupported / `
    + `${totals.unknownApis} unknown-api / ${totals.unboundCalls} unbound / ${totals.unresolvedConditional} unresolved-conditional`,
  );
  return lines.join('\n');
}

function renderBucket(lines: string[], label: string, findings: readonly NimiDoctorCapabilityFinding[]): void {
  if (findings.length === 0) {
    return;
  }
  lines.push(`  ${label}:`);
  for (const finding of findings) {
    const mode = finding.mode ? ` [${finding.mode}]` : '';
    const heuristic = finding.heuristic ? ' (heuristic detection)' : '';
    lines.push(`    - ${finding.capability}${mode} via ${finding.apis.join(', ')} (${finding.locations.length} site(s))${heuristic}`);
  }
}
