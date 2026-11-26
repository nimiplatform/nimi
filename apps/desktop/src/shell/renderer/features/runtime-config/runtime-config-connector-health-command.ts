import { i18n } from '../../i18n';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import { checkLocalHealth } from './runtime-config-connector-discovery';

export async function runLocalHealthCheckCommand(input: {
  state: RuntimeConfigStateV11;
  sdk: DesktopRendererSdkPort;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: InlineFeedbackState | null) => void;
}) {
  const { health, normalizedStatus } = await checkLocalHealth(input.sdk);

  input.updateState((prev) => ({
    ...prev,
    local: {
      ...prev.local,
      status: normalizedStatus,
      lastCheckedAt: health.checkedAt,
      lastDetail: health.detail,
    },
  }));

  if (health.status !== 'healthy') {
    const message = i18n.isInitialized
      ? i18n.t('runtimeConfig.local.healthStatusBanner', {
        status: health.status,
        defaultValue: 'Local Runtime health: {{status}}',
      })
      : `Local Runtime health: ${health.status}`;
    input.setStatusBanner({
      kind: 'warning',
      message,
    });
  }
}
