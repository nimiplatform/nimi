import type {
  AgentDataBundle,
  AgentDataDriver,
  AgentEvent,
  AppOriginEvent,
  DriverStatus,
} from '../driver/types.js';

export class SdkDriver implements AgentDataDriver {
  readonly kind = 'sdk' as const;
  readonly status: DriverStatus = 'idle';

  start(): Promise<void> {
    throw new Error('SdkDriver.start is not implemented — Phase 2 will wire @nimiplatform/sdk runtime events');
  }

  stop(): Promise<void> {
    throw new Error('SdkDriver.stop is not implemented — Phase 2');
  }

  getBundle(): AgentDataBundle {
    throw new Error('SdkDriver.getBundle is not implemented — Phase 2');
  }

  onEvent(_handler: (event: AgentEvent) => void): () => void {
    throw new Error('SdkDriver.onEvent is not implemented — Phase 2');
  }

  onBundleChange(_handler: (bundle: AgentDataBundle) => void): () => void {
    throw new Error('SdkDriver.onBundleChange is not implemented — Phase 2');
  }

  onStatusChange(_handler: (status: DriverStatus) => void): () => void {
    throw new Error('SdkDriver.onStatusChange is not implemented — Phase 2');
  }

  emit(_event: AppOriginEvent): void {
    throw new Error('SdkDriver.emit is not implemented — Phase 2');
  }
}
