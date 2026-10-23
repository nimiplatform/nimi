import type { ProductUpdateStatus, ProductRetentionPreview, ProductRetentionResult } from '../../shared/product-update.js';
import { invoke } from '../bridge/runtime-bridge/invoke.js';

export type DesktopProductUpdatePort = {
  status(): Promise<ProductUpdateStatus>;
  check(): Promise<ProductUpdateStatus>;
  cancel(): Promise<ProductUpdateStatus>;
  install(releaseId: string): Promise<ProductUpdateStatus>;
  homeReady(): Promise<ProductUpdateStatus>;
  reopenCurrentVersion(): Promise<ProductUpdateStatus>;
  previewRetention(): Promise<ProductRetentionPreview>;
  cleanupRetention(versions: string[]): Promise<ProductRetentionResult>;
};
export function createDesktopProductUpdatePort(): DesktopProductUpdatePort {
  return {
    status: async () => await invoke('nimi_product_update_status', {}) as ProductUpdateStatus,
    check: async () => await invoke('nimi_product_update_check', {}) as ProductUpdateStatus,
    cancel: async () => await invoke('nimi_product_update_cancel', {}) as ProductUpdateStatus,
    install: async (releaseId) => await invoke('nimi_product_update_install', { releaseId, consentApproved: true }) as ProductUpdateStatus,
    homeReady: async () => await invoke('nimi_product_update_home_ready', {}) as ProductUpdateStatus,
    reopenCurrentVersion: async () => await invoke('nimi_product_update_reopen_current', {}) as ProductUpdateStatus,
    previewRetention: async () => await invoke('nimi_product_retention_preview', {}) as ProductRetentionPreview,
    cleanupRetention: async (versions) => await invoke('nimi_product_retention_cleanup', { versions, consentApproved: true }) as ProductRetentionResult,
  };
}
