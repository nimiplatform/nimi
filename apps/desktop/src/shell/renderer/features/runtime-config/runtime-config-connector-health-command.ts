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
    input.setStatusBanner({
      kind: 'warning',
      message: `Local Runtime health: ${health.status}`,
    });
  }
}
