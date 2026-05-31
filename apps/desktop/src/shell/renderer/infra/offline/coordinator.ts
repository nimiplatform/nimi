import { OfflineCoordinator } from '@nimiplatform/kit/core/offline-coordinator';

let offlineCoordinator: OfflineCoordinator | null = null;

export function getOfflineCoordinator(): OfflineCoordinator {
  if (!offlineCoordinator) {
    offlineCoordinator = new OfflineCoordinator();
  }
  offlineCoordinator.start();
  return offlineCoordinator;
}
