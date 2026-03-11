import { useEffect, useMemo, useState } from 'react';
import { getRuntimeHookRuntime, listRegisteredRuntimeModIds } from '@runtime/mod';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { SlotHost } from '@renderer/mod-ui/host/slot-host';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { runtimeSlotRegistry } from '@renderer/mod-ui/registry/slot-registry';
import { syncRuntimeUiExtensionsToRegistry } from '@renderer/mod-ui/lifecycle/sync-runtime-extensions';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

export function RuntimeModPanel() {
  const { t } = useTranslation();
  const context = useUiExtensionContext();
  const setRegisteredRuntimeModIds = useAppStore((state) => state.setRegisteredRuntimeModIds);
  const [revision, setRevision] = useState(0);
  const hookRuntime = useMemo(() => getRuntimeHookRuntime(), []);

  useEffect(() => {
    const flowId = createRendererFlowId('runtime-mod-panel');
    const syncResult = syncRuntimeUiExtensionsToRegistry();
    setRegisteredRuntimeModIds(listRegisteredRuntimeModIds());
    setRevision((value) => value + 1);
    logRendererEvent({
      level: 'info',
      area: 'mod-ui',
      message: 'action:runtime-mod-panel:sync-done',
      flowId,
      details: {
        slotCount: syncResult.slotCount,
        registrationCount: syncResult.registrationCount,
      },
    });
  }, [setRegisteredRuntimeModIds]);

  const registeredMods = listRegisteredRuntimeModIds();
  const slots = runtimeSlotRegistry.listSlots();
  const hookSlots = hookRuntime.listUISlots();

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">
        {t('RuntimeModPanel.title', { defaultValue: 'Runtime Mod Panel' })}
      </h2>
      <p className="text-xs text-gray-500">
        {t('RuntimeModPanel.revision', { defaultValue: 'Revision: {{count}}', count: revision })}
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-3">
          <h3 className="mb-2 text-xs font-semibold text-gray-700">
            {t('RuntimeModPanel.registeredMods', { defaultValue: 'Registered Mods' })}
          </h3>
          {registeredMods.length === 0 ? (
            <p className="text-xs text-gray-500">{t('RuntimeModPanel.empty', { defaultValue: 'None' })}</p>
          ) : (
            <ul className="space-y-1">
              {registeredMods.map((modId) => (
                <li key={modId} className="text-xs text-gray-700">
                  {modId}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <h3 className="mb-2 text-xs font-semibold text-gray-700">
            {t('RuntimeModPanel.hookSlots', { defaultValue: 'Hook Slots' })}
          </h3>
          {hookSlots.length === 0 ? (
            <p className="text-xs text-gray-500">{t('RuntimeModPanel.empty', { defaultValue: 'None' })}</p>
          ) : (
            <ul className="space-y-1">
              {hookSlots.map((slot) => (
                <li key={slot} className="text-xs text-gray-700">
                  {slot}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <h3 className="mb-2 text-xs font-semibold text-gray-700">
            {t('RuntimeModPanel.registrySlots', { defaultValue: 'Registry Slots' })}
          </h3>
          {slots.length === 0 ? (
            <p className="text-xs text-gray-500">{t('RuntimeModPanel.empty', { defaultValue: 'None' })}</p>
          ) : (
            <ul className="space-y-1">
              {slots.map((slot) => (
                <li key={slot} className="text-xs text-gray-700">
                  {slot}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <SlotHost
        slot="ui-extension.runtime.devtools.panel"
        context={context}
        base={
          <div className="rounded-xl border border-dashed border-gray-300 p-3 text-xs text-gray-500">
            {t('RuntimeModPanel.devtoolsBase', { defaultValue: 'Runtime devtools slot base' })}
          </div>
        }
      />
    </section>
  );
}
