import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import { checkLocalHealth } from './runtime-config-connector-discovery';

export async function runLocalHealthCheckCommand(input: {
  state: RuntimeConfigStateV11;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
}) {
  const { health, normalizedStatus } = await checkLocalHealth();

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
