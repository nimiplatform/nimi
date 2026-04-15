import * as sdkRootModule from '@nimiplatform/sdk';
import * as sdkAiProviderModule from '@nimiplatform/sdk/ai-provider';
import * as sdkModModule from '@nimiplatform/sdk/mod';
import * as sdkLifecycleModule from '@nimiplatform/sdk/mod/lifecycle';
import * as sdkShellModule from '@nimiplatform/sdk/mod/shell';
import * as sdkStorageModule from '@nimiplatform/sdk/mod/storage';
import * as sdkRealmModule from '@nimiplatform/sdk/realm';
import * as sdkRuntimeModule from '@nimiplatform/sdk/runtime';
import * as sdkRuntimeBrowserModule from '@nimiplatform/sdk/runtime/browser';
import * as sdkScopeModule from '@nimiplatform/sdk/scope';
import * as sdkTypesModule from '@nimiplatform/sdk/types';
import * as reactQueryModule from '@tanstack/react-query';
import * as i18nextModule from 'i18next';
import * as reactModule from 'react';
import * as reactDomModule from 'react-dom';
import * as reactI18nextModule from 'react-i18next';
import * as reactJsxRuntimeModule from 'react/jsx-runtime';
import * as zustandModule from 'zustand';

const HOSTED_PACKAGE_REGISTRY_KEY = '__NIMI_HOSTED_MOD_PACKAGES__';
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

const HOSTED_PACKAGE_MODULES = new Map<string, Record<string, unknown>>([
  ['react', reactModule],
  ['react-dom', reactDomModule],
  ['react/jsx-runtime', reactJsxRuntimeModule],
  ['@tanstack/react-query', reactQueryModule],
  ['i18next', i18nextModule],
  ['react-i18next', reactI18nextModule],
  // 'zod' is populated lazily by ensureHostedPackagesReady() to keep
  // vendor-data (371 KB) out of the main entry's static dependency graph.
  ['zustand', zustandModule],
  ['@nimiplatform/sdk', sdkRootModule],
  ['@nimiplatform/sdk/realm', sdkRealmModule],
  ['@nimiplatform/sdk/runtime', sdkRuntimeModule],
  ['@nimiplatform/sdk/runtime/browser', sdkRuntimeBrowserModule],
  ['@nimiplatform/sdk/types', sdkTypesModule],
  ['@nimiplatform/sdk/ai-provider', sdkAiProviderModule],
  ['@nimiplatform/sdk/mod', sdkModModule],
  ['@nimiplatform/sdk/mod/shell', sdkShellModule],
  ['@nimiplatform/sdk/mod/lifecycle', sdkLifecycleModule],
  ['@nimiplatform/sdk/mod/storage', sdkStorageModule],
  ['@nimiplatform/sdk/scope', sdkScopeModule],
]);

const hostedPackageImportUrls = new Map<string, string>();

function getHostedPackageRegistry(): Record<string, Record<string, unknown>> {
  const globalRecord = globalThis as Record<string, unknown>;
  const existing = globalRecord[HOSTED_PACKAGE_REGISTRY_KEY];
  if (existing && typeof existing === 'object') {
    return existing as Record<string, Record<string, unknown>>;
  }
  const created: Record<string, Record<string, unknown>> = {};
  globalRecord[HOSTED_PACKAGE_REGISTRY_KEY] = created;
  return created;
}

function toHostedPackageExports(moduleNamespace: Record<string, unknown>): Record<string, unknown> {
  return {
    default: Object.prototype.hasOwnProperty.call(moduleNamespace, 'default')
      ? moduleNamespace.default
      : moduleNamespace,
    ...moduleNamespace,
  };
}

function buildHostedPackageModuleSource(specifier: string, moduleNamespace: Record<string, unknown>): string {
  const exportLines = Object.keys(moduleNamespace)
    .filter((key) => key !== 'default' && IDENTIFIER_PATTERN.test(key))
    .sort()
    .map((key) => `export const ${key} = module[${JSON.stringify(key)}];`);

  return [
    `const registry = globalThis[${JSON.stringify(HOSTED_PACKAGE_REGISTRY_KEY)}];`,
    `const module = registry?.[${JSON.stringify(specifier)}];`,
    `if (!module) throw new Error(${JSON.stringify(`Missing hosted package module: ${specifier}`)});`,
    ...exportLines,
    'export default module.default;',
  ].join('\n');
}

let hostedPackagesReadyPromise: Promise<void> | null = null;

/** Lazily populate heavy hosted-package entries (zod, etc.) that are not
 *  needed at startup.  Must be awaited before the first mod-load attempt. */
export async function ensureHostedPackagesReady(): Promise<void> {
  if (!hostedPackagesReadyPromise) {
    hostedPackagesReadyPromise = import('zod').then((zodModule) => {
      HOSTED_PACKAGE_MODULES.set('zod', zodModule);
    });
  }
  await hostedPackagesReadyPromise;
}

export function resolveHostedPackageImportUrl(specifier: string): string | null {
  const normalizedSpecifier = String(specifier || '').trim();
  if (!normalizedSpecifier) {
    return null;
  }
  const cached = hostedPackageImportUrls.get(normalizedSpecifier);
  if (cached) {
    return cached;
  }
  const moduleNamespace = HOSTED_PACKAGE_MODULES.get(normalizedSpecifier);
  if (!moduleNamespace) {
    return null;
  }

  const registry = getHostedPackageRegistry();
  registry[normalizedSpecifier] = toHostedPackageExports(moduleNamespace);

  const source = buildHostedPackageModuleSource(normalizedSpecifier, moduleNamespace);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  hostedPackageImportUrls.set(normalizedSpecifier, url);
  return url;
}
