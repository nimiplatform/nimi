import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/types';
import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateUpdater } from '../../runtime-config-types';
import { checkLocalRuntimeHealth } from './discovery';

export async function runLocalRuntimeHealthCheckCommand(input: {
  state: RuntimeConfigStateV11;
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
}) {
  const { health, normalizedStatus } = await checkLocalRuntimeHealth();

  input.updateState((prev) => ({
    ...prev,
    localRuntime: {
      ...prev.localRuntime,
      status: normalizedStatus,
      lastCheckedAt: health.checkedAt,
      lastDetail: health.detail,
    },
  }));

  input.setStatusBanner({
    kind: health.status === 'healthy' ? 'success' : 'warning',
    message: `Local Runtime health: ${health.status}`,
  });
}
