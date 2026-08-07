import { desktopBridge } from '../bridge.js';
import type { DesktopRendererFirstRunPort } from './first-run-port.js';

export function createDesktopProductionFirstRunPort(): DesktopRendererFirstRunPort {
  return Object.freeze({
    available: desktopBridge.hasElectronInvoke,
    ensureRecordCreated: desktopBridge.ensureProductControlRecordCreated,
    pickDataRootDirectory: desktopBridge.pickProductDataRootDirectory,
    selectDataRoot: desktopBridge.selectProductDataRoot,
    getRecord: desktopBridge.getProductControlRecord,
    admitReadyForUse: desktopBridge.admitProductReadyForUse,
  });
}
