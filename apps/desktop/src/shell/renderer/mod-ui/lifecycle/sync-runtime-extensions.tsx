import type { ComponentType } from 'react';
import type { UiExtensionEntry } from '@runtime/hook/contracts/types';
import { renderShellNavIcon } from '@renderer/app-shell/layouts/navigation-config';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getRuntimeHookRuntime } from '@runtime/mod';
import type { UiSlotId } from '@renderer/mod-ui/contracts';
import { runtimeSlotRegistry } from '@renderer/mod-ui/registry/slot-registry';
import { RuntimeQueryPanel } from '@renderer/mod-ui/host/runtime-query-panel';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { i18n } from '@renderer/i18n';

const SLOT_ALLOWLIST = new Set<UiSlotId>([
  'auth.login.form.footer',
  'chat.sidebar.header',
  'chat.chat.list.item.trailing',
  'chat.turn.input.toolbar',
  'settings.panel.section',
  'ui-extension.app.sidebar.mods',
  'ui-extension.app.content.routes',
  'ui-extension.runtime.devtools.panel',
]);

function normalizeSlot(slot: string): UiSlotId | null {
  const normalized = String(slot || '').trim() as UiSlotId;
  if (!SLOT_ALLOWLIST.has(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeStrategy(value: unknown): 'replace' | 'wrap' | 'append' | 'hide' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'replace' || normalized === 'wrap' || normalized === 'hide') {
    return normalized;
  }
  return 'append';
}

function normalizeExtension(entry: UiExtensionEntry): Record<string, unknown> {
  if (!entry.extension || typeof entry.extension !== 'object') {
    return {};
  }
  return entry.extension as Record<string, unknown>;
}

/**
 * Look up the actual tabId that a mod's tab-page extension registered with.
 * Mods may use a short tabId (e.g. `mod:local-chat`) instead of the full
 * `mod:${modId}` (e.g. `mod:world.nimi.local-chat`). We must use the registered
 * tabId to match the extension's visibility check in the render function.
 */
export function resolveModTabId(modId: string): `mod:${string}` {
  const fallback = `mod:${modId}` as `mod:${string}`;
  try {
    const hookRuntime = getRuntimeHookRuntime();
    const entries = hookRuntime.resolveUIExtensions('ui-extension.app.content.routes');
    for (const entry of entries) {
      if (entry.modId !== modId) continue;
      const extension = normalizeExtension(entry);
      if (String(extension.type || '').trim() !== 'tab-page') continue;
      const tabId = String(extension.tabId || '').trim();
      if (tabId && tabId.startsWith('mod:')) return tabId as `mod:${string}`;
    }
  } catch {
    // fallback to default
  }
  return fallback;
}

export function resolveRouteTabExtension(tabId: string): {
  modId: string;
  extension: Record<string, unknown>;
} | null {
  const normalizedTabId = String(tabId || '').trim();
  if (!normalizedTabId) {
    return null;
  }
  try {
    const hookRuntime = getRuntimeHookRuntime();
    const entries = hookRuntime.resolveUIExtensions('ui-extension.app.content.routes');
    for (const entry of entries) {
      const extension = normalizeExtension(entry);
      if (String(extension.type || '').trim() !== 'tab-page') continue;
      const extensionTabId = String(extension.tabId || `mod:${entry.modId}`).trim();
      if (extensionTabId !== normalizedTabId) continue;
      return {
        modId: entry.modId,
        extension,
      };
    }
  } catch {
    // fallback to default shell chrome
  }
  return null;
}

function hasRouteTabPageForTabId(
  entries: UiExtensionEntry[],
  tabId: string,
): boolean {
  return entries.some((entry) => {
    const extension = normalizeExtension(entry);
    if (String(extension.type || '').trim() !== 'tab-page') {
      return false;
    }
    const extensionTabId = String(extension.tabId || `mod:${entry.modId}`).trim();
    return extensionTabId === tabId;
  });
}

function summarizeModOpenFailureChain(input: {
  modId: string;
  tabId: string;
}): {
  chain: string[];
  failureStage: string | null;
  failureError: string | null;
  fusedError: string | null;
} {
  const appStore = useAppStore.getState();
  const failure = appStore.runtimeModFailures.find((item) => item.modId === input.modId) || null;
  const fused = appStore.fusedRuntimeMods[input.modId];
  const chain = [
    `mod-open-click:${input.tabId}`,
    'resolve-slot:ui-extension.app.content.routes',
    'route-extension:missing-tab-page',
  ];
  if (failure) {
    chain.push(`register-${failure.stage}:${failure.error}`);
  }
  if (fused?.lastError) {
    chain.push(`fused:${fused.lastError}`);
  }

  return {
    chain,
    failureStage: failure?.stage || null,
    failureError: failure?.error || null,
    fusedError: fused?.lastError || null,
  };
}

export function syncRuntimeUiExtensionsToRegistry(): {
  slotCount: number;
  registrationCount: number;
} {
  const hookRuntime = getRuntimeHookRuntime();
  runtimeSlotRegistry.clearByPrefix('runtime-hook:');

  let registrationCount = 0;
  let slotCount = 0;

  for (const rawSlot of hookRuntime.listUISlots()) {
    const slot = normalizeSlot(rawSlot);
    if (!slot) {
      continue;
    }
    slotCount += 1;

    const entries = hookRuntime.resolveUIExtensions(rawSlot);
    entries.forEach((entry, index) => {
      const extension = normalizeExtension(entry);
      const extensionType = String(extension.type || '').trim();
      const extensionId = `runtime-hook:${slot}:${entry.modId}:${index}`;
      const strategy = normalizeStrategy(extension.strategy);
      runtimeSlotRegistry.register({
        extensionId,
        modId: entry.modId,
        slot,
        priority: Number(entry.priority || 0),
        strategy,
        render: ({ context }) => {
          if (extensionType === 'query-panel') {
            return (
              <RuntimeQueryPanel
                extensionId={extensionId}
                modId={entry.modId}
                extension={extension}
                context={context}
              />
            );
          }

          if (extensionType === 'nav-item') {
            const tabId = String(extension.tabId || `mod:${entry.modId}`).trim();
            if (!tabId) {
              return null;
            }
            const label = String(extension.label || entry.modId || tabId).trim();
            const badge = String(extension.badge || 'MOD').trim();
            const icon = String(extension.icon || 'puzzle').trim().toLowerCase();
            const active = context.activeTab === tabId;
            const isModTab = tabId.startsWith('mod:');
            const fused = isModTab ? context.isModFused(entry.modId) : false;
            const badgeValue = fused ? 'CRASH' : badge;
            const sidebarCollapsed = Boolean(context.shellUi?.sidebarCollapsed);
            return (
              <button
                type="button"
                onClick={() => {
                  if (isModTab) {
                    const routeEntries = hookRuntime.resolveUIExtensions('ui-extension.app.content.routes');
                    const hasRoute = hasRouteTabPageForTabId(routeEntries, tabId);
                    if (!hasRoute) {
                      const failureSummary = summarizeModOpenFailureChain({
                        modId: entry.modId,
                        tabId,
                      });
                      const chainText = failureSummary.chain.join(' -> ');
                      useAppStore.getState().setStatusBanner({
                        kind: 'error',
                        message: i18n.t('ModUI.openModFailedWithChain', {
                          modId: entry.modId,
                          chain: chainText,
                          defaultValue: `Mod ${entry.modId} failed to open. Error chain: ${chainText}`,
                        }),
                      });
                      logRendererEvent({
                        level: 'error',
                        area: 'mod-ui',
                        message: 'mod-ui:open-mod-tab-failed',
                        details: {
                          modId: entry.modId,
                          tabId,
                          label,
                          chain: failureSummary.chain,
                          failureStage: failureSummary.failureStage,
                          failureError: failureSummary.failureError,
                          fusedError: failureSummary.fusedError,
                        },
                      });
                      return;
                    }
                    context.openModTab(tabId as `mod:${string}`, entry.modId, label);
                    return;
                  }
                  context.setActiveTab(tabId);
                }}
                title={sidebarCollapsed ? label : undefined}
                className={`group relative flex w-full items-center rounded-[10px] text-sm transition-colors ${
                  active
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-gray-700 hover:bg-gray-50'
                } ${sidebarCollapsed ? 'h-11 justify-center px-0' : 'gap-3 px-3 py-2'}`}
              >
                <span className={active ? 'text-brand-700' : 'text-gray-400'}>{renderShellNavIcon(icon)}</span>
                {sidebarCollapsed ? null : <span className="flex-1 truncate text-left">{label}</span>}
                {!sidebarCollapsed && badgeValue ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      fused
                        ? 'bg-red-100 text-red-600'
                        : 'bg-orange-100 text-orange-600'
                    }`}
                  >
                    {badgeValue}
                  </span>
                ) : null}
                {sidebarCollapsed && badgeValue ? (
                  <span
                    className={`absolute right-2 top-2 inline-flex h-2 w-2 rounded-full ${
                      fused ? 'bg-red-500' : 'bg-orange-500'
                    }`}
                  />
                ) : null}
                {sidebarCollapsed ? <span className="sr-only">{label}</span> : null}
              </button>
            );
          }

          if (extensionType === 'tab-page') {
            const tabId = String(extension.tabId || `mod:${entry.modId}`).trim();
            if (!tabId) {
              return null;
            }

            const Component = extension.component as ComponentType<{
              extensionId: string;
              modId: string;
            }>;
            const active = context.activeTab === tabId;
            const keepMounted = context.isModTabOpen(tabId as `mod:${string}`);
            if (!active && !keepMounted) {
              return null;
            }

            if (typeof Component === 'function') {
              return (
                <div
                  className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                  style={active ? undefined : { display: 'none' }}
                  aria-hidden={!active}
                >
                  <Component extensionId={extensionId} modId={entry.modId} />
                </div>
              );
            }

            return (
              <section className="m-4 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700">
                <p className="font-semibold">{entry.modId}</p>
                <p className="mt-1 text-gray-500">
                  {i18n.t('ModUI.tabPageMissingComponent', {
                    defaultValue: 'tab-page is missing a renderable component',
                  })}
                </p>
              </section>
            );
          }

          return (
            <section className="rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-700">
              <p className="font-semibold">{entry.modId}</p>
              <p className="mt-1 text-gray-500">
                {i18n.t('ModUI.unknownUiExtensionType', {
                  extensionType: extensionType || 'unknown',
                  defaultValue: `Unknown UI extension type: ${extensionType || 'unknown'}`,
                })}
              </p>
            </section>
          );
        },
      });
      registrationCount += 1;
    });
  }

  logRendererEvent({
    level: 'info',
    area: 'mod-ui',
    message: 'action:mod-ui-sync-runtime-extensions:done',
    details: {
      slotCount,
      registrationCount,
    },
  });

  return {
    slotCount,
    registrationCount,
  };
}
