import { validateFixedServiceStatus } from './dev-kernel-fixed-service-contract.mjs';

const CANONICAL_COMMANDS = Object.freeze({
  status: 'nimi.shell.runtimeLifecycle.status',
  restart: 'nimi.shell.runtimeLifecycle.restart',
  productControl: 'nimi.shell.runtime.unary',
});

function validateNarrowMetrics(metrics, label, issues) {
  if (!Number.isFinite(metrics?.clientWidth) || metrics.clientWidth > 390 || metrics.clientWidth < 300) {
    issues.push(`${label} must be observed at the 390px narrow width`);
  }
  if (!Number.isFinite(metrics?.scrollWidth) || metrics.scrollWidth > metrics.clientWidth) {
    issues.push(`${label} has horizontal overflow`);
  }
}

export function validateFirstRunConnectivityObservation(observation) {
  const issues = [];
  issues.push(...validateFixedServiceStatus(observation?.serviceBefore).map((issue) => `before: ${issue}`));
  issues.push(...validateFixedServiceStatus(observation?.runtimeInterruption?.serviceAfter).map((issue) => `interruption: ${issue}`));
  if (observation?.serviceBefore?.runtimeCandidateId !== observation?.runtimeInterruption?.serviceAfter?.runtimeCandidateId) {
    issues.push('First Run must remain bound to one installed Runtime candidate');
  }
  if (observation?.runtimeInterruption?.serviceBefore?.processId === observation?.runtimeInterruption?.serviceAfter?.processId) {
    issues.push('First Run interruption must replace the fixed-service process');
  }
  if (observation?.electronHost?.basename !== 'Nimi Desktop Runtime.exe'
    || observation?.electronHost?.signatureStatus !== 'Valid') {
    issues.push('First Run must use the signed exact-name Desktop Electron host');
  }
  for (const [name, expected] of Object.entries(CANONICAL_COMMANDS)) {
    if (observation?.commands?.[name] !== expected) issues.push(`${name} must use the canonical Kit command`);
  }
  if (!['config_missing', 'data_root_missing'].includes(observation?.initialProjection?.state)) {
    issues.push('fresh installer-owned acceptance round must project config_missing or data_root_missing before login');
  }
  const proposal = observation?.initialProjection?.dataRootProposal;
  if (proposal?.authority !== 'runtime_protected_product_control'
    || proposal?.profile !== 'dev_kernel_checkpoint'
    || !String(proposal?.path || '').trim()
    || observation?.longText?.proposedDataRoot !== proposal?.path) {
    issues.push('First Run data-root proposal must be Runtime-owned and candidate-bound');
  }
  if (observation?.baseline?.accountState !== 'anonymous') issues.push('First Run baseline must be anonymous');
  if (observation?.login?.outcome !== 'first-run') issues.push('login must enter the authenticated First Run gate');
  if (observation?.login?.accountId !== '01J00000000000000000000000') {
    issues.push('login must resolve the real Halliday account through Runtime custody');
  }
  if (observation?.accountAuthority?.accountRealmOrigin !== 'http://localhost:3002'
    || observation?.accountAuthority?.accountWebOrigin !== 'http://localhost:3000'
    || observation?.accountAuthority?.authorizeStatus !== 302
    || observation?.accountAuthority?.loginPath !== '/login'
    || observation?.accountAuthority?.oauthNextOrigin !== 'http://localhost:3002'
    || observation?.accountAuthority?.oauthNextPath !== '/api/auth/oauth/authorize'
    || observation?.accountAuthority?.automaticLoopbackCallbackObserved !== false) {
    issues.push('First Run must use the real Realm browser-login continuation before loopback callback');
  }
  if (observation?.runtimeInterruption?.carrierUnavailableObserved !== true) {
    issues.push('real fixed-service restart must expose a typed transient unavailable carrier state');
  }
  if (observation?.runtimeInterruption?.reconnected !== true) {
    issues.push('Electron must re-handshake after the First Run Runtime interruption');
  }
  if (observation?.firstRun?.productState !== 'ready_for_use') issues.push('First Run must reach ready_for_use');
  if (observation?.firstRun?.productControlRecord?.state !== 'ready_for_use') {
    issues.push('ready_for_use must be confirmed by the protected Product Control record');
  }
  const phase = observation?.firstRun?.layout?.phaseAcceptance;
  if (phase?.deviceInitialScanState === 'pending'
    && phase?.deviceContinueInitiallyDisabled !== true) {
    issues.push('Device loading must disable Continue while the initial scan is observably pending');
  }
  if (phase?.deviceRetryDisabledWhilePending !== true
    || phase?.deviceContinueDisabledWhileRetryPending !== true) {
    issues.push('Device retry must disable retry and continue while pending');
  }
  if (phase?.localAiContinueInitiallyDisabled !== true) issues.push('Local AI must initially disable Continue');
  if (phase?.setupObserved !== true) issues.push('Setup phase was not observed');
  validateNarrowMetrics(observation?.firstRun?.layout?.narrowMetrics, 'Storage', issues);
  validateNarrowMetrics(phase?.deviceNarrowMetrics, 'Device', issues);
  validateNarrowMetrics(phase?.localAiNarrowMetrics, 'Local AI', issues);
  validateNarrowMetrics(phase?.setupNarrowMetrics, 'Setup', issues);
  validateNarrowMetrics(observation?.narrowAudit?.dom, 'ready shell', issues);
  if (observation?.locale?.documentLang !== 'zh-CN'
    || observation?.locale?.chineseTextObserved !== true
    || observation?.locale?.replacementCharacterObserved !== false) {
    issues.push('Chinese First Run readability was not verified');
  }
  if (observation?.longText?.scope !== 'real-account-and-runtime-owned-path'
    || observation?.longText?.syntheticLongTextUsed !== false
    || observation?.longText?.observed !== true
    || observation?.longText?.overflowed !== false) {
    issues.push('real account and Runtime-owned path must remain visible without synthetic authority or horizontal overflow');
  }
  if (observation?.accessibility?.ok !== true) issues.push('First Run accessibility audit failed');
  if (observation?.privacy?.authorizationHeaderObserved !== false
    || observation?.privacy?.secretTextObserved !== false
    || observation?.privacy?.storageAuthorityMaterialObserved !== false) {
    issues.push('renderer/network/storage authority material was observed');
  }
  const buildPostureValid = (['fresh', 'fresh-prepared'].includes(observation?.diagnosticBuildMode)
      && observation?.finalAcceptanceEvidence === true)
    || (observation?.diagnosticBuildMode === 'reuse' && observation?.finalAcceptanceEvidence === false);
  if (!buildPostureValid) {
    issues.push('First Run build posture must bind fresh acceptance or diagnostic-only reuse');
  }
  return issues;
}

export { CANONICAL_COMMANDS };
