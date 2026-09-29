import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';

// Go sends the user to Home's existing entries under the names Home shows.
export async function openNimiAiCapabilities(): Promise<boolean> {
  const result = await openDesktopIntent({ intent: { kind: 'open-runtime-config', page: 'models', action: 'install-model' } });
  return result.status === 'accepted';
}

export async function openNimiFindPartner(): Promise<boolean> {
  const result = await openDesktopIntent({ intent: { kind: 'open-explore', section: 'personas', productIntent: 'select-partner' } });
  return result.status === 'accepted';
}
