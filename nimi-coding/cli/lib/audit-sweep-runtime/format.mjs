export function formatAuditSweepPayload(payload) {
  if (!payload.ok) {
    if (payload.error) {
      return payload.error;
    }
    if (payload.checks) {
      const failed = payload.checks.filter((entry) => !entry.ok);
      return `audit-sweep ${payload.sweepId ?? "result"} validation failed\nchecks: ${payload.checks.length - failed.length}/${payload.checks.length}\nfailed: ${failed.map((entry) => entry.reason).join("; ")}\n`;
    }
    return "audit-sweep failed\n";
  }

  const lines = [`audit-sweep ${payload.sweepId ?? payload.auditCloseout?.sweep_id ?? "result"}`];
  for (const [label, value] of [
    ["plan", payload.planRef],
    ["chunk", payload.chunkRef],
    ["ledger", payload.ledgerRef],
    ["latest ledger", payload.latestLedgerRef],
    ["report", payload.reportRef],
    ["remediation map", payload.remediationMapRef],
    ["audit closeout", payload.auditCloseoutRef],
    ["packet", payload.packetRef],
    ["run ledger", payload.runLedgerRef],
  ]) {
    if (value) {
      lines.push(`${label}: ${value}`);
    }
  }
  if (payload.state) {
    lines.push(`state: ${payload.state}`);
  }
  if (payload.chunkCount !== undefined) {
    lines.push(`chunks: ${payload.chunkCount}`);
  }
  if (payload.includedFiles !== undefined) {
    lines.push(`included files: ${payload.includedFiles}`);
  }
  if (payload.findingCount !== undefined) {
    lines.push(`findings: ${payload.findingCount}`);
  }
  if (payload.findingClusterCount !== undefined) {
    lines.push(`finding clusters: ${payload.findingClusterCount}`);
  }
  if (payload.clusteredSymptomCount !== undefined) {
    lines.push(`clustered symptoms: ${payload.clusteredSymptomCount}`);
  }
  if (payload.unresolvedFindingCount !== undefined) {
    lines.push(`open findings: ${payload.unresolvedFindingCount}`);
  }
  if (payload.waveCount !== undefined) {
    lines.push(`remediation waves: ${payload.waveCount}`);
  }
  if (payload.checks) {
    lines.push(`checks: ${payload.checks.filter((entry) => entry.ok).length}/${payload.checks.length}`);
  }
  return `${lines.join("\n")}\n`;
}
