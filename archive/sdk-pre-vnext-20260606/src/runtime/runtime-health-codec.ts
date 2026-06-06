
import { RuntimeHealthStatus } from './generated/runtime/v1/audit';
import type { RuntimeHealth } from './types.js';

export function resolveHealthStatus(status: RuntimeHealthStatus): RuntimeHealth['status'] {
  if (status === RuntimeHealthStatus.READY) {
    return 'healthy';
  }
  if (status === RuntimeHealthStatus.DEGRADED) {
    return 'degraded';
  }
  return 'unavailable';
}
