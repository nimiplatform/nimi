import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';

// Failures the user resolves in Nimi's AI settings; asking again cannot fix them.
const AI_SETUP_REASONS = new Set([
  'ai-config-invalid', 'ai-config-not-found', 'ai-connector-not-found', 'ai-model-not-found', 'ai-model-not-ready',
  'ai-local-configuration-not-configured', 'ai-local-model-unavailable', 'ai-local-model-profile-missing',
  'ai-local-selection-not-found', 'ai-provider-auth-failed', 'ai-route-unsupported',
]);

export function needsAiSetup(reasonCode: string | undefined): boolean {
  return Boolean(reasonCode) && AI_SETUP_REASONS.has(reasonCode!.replaceAll('_', '-').toLowerCase());
}

/** Opens Nimi's 「AI 能力」, the existing Home entry for model setup. */
export async function openNimiAiCapabilities(): Promise<boolean> {
  const result = await openDesktopIntent({ intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model' } });
  return result.status === 'accepted';
}
