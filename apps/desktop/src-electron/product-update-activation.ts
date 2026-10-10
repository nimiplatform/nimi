export type ProductActivationFacts = {
  identityMatches: boolean; running: boolean; healthy: boolean; runtimeVersionMatches: boolean;
  homeReady: boolean; approvalPending?: boolean; helperActive: boolean;
  installerResult?: { phase?: string; reason?: string } | null;
};
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-011
export function projectProductActivation(facts: ProductActivationFacts): {
  phase: 'completed' | 'failed' | 'awaiting-activation' | 'recovery-required'; reason: string | null;
} {
  if (facts.identityMatches) {
    if (facts.running && facts.healthy && facts.runtimeVersionMatches) return { phase: facts.homeReady ? 'completed' : 'awaiting-activation', reason: null };
    if (facts.approvalPending) return { phase: 'awaiting-activation', reason: 'UPDATE_RUNTIME_APPROVAL_REQUIRED' };
    return { phase: 'recovery-required', reason: 'UPDATE_RUNTIME_HEALTH_FAILED' };
  }
  if (facts.installerResult?.phase === 'failed') return { phase: 'failed', reason: facts.installerResult.reason || 'UPDATE_INSTALL_FAILED' };
  if (facts.installerResult?.phase === 'recovery-required') return { phase: 'recovery-required', reason: facts.installerResult.reason || 'UPDATE_HOME_REOPEN_FAILED' };
  if (!facts.installerResult && facts.helperActive) return { phase: 'awaiting-activation', reason: null };
  return { phase: 'recovery-required', reason: 'UPDATE_ACTIVATION_IDENTITY_FAILED' };
}
