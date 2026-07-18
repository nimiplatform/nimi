const REQUIRED_CHECKPOINTS = [
  'dev-principal-session',
  'session-bound',
  'reserved-permission-unavailable',
  'reserved-permission-request-denied',
  'app-private-storage-base-entitlement',
  'process-mismatch-denied',
];

export function validateOwnerMinimalResult(result) {
  const issues = [];
  if (result?.schemaVersion !== 'nimi.local-agent-product-owner-minimal-result/v1') {
    issues.push('owner-minimal result schema is invalid');
  }
  if (result?.journeyId !== 'dev-kernel-owner-minimal' || result?.outcome !== 'passed') {
    issues.push('owner-minimal result did not pass the canonical journey');
  }
  if (result?.privacy?.ok !== true || (result?.privacy?.findings || []).length !== 0) {
    issues.push('owner-minimal privacy closeout is not clean');
  }
  const checkpoints = Array.isArray(result?.checkpoints) ? result.checkpoints : [];
  if (JSON.stringify(checkpoints.map((row) => row?.checkpointId)) !== JSON.stringify(REQUIRED_CHECKPOINTS)
    || checkpoints.some((row) => row?.outcome !== 'passed')) {
    issues.push('owner-minimal checkpoints are incomplete, reordered, or failed');
  }
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  for (const artifactId of ['owner-minimal-summary', 'owner-minimal-dom-console-a11y']) {
    if (!artifacts.some((artifact) => artifact?.artifactId === artifactId)) {
      issues.push(`owner-minimal artifact ${artifactId} is missing`);
    }
  }
  if (artifacts.filter((artifact) => String(artifact?.artifactId || '').startsWith('owner-minimal-shell-')).length < 3) {
    issues.push('owner-minimal real-shell screenshots are incomplete');
  }
  return issues;
}

export { REQUIRED_CHECKPOINTS as DEV_KERNEL_OWNER_MINIMAL_CHECKPOINTS };
