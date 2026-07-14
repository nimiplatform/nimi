export const REQUIRED_FIXED_SERVICE_TRUST_STAGES = [
  'service-running',
  'pipe-opened',
  'pipe-scm-binding-verified',
  'runtime-peer-verified',
  'grpc-channel-opened',
  'open-desktop-session-started',
  'opened',
];

const PROTECTED_ACCOUNT_SESSION_STATES = new Set([
  'anonymous',
  'login-pending',
  'authenticated',
  'refresh-pending',
  'expired',
  'reauth-required',
  'switching',
  'logging-out',
  'unavailable',
]);

export function validateFixedServiceStatus(status) {
  const issues = [];
  if (status?.serviceName !== 'NimiRuntime') issues.push('serviceName must be NimiRuntime');
  if (status?.state !== 'running') issues.push('service must be running');
  if (!Number.isSafeInteger(status?.processId) || status.processId <= 0) issues.push('processId must be positive');
  if (status?.startMode !== 'Auto') issues.push('startMode must be Auto');
  if (status?.serviceAccount !== 'LocalSystem' || status?.serviceAccountMatches !== true) issues.push('service account must be verified LocalSystem');
  for (const field of [
    'binaryPathMatches',
    'serviceSidMatches',
    'restrictedSid',
    'desktopPipePresent',
    'localAppPipePresent',
    'runtimeBinaryMatchesCandidate',
    'runtimeBuildRecordMatchesCandidate',
    'checkpointCandidatePostureVerified',
  ]) {
    if (status?.[field] !== true) issues.push(`${field} must be true`);
  }
  if (status?.signatureStatus !== 'Valid') issues.push('Runtime signature must be Valid');
  if (!/^dev-kernel-runtime-[a-f0-9]{32}$/u.test(String(status?.runtimeCandidateId || ''))) issues.push('runtimeCandidateId is invalid');
  for (const field of ['runtimeBinarySha256', 'runtimeBuildRecordSha256', 'sourceDirtyDescriptorSha256', 'sourceTreeSha256']) {
    if (!/^[a-f0-9]{64}$/u.test(String(status?.[field] || ''))) issues.push(`${field} must be sha256`);
  }
  if (status?.checkpointReleasePosture !== 'non_release') issues.push('checkpoint posture must be non_release');
  if (status?.checkpointProductClosePromotion !== 'non_promotable_to_product_close') issues.push('checkpoint must be non-promotable');
  return issues;
}

export function assertFixedServiceStatus(status) {
  const issues = validateFixedServiceStatus(status);
  if (issues.length > 0) throw new Error(`NimiRuntime fixed-service status rejected: ${issues.join('; ')}`);
  return status;
}

export function trustStageCounts(logText) {
  const text = String(logText || '');
  return Object.fromEntries(REQUIRED_FIXED_SERVICE_TRUST_STAGES.map((stage) => [
    stage,
    [...text.matchAll(new RegExp(`\\[protected-local desktop-session\\] stage=${stage}`, 'gu'))].length,
  ]));
}

export function validateFixedServiceSmokeObservation(observation) {
  const issues = [];
  issues.push(...validateFixedServiceStatus(observation?.serviceBefore).map((issue) => `before: ${issue}`));
  issues.push(...validateFixedServiceStatus(observation?.serviceAfter).map((issue) => `after: ${issue}`));
  if (observation?.serviceBefore?.processId === observation?.serviceAfter?.processId) issues.push('Runtime restart must replace the service process');
  if (observation?.electronHost?.basename !== 'Nimi Desktop Runtime.exe') issues.push('Electron host exact name is invalid');
  if (observation?.electronHost?.signatureStatus !== 'Valid') issues.push('Electron host signature must be Valid');
  if (observation?.commands?.status !== 'nimi.shell.runtimeLifecycle.status') issues.push('status must use the canonical Kit command');
  if (observation?.commands?.restart !== 'nimi.shell.runtimeLifecycle.restart') issues.push('restart must use the canonical Kit command');
  if (observation?.commands?.productControl !== 'nimi.shell.runtime.unary') issues.push('product-control must use the canonical Kit Runtime unary command');
  for (const phase of ['beforeRestart', 'afterRestart']) {
    const projection = observation?.[phase];
    if (projection?.lifecycle?.running !== true || projection?.lifecycle?.managed !== true) issues.push(`${phase} lifecycle must be managed and running`);
    if (!PROTECTED_ACCOUNT_SESSION_STATES.has(projection?.account?.state)) issues.push(`${phase} account read is invalid`);
    if (typeof projection?.productControl?.state !== 'string' || !projection.productControl.state) issues.push(`${phase} product-control read is invalid`);
    if (typeof projection?.developerMode?.enabled !== 'boolean') issues.push(`${phase} Developer Mode read is invalid`);
  }
  for (const [stage, count] of Object.entries(observation?.trustStageCounts || {})) {
    if (!REQUIRED_FIXED_SERVICE_TRUST_STAGES.includes(stage)) issues.push(`unexpected trust stage ${stage}`);
    if (!Number.isSafeInteger(count) || count < 2) issues.push(`trust stage ${stage} must be observed before and after restart`);
  }
  for (const stage of REQUIRED_FIXED_SERVICE_TRUST_STAGES) {
    if (!(stage in (observation?.trustStageCounts || {}))) issues.push(`missing trust stage ${stage}`);
  }
  if (observation?.privacy?.authorizationHeaderObserved !== false
    || observation?.privacy?.secretTextObserved !== false
    || observation?.privacy?.storageAuthorityMaterialObserved !== false) {
    issues.push('renderer/network/storage authority material was observed');
  }
  if (!Array.isArray(observation?.observedPages) || observation.observedPages.length === 0) {
    issues.push('CDP observer evidence is missing');
  } else {
    for (const page of observation.observedPages) {
      if (!Array.isArray(page?.observerErrors) || page.observerErrors.length > 0) issues.push('CDP observer must complete without errors');
      if (page?.kind === 'renderer-page') {
        if (page.historicalResourceAuditCompleted !== true
          || page.storageObserverAttached !== true
          || page.storageAuditCompleted !== true) issues.push('renderer page storage/resource audit is incomplete');
      } else if (page?.kind === 'renderer-network-context') {
        if (page.requestObserverAttached !== true) issues.push('renderer network observer is incomplete');
      } else {
        issues.push('CDP observer kind is invalid');
      }
    }
  }
  if (observation?.diagnosticBuildMode !== 'reuse') issues.push('fixed-service smoke must identify diagnostic reuse mode');
  return issues;
}
