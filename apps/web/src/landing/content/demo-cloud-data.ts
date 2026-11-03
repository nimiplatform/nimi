import { listNimiRuntimeConnectorAuthOptionsForProvider, nimiRuntimeConfigConnectorVendorLabel, providerToNimiRuntimeConnectorVendor } from '@nimiplatform/sdk/runtime';
import type { ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/wire-types';
import { ADMITTED_PROVIDERS, PROVIDER_CAPABILITIES } from '../generated/index.js';
import { cloudModelCatalog, type DemoCloudModel } from '../generated/cloud-model-catalog.js';
import { APP_CATALOG, CAPABILITY_LABELS } from '../../pages/informational-content.js';
import type { HeroDemo } from './landing-content.js';

export type CloudText = (zh: string, en: string) => string;
export type CloudProvider = ProviderCatalogEntry & { name: string };
export type DemoConnection = {
  id: string; provider: string; name: string; endpoint: string; auth: string;
  status: 'checked' | 'unchecked' | 'credential';
};
export type CloudUse = { owner: string; capability: string; connectionId: string; model: string };
export type CloudExample = { connections: DemoConnection[]; uses: CloudUse[]; drafts: Record<string, CloudUse> };
export type { DemoCloudModel };

const capabilities = new Map(PROVIDER_CAPABILITIES.map(row => [row.provider, row]));
export const cloudProviders: CloudProvider[] = ADMITTED_PROVIDERS.flatMap(row => {
  const cap = capabilities.get(row.provider);
  if (!cap?.managedConnectorSupported || cap.runtimePlane !== 'remote') return [];
  return [{
    provider: row.provider, name: nimiRuntimeConfigConnectorVendorLabel(providerToNimiRuntimeConnectorVendor(row.provider)),
    defaultEndpoint: row.defaultEndpoint ?? '', requiresExplicitEndpoint: row.requiresExplicitEndpoint,
    runtimePlane: cap.runtimePlane, executionModule: cap.executionModule, managedSupported: cap.managedConnectorSupported,
    inventoryMode: row.inventoryMode, inlineSupported: cap.inlineSupported,
  }];
}).sort((a, b) => a.name.localeCompare(b.name));

export function providerFor(id: string) {
  return cloudProviders.find(provider => provider.provider === id)!;
}
export function authOptions(id: string) {
  return listNimiRuntimeConnectorAuthOptionsForProvider(id, cloudProviders);
}
export function modelsFor(id: string): readonly DemoCloudModel[] {
  return cloudModelCatalog[id] ?? [];
}
export function capabilityLabel(capability: string, demo: HeroDemo) {
  const locale = demo.appPreview.locale;
  return demo.home.capabilities.find(item => item.id === capability)?.label ?? CAPABILITY_LABELS[locale][capability]
    ?? (capability === 'world.generate' ? (locale === 'zh' ? '世界生成' : 'World generation') : capability);
}
export function endpointHost(value: string) {
  try { return new URL(value).host; } catch { return value; }
}
export function ownerOptions(capability: string, t: CloudText) {
  return [
    ...(capability === 'text.generate' ? [{ id: 'nimi.desktop', name: 'Nimi Chat' }] : []),
    ...APP_CATALOG.filter(app => app.capabilities.includes(capability)).map(app => ({ id: app.id, name: app.name })),
    { id: 'local-agent', name: t('智能体共享配置', 'Shared agent configuration') },
  ];
}

export function cloudSetupTarget(use: CloudUse) {
  return `cloud-setup/${encodeURIComponent(use.owner)}/${encodeURIComponent(use.capability)}`;
}

export function newCloudExample(): CloudExample {
  const connections = ['deepseek', 'dashscope'].flatMap((id): DemoConnection[] => {
    const p = cloudProviders.find(item => item.provider === id);
    return p ? [{ id, provider: id, name: p.name, endpoint: p.defaultEndpoint, auth: 'api_key', status: id === 'deepseek' ? 'checked' : 'unchecked' }] : [];
  });
  const model = modelsFor('deepseek').find(row => row.capabilities.includes('text.generate'));
  const uses = model && connections.some(c => c.id === 'deepseek')
    ? [{ owner: 'nimi.desktop', capability: 'text.generate', connectionId: 'deepseek', model: model.id }] : [];
  return { connections, uses, drafts: {} };
}

/** Illustrative call records, independent of current connection checks and configuration. */
export const cloudCalls = [
  { id: 'a', source: 'Nimi Chat', connectionId: 'deepseek', model: 'deepseek-flash', ageHours: 2, failed: false, input: 320, output: 168 },
  { id: 'b', source: 'ParentOS', connectionId: 'deepseek', model: 'deepseek-v4-pro', ageHours: 5, failed: true, input: null, output: null },
  { id: 'c', source: 'Nimi Chat', connectionId: 'deepseek', model: 'deepseek-flash', ageHours: 49, failed: false, input: 218, output: 124 },
] as const;
